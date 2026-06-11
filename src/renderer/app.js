// 渲染进程入口（多屏版）：本窗口只覆盖一块显示器。
// 宠物状态由主进程统一模拟后通过 onState 推来（全局坐标），这里减去本屏偏移后绘制；
// 宠物在别的屏时，减完偏移会落到画布外，自然不显示。拖拽事件上报给主进程。

import { Renderer2D } from './renderers/Renderer2D.js';
// 以后换 3D：import { Renderer3D } from './renderers/Renderer3D.js';

const canvas = document.getElementById('stage');
let w = window.innerWidth;
let h = window.innerHeight;

const renderer = new Renderer2D();   // ← 想换 3D 就改这一行
renderer.init(canvas, w, h);

let offsetX = 0, offsetY = 0;
let snap = null;

window.petBridge?.onInit?.((data) => {
  offsetX = data.offsetX || 0;
  offsetY = data.offsetY || 0;
  if (data.manifest) renderer.loadSprites(data.manifest);
});

window.petBridge?.onState?.((s) => { snap = s; });

// 拖拽：窗口仅在「光标压在宠物身上」时被主进程设为可交互，所以这里的按下≈按在宠物上。
window.addEventListener('mousedown', () => window.petBridge?.dragStart?.());
window.addEventListener('mouseup', () => window.petBridge?.dragEnd?.());

window.addEventListener('resize', () => {
  w = window.innerWidth; h = window.innerHeight;
  renderer.resize(w, h);
});

function loop() {
  if (snap) {
    // 全局坐标 → 本屏局部坐标。
    renderer.render({ ...snap, x: snap.x - offsetX, y: snap.y - offsetY }, 0);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
