// 暴露最小安全 API 给渲染进程。多屏版：宠物状态由主进程统一模拟后广播，
// 渲染进程只负责画 + 上报拖拽。
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const DEBUG_LOG = path.join(__dirname, '..', '..', 'assets', '_debug.log');

contextBridge.exposeInMainWorld('petBridge', {
  // 初始化：本窗口所属显示器的偏移(offsetX/offsetY) + 精灵清单。
  onInit: (cb) => ipcRenderer.on('init', (_e, data) => cb(data)),
  // 每帧的宠物状态快照（全局坐标）。
  onState: (cb) => ipcRenderer.on('state', (_e, snap) => cb(snap)),
  // 被「吃掉」的图标遮挡列表（全局坐标），变化时推送。
  onOcclusions: (cb) => ipcRenderer.on('occlusions', (_e, list) => cb(list)),
  // 上报拖拽开始/结束（光标坐标由主进程掌握）。
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  // 还原所有被吃掉的图标（右键宠物时调用）。
  restoreIcons: () => ipcRenderer.send('restore-icons'),
  // 临时调试。
  debug: (msg) => { try { fs.appendFileSync(DEBUG_LOG, msg + '\n'); } catch {} }
});
