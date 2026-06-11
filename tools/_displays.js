// 一次性诊断：打印所有显示器布局与缩放，然后退出。
// 运行：node_modules/.bin/electron tools/_displays.js
const { app, screen } = require('electron');
app.whenReady().then(() => {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  console.log('DISPLAY_COUNT=' + all.length);
  all.forEach((d, i) => {
    console.log(`#${i} id=${d.id} primary=${d.id === primary.id} scale=${d.scaleFactor} ` +
      `bounds=${JSON.stringify(d.bounds)} workArea=${JSON.stringify(d.workArea)}`);
  });
  app.quit();
});
