// 构建快跑精灵：与 build-walk-sprites.js 同法——每帧单独包围盒 → 归一化到统一高度 →
// 底部居中对齐到统一画布，得到原地跑动画（猫由远跑近的体型变化被归一化抵消）。
// 不带参数时只打印每帧包围盒（用于选段）；带 <start> <count> 时输出 run_*.png。
// 运行：node tools/build-run-sprites.js [start count]
// 之后执行 node tools/make-manifest.js 重建清单。

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CUT_DIR = path.join(__dirname, '..', 'assets', '_run_cut');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'cat');
const TARGET_HEIGHT = 150;
const ALPHA_THRESHOLD = 24;

async function alphaBBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let l = width, t = height, r = 0, b = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + (channels - 1)] > ALPHA_THRESHOLD) {
        if (x < l) l = x; if (x > r) r = x;
        if (y < t) t = y; if (y > b) b = y;
      }
    }
  }
  return { l, t, w: r - l + 1, h: b - t + 1 };
}

async function main() {
  const files = fs.readdirSync(CUT_DIR).filter(f => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('assets/_run_cut 下没有抠好的帧');

  const bboxes = [];
  for (const f of files) {
    const bb = await alphaBBox(fs.readFileSync(path.join(CUT_DIR, f)));
    bboxes.push(bb);
    console.log(`${f}: ${bb.w}x${bb.h} 宽高比=${(bb.w / bb.h).toFixed(2)}`);
  }

  const start = parseInt(process.argv[2], 10);
  const count = parseInt(process.argv[3], 10);
  if (isNaN(start) || isNaN(count)) {
    console.log('\n只打印了包围盒。要输出帧请带参数：node tools/build-run-sprites.js <start> <count>');
    return;
  }

  const picked = files.slice(start, start + count);
  const normalized = [];
  let maxW = 0;
  for (let i = 0; i < picked.length; i++) {
    const bb = bboxes[start + i];
    const cropped = await sharp(path.join(CUT_DIR, picked[i]))
      .extract({ left: bb.l, top: bb.t, width: bb.w, height: bb.h })
      .resize({ height: TARGET_HEIGHT })
      .png().toBuffer({ resolveWithObject: true });
    normalized.push(cropped.data);
    if (cropped.info.width > maxW) maxW = cropped.info.width;
  }

  const pad = 8;
  const canvasW = maxW + pad;
  for (let i = 0; i < normalized.length; i++) {
    const meta = await sharp(normalized[i]).metadata();
    await sharp({ create: { width: canvasW, height: TARGET_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: normalized[i], left: Math.round((canvasW - meta.width) / 2), top: TARGET_HEIGHT - meta.height }])
      .png()
      .toFile(path.join(OUT_DIR, `run_${String(i).padStart(2, '0')}.png`));
  }
  console.log(`快跑精灵：${normalized.length} 帧 → run_*.png (${canvasW}x${TARGET_HEIGHT})，记得跑 make-manifest.js`);
}

main().catch(e => { console.error(e); process.exit(1); });
