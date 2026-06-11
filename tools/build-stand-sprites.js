// 把 assets/_stand_cut/ 的透明帧做成 stand 动作集：
// 并集包围盒统一裁剪 + 缩放到 150 高，正放 6 帧 + 倒放中间 4 帧拼成无缝循环，
// 输出 assets/cat/stand_00.png ~ stand_09.png。跑完再执行 make-manifest.js。
// 运行：node tools/build-stand-sprites.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CUT_DIR = path.join(__dirname, '..', 'assets', '_stand_cut');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'cat');
const TARGET_HEIGHT = 150;
const ALPHA_THRESHOLD = 24;

async function main() {
  const files = fs.readdirSync(CUT_DIR).filter(f => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('assets/_stand_cut 下没有抠好的帧');

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

  // 正放 0..5，再倒放 4..1，共 10 帧首尾无缝衔接
  const order = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buffers = [];
  for (const f of files) {
    buffers.push(await sharp(path.join(CUT_DIR, f))
      .extract({ left, top, width: cropW, height: cropH })
      .resize({ height: TARGET_HEIGHT })
      .png()
      .toBuffer({ resolveWithObject: true }));
  }
  for (let i = 0; i < order.length; i++) {
    fs.writeFileSync(path.join(OUT_DIR, `stand_${String(i).padStart(2, '0')}.png`),
      buffers[order[i]].data);
  }
  console.log(`完成：${order.length} 帧 → assets/cat/stand_*.png (${buffers[0].info.width}x${TARGET_HEIGHT})`);
}

main().catch(e => { console.error(e); process.exit(1); });
