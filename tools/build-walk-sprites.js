// 构建走路精灵：对 assets/_cut_walk/ 的透明帧做「每帧单独包围盒 → 归一化到统一高度 →
// 底部居中对齐到统一画布」，得到原地走动画（身体大小稳定、腿在动）。
// 然后扫描 assets/cat/ 下的 idle_*.png 与 walk_*.png，重写 manifest.json 为双动画集格式。
// 运行：node tools/build-walk-sprites.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CUT_DIR = process.argv[2] || path.join(__dirname, '..', 'assets', '_cut_walk');
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
  if (!files.length) throw new Error('assets/_cut_walk 下没有抠好的走路帧');

  // 第一遍：每帧裁到自身包围盒并归一化到 TARGET_HEIGHT，记录缩放后宽度。
  const normalized = [];
  let maxW = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(CUT_DIR, f));
    const bb = await alphaBBox(buf);
    const cropped = await sharp(buf)
      .extract({ left: bb.l, top: bb.t, width: bb.w, height: bb.h })
      .resize({ height: TARGET_HEIGHT })
      .png().toBuffer({ resolveWithObject: true });
    normalized.push(cropped.data);
    if (cropped.info.width > maxW) maxW = cropped.info.width;
  }

  // 第二遍：底部居中合成到统一画布 (maxW + pad) x TARGET_HEIGHT。
  const pad = 8;
  const canvasW = maxW + pad;
  for (let i = 0; i < normalized.length; i++) {
    const meta = await sharp(normalized[i]).metadata();
    const left = Math.round((canvasW - meta.width) / 2);
    const top = TARGET_HEIGHT - meta.height; // 底部对齐（脚落地）
    await sharp({ create: { width: canvasW, height: TARGET_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: normalized[i], left, top }])
      .png()
      .toFile(path.join(OUT_DIR, `walk_${String(i).padStart(2, '0')}.png`));
  }
  console.log(`走路精灵：${normalized.length} 帧 → walk_*.png (${canvasW}x${TARGET_HEIGHT})`);

  // 重写 manifest 为双动画集。idle 集尺寸从已有 idle_00.png 读。
  const idleFiles = fs.readdirSync(OUT_DIR).filter(f => /^idle_\d+\.png$/.test(f)).sort();
  const idleDim = await sharp(path.join(OUT_DIR, idleFiles[0])).metadata();
  const walkDim = await sharp(path.join(OUT_DIR, 'walk_00.png')).metadata();
  const manifest = {
    sets: {
      idle: { pattern: 'idle_%02d.png', frameCount: idleFiles.length, width: idleDim.width, height: idleDim.height, fps: 10 },
      walk: { pattern: 'walk_%02d.png', frameCount: normalized.length, width: walkDim.width, height: walkDim.height, fps: 13 }
    }
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest.json 已更新为 idle/walk 双动画集');
}

main().catch(e => { console.error(e); process.exit(1); });
