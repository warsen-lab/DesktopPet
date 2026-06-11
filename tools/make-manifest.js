// 扫描 assets/cat/ 下的 <动作>_<序号>.png（如 walk_00.png、rest_03.png），
// 自动生成 manifest.json。你把 AI 生成好的透明帧按命名规范丢进去，跑一下这个就能用。
// 运行：node tools/make-manifest.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CAT_DIR = path.join(__dirname, '..', 'assets', 'cat');
// 各动作默认播放帧率（可按需调整）。
const FPS = { idle: 10, rest: 8, stand: 6, walk: 13, run: 16, angry: 12, eat: 12, drag: 1, fall: 1 };

async function main() {
  const files = fs.readdirSync(CAT_DIR).filter(f => /^[a-z]+_\d+\.png$/.test(f));
  const groups = {};
  for (const f of files) {
    const m = f.match(/^([a-z]+)_(\d+)\.png$/);
    (groups[m[1]] ||= []).push(f);
  }
  if (!Object.keys(groups).length) throw new Error('assets/cat 下没有符合 <动作>_<序号>.png 命名的帧');

  const sets = {};
  for (const [name, list] of Object.entries(groups)) {
    list.sort();
    const dim = await sharp(path.join(CAT_DIR, list[0])).metadata();
    sets[name] = {
      pattern: `${name}_%02d.png`,
      frameCount: list.length,
      width: dim.width,
      height: dim.height,
      fps: FPS[name] || 12
    };
    console.log(`  ${name}: ${list.length} 帧, ${dim.width}x${dim.height}`);
  }
  fs.writeFileSync(path.join(CAT_DIR, 'manifest.json'), JSON.stringify({ sets }, null, 2));
  console.log('manifest.json 已生成。重启程序即可看到新素材。');
}

main().catch(e => { console.error(e); process.exit(1); });
