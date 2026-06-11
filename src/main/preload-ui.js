// 设置 / 素材工坊窗口的预加载：暴露最小 invoke API，全部走主进程处理。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petUI', {
  // 设置
  getSettings: () => ipcRenderer.invoke('ui:get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('ui:save-settings', s),
  getAutoLaunch: () => ipcRenderer.invoke('ui:get-autolaunch'),
  setAutoLaunch: (v) => ipcRenderer.invoke('ui:set-autolaunch', v),
  // 版本与更新
  getVersion: () => ipcRenderer.invoke('ui:get-version'),
  checkUpdate: () => ipcRenderer.invoke('ui:check-update'),
  openDownload: () => ipcRenderer.invoke('ui:open-download'),
  // 素材
  openPetsFolder: () => ipcRenderer.invoke('ui:open-pets-folder'),
  getAssetStatus: () => ipcRenderer.invoke('ui:get-asset-status'),
  rescanAssets: () => ipcRenderer.invoke('ui:rescan-assets')
});
