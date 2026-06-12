// 渲染进程入口（多屏版）：本窗口只覆盖一块显示器。
// 宠物状态由主进程统一模拟后通过 onState 推来（全局坐标），这里减去本屏偏移后绘制。
// 渲染模式（2D 精灵 / 3D 模型）由设置决定，init 消息带来；3D 初始化失败自动回退 2D。

import { Renderer2D } from './renderers/Renderer2D.js';

let canvas = document.getElementById('stage');
let w = window.innerWidth;
let h = window.innerHeight;

let renderer = null;
let offsetX = 0, offsetY = 0;
let snap = null;
let poops = [];

// 2D 与 3D 需要不同的 canvas 上下文（同一元素拿过 2d 就拿不到 webgl），
// 切换/回退时换一块新画布。
function freshCanvas() {
  const c = document.createElement('canvas');
  c.id = 'stage';
  canvas.replaceWith(c);
  canvas = c;
  return c;
}

function use2D() {
  const r = new Renderer2D();
  r.init(freshCanvas(), w, h);
  return r;
}

// 按模式创建渲染器。3D：动态加载 three 渲染器 + 主进程读 .glb 字节，任一环节失败回退 2D。
async function makeRenderer(mode) {
  if (mode === '3d') {
    try {
      const bytes = await window.petBridge?.getModelData?.();
      if (bytes && bytes.byteLength) {
        const { Renderer3D } = await import('./renderers/Renderer3D.js');
        const r = new Renderer3D();
        r.init(freshCanvas(), w, h);
        if (await r.loadModel(bytes)) return r;
        r.dispose();
      } else {
        console.warn('[app] 未找到 3D 模型文件，回退 2D');
      }
    } catch (e) {
      console.error('[app] 3D 渲染器初始化失败，回退 2D', e);
    }
  }
  return use2D();
}

window.petBridge?.onInit?.(async (data) => {
  offsetX = data.offsetX || 0;
  offsetY = data.offsetY || 0;
  if (!renderer) {
    renderer = await makeRenderer(data.renderMode);
  }
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
  renderer?.resize(w, h);
});

function loop() {
  if (renderer) {
    renderer.clear();
    // 大便：全局 → 本屏局部。
    renderer.drawPoops(poops.length
      ? poops.map(p => ({ ...p, x: p.x - offsetX, y: p.y - offsetY }))
      : []);
    if (snap) {
      renderer.drawPet({ ...snap, x: snap.x - offsetX, y: snap.y - offsetY });
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
