// 阶段A：只做背景抠除（@imgly/onnxruntime），输出整幅透明 PNG 到 assets/_cut/。
// 单独成进程，避免与 sharp 的原生库（libvips）同进程加载导致段错误。
// 运行：node tools/01-remove-bg.js

const fs = require('fs');
const path = require('path');
const { removeBackground } = require('@imgly/background-removal-node');

// 可传入自定义输入/输出目录：node 01-remove-bg.js <framesDir> <cutDir>
const FRAMES_DIR = process.argv[2] || path.join(__dirname, '..', 'assets', '_frames');
const CUT_DIR = process.argv[3] || path.join(__dirname, '..', 'assets', '_cut');

async function main() {
  fs.mkdirSync(CUT_DIR, { recursive: true });
  const files = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('assets/_frames 下没有帧');

  console.log(`抠图中，共 ${files.length} 帧（首帧加载模型，稍慢）...`);
  for (let i = 0; i < files.length; i++) {
    const bytes = fs.readFileSync(path.join(FRAMES_DIR, files[i]));
    const blob = await removeBackground(new Blob([bytes], { type: 'image/png' }), {
      output: { format: 'image/png' }
    });
    const buf = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(path.join(CUT_DIR, `cut_${String(i).padStart(2, '0')}.png`), buf);
    process.stdout.write(`\r  ${i + 1}/${files.length}`);
  }
  console.log('\n阶段A完成 → assets/_cut/');
}

main().catch(e => { console.error(e); process.exit(1); });
