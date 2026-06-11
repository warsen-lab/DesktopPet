// 从素材代表帧生成应用图标 build/icon.png（256x256，透明背景，居中等比放大）。
// electron-builder 会用它生成 Windows 安装包/exe 图标。运行：node tools/build-app-icon.js

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const CAT_DIR = path.join(__dirname, '..', 'assets', 'cat');
const OUT = path.join(__dirname, '..', 'build', 'icon.png');
const SIZE = 256;

async function main() {
  const prefer = ['stand_00.png', 'idle_00.png', 'walk_00.png'];
  const files = fs.readdirSync(CAT_DIR);
  const pick = prefer.find(p => files.includes(p)) || files.find(f => f.endsWith('.png'));
  if (!pick) throw new Error('assets/cat 下没有可用的 PNG 帧');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await sharp(path.join(CAT_DIR, pick))
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(OUT);
  console.log(`图标已生成：${OUT}（来源 ${pick}）`);
}

main().catch(e => { console.error(e); process.exit(1); });
