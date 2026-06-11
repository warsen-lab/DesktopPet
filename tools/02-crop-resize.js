// 阶段B：只用 sharp，对 assets/_cut/ 的透明 PNG 计算「并集包围盒」统一裁剪 + 缩放，
// 输出最终精灵到 assets/cat/ 并写 manifest.json。单独成进程，避免与 onnxruntime 冲突。
// 运行：node tools/02-crop-resize.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CUT_DIR = path.join(__dirname, '..', 'assets', '_cut');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'cat');
const TARGET_HEIGHT = 150;     // 精灵屏幕高度（CSS 像素）
const ALPHA_THRESHOLD = 24;    // 前景判定阈值

async function main() {
  const files = fs.readdirSync(CUT_DIR).filter(f => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('assets/_cut 下没有抠好的帧，请先跑阶段A');

  // 计算每帧 alpha 包围盒，取并集，保证各帧裁剪框一致、猫不抖。
  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  let W = 0, H = 0;
  for (const f of files) {
    const { data, info } = await sharp(path.join(CUT_DIR, f)).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    W = width; H = height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * channels + (channels - 1)];
        if (a > ALPHA_THRESHOLD) {
          if (x < minL) minL = x; if (x > maxR) maxR = x;
          if (y < minT) minT = y; if (y > maxB) maxB = y;
        }
      }
    }
  }

  const pad = 6;
  const left = Math.max(0, Math.floor(minL) - pad);
  const top = Math.max(0, Math.floor(minT) - pad);
  const right = Math.min(W, Math.ceil(maxR) + pad);
  const bottom = Math.min(H, Math.ceil(maxB) + pad);
  const cropW = right - left, cropH = bottom - top;
  console.log(`并集包围盒: ${cropW}x${cropH} @ (${left},${top})`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let outW = 0;
  for (let i = 0; i < files.length; i++) {
    const out = path.join(OUT_DIR, `idle_${String(i).padStart(2, '0')}.png`);
    const { data, info } = await sharp(path.join(CUT_DIR, files[i]))
      .extract({ left, top, width: cropW, height: cropH })
      .resize({ height: TARGET_HEIGHT })
      .png()
      .toBuffer({ resolveWithObject: true });
    outW = info.width;
    fs.writeFileSync(out, data);
  }

  const manifest = { frameCount: files.length, width: outW, height: TARGET_HEIGHT, pattern: 'idle_%02d.png' };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`阶段B完成：${files.length} 帧 → assets/cat/  (${outW}x${TARGET_HEIGHT})`);
}

main().catch(e => { console.error(e); process.exit(1); });
