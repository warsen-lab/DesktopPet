// 从 assets/_stand_cut/ 的真实端坐帧程序化派生两套动作（保持照片实拍风格统一）：
//  angry：炸毛生气——轻微放大 + 左右抖动 + 交替微旋转（渲染层还会叠加怒气符号 fx）；
//  poop ：蹲下用力——整体压扁弓身 + 用力颤抖（渲染层还会叠加汗滴 fx）。
// 输出 assets/cat/angry_00~09.png 与 poop_00~09.png。跑完再执行 make-manifest.js。
// 运行：node tools/build-angry-poop-sprites.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CUT_DIR = path.join(__dirname, '..', 'assets', '_stand_cut');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'cat');
const TARGET_HEIGHT = 150;
const ALPHA_THRESHOLD = 24;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function unionBBox(files) {
  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  for (const f of files) {
    const { data, info } = await sharp(path.join(CUT_DIR, f)).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * channels + (channels - 1)] > ALPHA_THRESHOLD) {
          if (x < minL) minL = x; if (x > maxR) maxR = x;
          if (y < minT) minT = y; if (y > maxB) maxB = y;
        }
      }
    }
  }
  const pad = 6;
  return { left: minL - pad, top: minT - pad, width: maxR - minL + 1 + pad * 2, height: maxB - minT + 1 + pad * 2 };
}

async function composeBottomCenter(buf, canvasW, dx) {
  const meta = await sharp(buf).metadata();
  const left = Math.round((canvasW - meta.width) / 2) + dx;
  const top = TARGET_HEIGHT - meta.height;
  return sharp({ create: { width: canvasW, height: TARGET_HEIGHT, channels: 4, background: TRANSPARENT } })
    .composite([{ input: buf, left: Math.max(0, left), top: Math.max(0, top) }])
    .png().toBuffer();
}

async function main() {
  const files = fs.readdirSync(CUT_DIR).filter(f => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('assets/_stand_cut 下没有抠好的端坐帧');
  const bb = await unionBBox(files);
  console.log(`并集包围盒: ${bb.width}x${bb.height} @ (${bb.left},${bb.top})`);

  // 与 stand 一致的正放+倒放 10 帧无缝循环
  const order = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];

  // ---- angry：高度 146（留 4px 旋转余量），±2° 交替旋转 + 左右 2~3px 抖动 ----
  const rot = [-2, 2, -2, 2, -2, 2, -2, 2, -2, 2];
  const dxA = [-3, 3, -2, 2, -3, 3, -2, 2, -2, 2];
  let angryBufs = [], maxWA = 0;
  for (let i = 0; i < order.length; i++) {
    const buf = await sharp(path.join(CUT_DIR, files[order[i]]))
      .extract(bb)
      .resize({ height: 146 })
      .rotate(rot[i], { background: TRANSPARENT })
      .png().toBuffer();
    const meta = await sharp(buf).metadata();
    angryBufs.push(buf);
    if (meta.width > maxWA) maxWA = meta.width;
  }
  const canvasWA = maxWA + 10;
  for (let i = 0; i < angryBufs.length; i++) {
    fs.writeFileSync(path.join(OUT_DIR, `angry_${String(i).padStart(2, '0')}.png`),
      await composeBottomCenter(angryBufs[i], canvasWA, dxA[i]));
  }
  console.log(`angry：${angryBufs.length} 帧 (${canvasWA}x${TARGET_HEIGHT})`);

  // ---- poop：压扁到 0.86/0.89 交替（弓身+用力颤抖）+ 1px 左右微抖 ----
  const squash = [0.88, 0.86, 0.88, 0.86, 0.88, 0.86, 0.88, 0.86, 0.88, 0.86];
  const dxP = [0, 1, 0, -1, 0, 1, 0, -1, 0, 1];
  let poopBufs = [], maxWP = 0;
  for (let i = 0; i < order.length; i++) {
    const base = await sharp(path.join(CUT_DIR, files[order[i]]))
      .extract(bb)
      .resize({ height: TARGET_HEIGHT })
      .png().toBuffer({ resolveWithObject: true });
    const buf = await sharp(base.data)
      .resize({ width: Math.round(base.info.width * 1.06), height: Math.round(TARGET_HEIGHT * squash[i]), fit: 'fill' })
      .png().toBuffer();
    const meta = await sharp(buf).metadata();
    poopBufs.push(buf);
    if (meta.width > maxWP) maxWP = meta.width;
  }
  const canvasWP = maxWP + 8;
  for (let i = 0; i < poopBufs.length; i++) {
    fs.writeFileSync(path.join(OUT_DIR, `poop_${String(i).padStart(2, '0')}.png`),
      await composeBottomCenter(poopBufs[i], canvasWP, dxP[i]));
  }
  console.log(`poop：${poopBufs.length} 帧 (${canvasWP}x${TARGET_HEIGHT})，记得跑 make-manifest.js`);
}

main().catch(e => { console.error(e); process.exit(1); });
