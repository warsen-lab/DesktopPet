// 渲染进程入口（多屏版）：本窗口只覆盖一块显示器。
// 宠物状态由主进程统一模拟后通过 onState 推来（全局坐标），这里减去本屏偏移后绘制。
// 被吃掉的图标遮挡由 onOcclusions 推来，也按本屏偏移绘制。拖拽/还原事件上报主进程。

import { Renderer2D } from './renderers/Renderer2D.js';
// 以后换 3D：import { Renderer3D } from './renderers/Renderer3D.js';

const canvas = document.getElementById('stage');
let w = window.innerWidth;
let h = window.innerHeight;

const renderer = new Renderer2D();   // ← 想换 3D 就改这一行
renderer.init(canvas, w, h);

let offsetX = 0, offsetY = 0;
let snap = null;
let poops = [];

window.petBridge?.onInit?.((data) => {
  offsetX = data.offsetX || 0;
  offsetY = data.offsetY || 0;
  if (data.manifest) renderer.loadSprites(data.manifest);
});

window.petBridge?.onState?.((s) => { snap = s; });
window.petBridge?.onPoops?.((list) => { poops = list || []; });

// 拖拽：窗口仅在「光标压在宠物身上」时可交互，故这里按下≈按在宠物上。
window.addEventListener('mousedown', (e) => {
  if (e.button === 0) window.petBridge?.dragStart?.();
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) window.petBridge?.dragEnd?.();
});
// 右键宠物 → 清理所有大便。
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petBridge?.cleanPoops?.();
});

window.addEventListener('resize', () => {
  w = window.innerWidth; h = window.innerHeight;
  renderer.resize(w, h);
});

function loop() {
  renderer.clear();
  // 大便：全局 → 本屏局部。
  if (poops.length) {
    renderer.drawPoops(poops.map(p => ({ ...p, x: p.x - offsetX, y: p.y - offsetY })));
  }
  if (snap) {
    renderer.drawPet({ ...snap, x: snap.x - offsetX, y: snap.y - offsetY });
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
