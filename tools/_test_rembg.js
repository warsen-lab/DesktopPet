const fs = require('fs');
const { removeBackground } = require('@imgly/background-removal-node');
(async () => {
  const bytes = fs.readFileSync('assets/_frames/f_012.png');
  const blob = await removeBackground(new Blob([bytes], { type: 'image/png' }), { output: { format: 'image/png' } });
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync('assets/cat/_test.png', buf);
  console.log('OK bytes=', buf.length);
})().catch(e => { console.error('ERR', e); process.exit(1); });
