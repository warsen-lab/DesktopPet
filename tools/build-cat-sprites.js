// 离线资源构建脚本：把 assets/_frames/*.png（从用户宠物视频抽的帧）
// 抠掉背景，统一裁剪+缩放成透明 PNG 精灵，输出到 assets/cat/。
// 用「所有帧的并集包围盒」统一裁剪，保证猫在各帧间位置稳定、不抖动。
//
// 运行：node tools/build-cat-sprites.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

const FRAMES_DIR = path.join(__dirname, '..', 'assets', '_frames');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'cat');
const TARGET_HEIGHT = 150;     // 精灵在屏幕上的高度（CSS 像素）
const ALPHA_THRESHOLD = 24;    // 判定为前景的最小 alpha

async function main() {
  const files = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('assets/_frames 下没有帧，请先用 ffmpeg 抽帧');

  console.log(`抠图中，共 ${files.length} 帧（首帧会加载模型，稍慢）...`);
  const cutouts = [];   // 每帧抠完背景的 PNG buffer（原始 568x320）
  for (let i = 0; i < files.length; i++) {
    // 传带 MIME 的 Blob：路径字符串会被当成 URL，裸 Buffer 又识别不出格式。
    const bytes = fs.readFileSync(path.join(FRAMES_DIR, files[i]));
    const inputBlob = new Blob([bytes], { type: 'image/png' });
    const blob = await removeBackground(inputBlob, { output: { format: 'image/png' } });
    const buf = Buffer.from(await blob.arrayBuffer());
    cutouts.push(buf);
    process.stdout.write(`\r  ${i + 1}/${files.length}`);
  }
  console.log('\n抠图完成，计算统一包围盒...');

  // 计算每帧 alpha 包围盒，取并集，保证裁剪框对所有帧一致。
  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  const metas = [];
  for (const buf of cutouts) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    let l = width, t = height, r = 0, b = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * channels + (channels - 1)];
        if (a > ALPHA_THRESHOLD) {
          if (x < l) l = x; if (x > r) r = x;
          if (y < t) t = y; if (y > b) b = y;
        }
      }
    }
    metas.push({ width, height });
    if (l < minL) minL = l; if (t < minT) minT = t;
    if (r > maxR) maxR = r; if (b > maxB) maxB = b;
  }

  // 加一点边距，防止裁到边缘羽化。
  const pad = 6;
  const W = metas[0].width, H = metas[0].height;
  const left = Math.max(0, Math.floor(minL) - pad);
  const top = Math.max(0, Math.floor(minT) - pad);
  const right = Math.min(W, Math.ceil(maxR) + pad);
  const bottom = Math.min(H, Math.ceil(maxB) + pad);
  const cropW = right - left;
  const cropH = bottom - top;
  console.log(`包围盒: ${cropW}x${cropH} @ (${left},${top})`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let outW = 0;
  for (let i = 0; i < cutouts.length; i++) {
    const out = path.join(OUT_DIR, `idle_${String(i).padStart(2, '0')}.png`);
    const img = sharp(cutouts[i])
      .extract({ left, top, width: cropW, height: cropH })
      .resize({ height: TARGET_HEIGHT });
    const { info } = await img.png().toBuffer({ resolveWithObject: true });
    outW = info.width;
    await sharp(cutouts[i])
      .extract({ left, top, width: cropW, height: cropH })
      .resize({ height: TARGET_HEIGHT })
      .png()
      .toFile(out);
  }

  // 写一个清单，渲染层据此加载。
  const manifest = {
    frameCount: cutouts.length,
    width: outW,
    height: TARGET_HEIGHT,
    pattern: 'idle_%02d.png'
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`完成：${cutouts.length} 帧 → assets/cat/  (${outW}x${TARGET_HEIGHT})`);
}

main().catch(e => { console.error(e); process.exit(1); });
