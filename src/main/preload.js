// 暴露最小安全 API 给渲染进程。多屏版：宠物状态由主进程统一模拟后广播，
// 渲染进程只负责画 + 上报拖拽。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  // 初始化：本窗口所属显示器的偏移(offsetX/offsetY) + 精灵清单。
  onInit: (cb) => ipcRenderer.on('init', (_e, data) => cb(data)),
  // 每帧的宠物状态快照（全局坐标）。
  onState: (cb) => ipcRenderer.on('state', (_e, snap) => cb(snap)),
  // 地上的大便列表（全局坐标），变化时推送。
  onPoops: (cb) => ipcRenderer.on('poops', (_e, list) => cb(list)),
  // 上报拖拽开始/结束（光标坐标由主进程掌握）。
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  // 清理所有大便（右键宠物时调用）。
  cleanPoops: () => ipcRenderer.send('clean-poops'),
  // 3D 模式：主进程读出 .glb 字节（渲染进程的 file:// fetch 被 CSP/CORS 拦，走 IPC）。
  getModelData: () => ipcRenderer.invoke('pet:get-model-data')
});
