// Electron 主进程（多显示器版）：
//  - 每块显示器一个透明 / 置顶 / 点击穿透的覆盖窗口（Windows 透明窗口无法可靠跨多屏）。
//  - 宠物模拟(PetSim)在主进程统一运行（全局虚拟桌面坐标），每帧广播快照给所有窗口绘制。
//  - 素材与配置都放 userData（与安装目录分离，升级不丢用户自定义）：见 assets.js / settings.js。
//  - 托盘图标取用户素材帧；菜单含 设置 / 素材工坊 / 清理大便；启动后台检查新版本（updater.js）。

const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { PetSim } = require('./PetSim');
const assets = require('./assets');
const { loadSettings, saveSettings, toSimConfig } = require('./settings');
const updater = require('./updater');

let windows = [];      // 覆盖窗口 [{ win, display, offsetX, offsetY }]
let sim = null;
let loopTimer = null;
let lastT = 0;
let tray = null;
let spriteHalf = { w: 47, h: 75 };
let poops = [];        // 地上的大便：[{id,x,y}]（全局坐标）
let poopId = 1;
let settings = null;
let manifest = null;
let settingsWin = null;
let guideWin = null;

// 单实例：第二次启动只把设置窗口拉起来。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettingsWindow());
}

// 3D 模型在屏幕上的近似尺寸（高 140px，与 Renderer3D 的 MODEL_PX_H 保持一致），用于命中/钳制。
const MODEL_HALF = { w: 80, h: 70 };

function applyManifestSize() {
  if (settings?.renderMode === '3d') {
    spriteHalf = { ...MODEL_HALF };
    if (sim) sim.setHalf(MODEL_HALF.w, MODEL_HALF.h);
    return;
  }
  if (!manifest) return;
  let mw = 0, mh = 0;
  for (const s of Object.values(manifest.sets)) { mw = Math.max(mw, s.width); mh = Math.max(mh, s.height); }
  spriteHalf = { w: (mw / 2) * 0.9, h: (mh / 2) * 0.9 };
  if (sim) sim.setHalf(mw / 2, mh / 2);
}

function worldBounds() {
  const ds = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of ds) {
    minX = Math.min(minX, d.bounds.x); minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width); maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  return { minX, minY, maxX, maxY };
}

// 各屏「工作区」（不含任务栏）——宠物钳制与落地用，保证不越过可视窗口被裁。
function workAreas() {
  return screen.getAllDisplays().map(d => ({ ...d.workArea }));
}

function pointInBounds(p, b) {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

function broadcastPoops() {
  for (const w of windows) {
    if (!w.win.isDestroyed()) w.win.webContents.send('poops', poops);
  }
}

function createWindows() {
  for (const w of windows) { if (!w.win.isDestroyed()) w.win.destroy(); }
  windows = [];

  for (const d of screen.getAllDisplays()) {
    const win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
      fullscreenable: false, focusable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    const entry = { win, display: d, offsetX: d.bounds.x, offsetY: d.bounds.y };
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('init', { offsetX: entry.offsetX, offsetY: entry.offsetY, manifest, renderMode: settings.renderMode });
      win.webContents.send('poops', poops);
    });
    windows.push(entry);
  }
}

function startLoop() {
  const world = worldBounds();
  const primary = screen.getPrimaryDisplay().bounds;
  sim = new PetSim(world, { x: primary.x + primary.width / 2, y: primary.y + primary.height / 2 }, {
    ...toSimConfig(settings),
    displays: workAreas()
  });
  sim.setHalf(spriteHalf.w / 0.9, spriteHalf.h / 0.9);
  lastT = Date.now();

  loopTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    const cursor = screen.getCursorScreenPoint();
    sim.update(dt, cursor);

    // 拉屎：在屁股位置落一坨大便。
    const poop = sim.takePoopRequest();
    if (poop) { poops.push({ id: poopId++, ...poop }); broadcastPoops(); }

    const snap = sim.snapshot;
    const hover = Math.abs(cursor.x - snap.x) < spriteHalf.w &&
                  Math.abs(cursor.y - snap.y) < spriteHalf.h;

    for (const w of windows) {
      if (w.win.isDestroyed()) continue;
      const cursorHere = pointInBounds(cursor, w.display.bounds);
      const interactive = (hover || sim.dragging) && cursorHere;
      w.win.setIgnoreMouseEvents(!interactive, { forward: true });
      w.win.webContents.send('state', snap);
    }
  }, 16);
}

function cleanPoops() {
  if (!poops.length) return;
  poops = [];
  broadcastPoops();
}

// ——— 素材热重载：工坊窗口「重新扫描」后调用 ———
function reloadAssets() {
  const rebuilt = assets.rebuildManifest();
  manifest = assets.loadSpriteManifest();
  applyManifestSize();
  for (const w of windows) {
    if (!w.win.isDestroyed()) {
      w.win.webContents.send('init', { offsetX: w.offsetX, offsetY: w.offsetY, manifest, renderMode: settings.renderMode });
    }
  }
  refreshTrayIcon();
  return { ok: !!manifest, errors: rebuilt?.errors || [], status: assets.assetStatus() };
}

// ——— 普通 UI 窗口（设置 / 素材工坊）———
function uiWindow(file, opts) {
  const win = new BrowserWindow({
    width: opts.width, height: opts.height,
    resizable: true, minimizable: true, maximizable: false,
    autoHideMenuBar: true, title: opts.title,
    icon: assets.windowIcon() || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'ui', file));
  return win;
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = uiWindow('settings.html', { width: 480, height: 640, title: '桌面宠物 — 设置' });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openGuideWindow() {
  if (guideWin && !guideWin.isDestroyed()) { guideWin.show(); guideWin.focus(); return; }
  guideWin = uiWindow('guide.html', { width: 860, height: 760, title: '桌面宠物 — 素材工坊' });
  guideWin.on('closed', () => { guideWin = null; });
}

// ——— IPC：覆盖窗口（拖拽/清理）———
ipcMain.on('drag-start', () => {
  if (!sim) return;
  const c = screen.getCursorScreenPoint();
  sim.startDrag(c.x, c.y);
});
ipcMain.on('drag-end', () => { if (sim) sim.endDrag(); });
ipcMain.on('clean-poops', cleanPoops);
// 3D 模型字节：主进程读文件给渲染进程（路径不外漏，渲染进程也碰不到 fs）。
ipcMain.handle('pet:get-model-data', () => {
  const p = assets.modelPath();
  if (!p) return null;
  try { return require('fs').readFileSync(p); } catch { return null; }
});

// ——— IPC：设置 / 素材工坊窗口 ———
ipcMain.handle('ui:get-settings', () => settings);
ipcMain.handle('ui:save-settings', (_e, s) => {
  const prevMode = settings.renderMode;
  settings = saveSettings({ ...settings, ...s });
  if (sim) sim.setConfig(toSimConfig(settings));
  // 渲染模式变了 → 更新命中尺寸并重建覆盖窗口（渲染器在窗口加载时按模式创建）。
  if (settings.renderMode !== prevMode) {
    applyManifestSize();
    createWindows();
  }
  return settings;
});
ipcMain.handle('ui:get-model-status', () => ({ path: assets.modelPath() }));
ipcMain.handle('ui:get-autolaunch', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('ui:set-autolaunch', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('ui:get-version', () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  latest: updater.getLatest()
}));
ipcMain.handle('ui:check-update', async () => {
  const u = await updater.checkForUpdate();
  if (u) refreshTrayMenu();
  return u;
});
ipcMain.handle('ui:open-download', () => { updater.openDownloadPage(); });
ipcMain.handle('ui:open-pets-folder', () => shell.openPath(assets.petsDir()));
ipcMain.handle('ui:get-asset-status', () => assets.assetStatus());
ipcMain.handle('ui:rescan-assets', () => reloadAssets());

// ——— 托盘 ———
function refreshTrayIcon() {
  if (!tray) return;
  try {
    const img = assets.trayIcon();
    tray.setImage(img || nativeImage.createEmpty());
  } catch { /* 托盘失败不致命 */ }
}

function refreshTrayMenu() {
  if (!tray) return;
  const latest = updater.getLatest();
  const items = [];
  if (latest) {
    items.push(
      { label: `有新版本 v${latest.version}，点击下载`, click: () => updater.openDownloadPage() },
      { type: 'separator' }
    );
  }
  items.push(
    { label: '设置', click: openSettingsWindow },
    { label: '宠物素材工坊', click: openGuideWindow },
    { type: 'separator' },
    { label: '清理大便', click: cleanPoops },
    { type: 'separator' },
    { label: `当前版本 v${app.getVersion()}`, enabled: false },
    { label: '退出', click: () => app.quit() }
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  try {
    tray = new Tray(assets.trayIcon() || nativeImage.createEmpty());
    tray.setToolTip(`桌面宠物 v${app.getVersion()}`);
    tray.on('double-click', openSettingsWindow);
    refreshTrayMenu();
  } catch { /* 托盘失败不致命 */ }
}

function rebuild() {
  if (sim) { sim.setWorld(worldBounds()); sim.setDisplays(workAreas()); }
  createWindows();
}

app.whenReady().then(() => {
  settings = loadSettings();
  assets.ensurePetAssets();                 // 首启播种到 userData，已有用户素材绝不覆盖
  assets.ensureModelAssets();               // 同样播种内置 3D 模型（用户已有 .glb 绝不覆盖）
  manifest = assets.loadSpriteManifest();
  applyManifestSize();

  startLoop();
  createWindows();
  createTray();
  updater.startUpdateChecks(() => refreshTrayMenu());   // 发现新版 → 托盘菜单出现下载入口

  screen.on('display-added', rebuild);
  screen.on('display-removed', rebuild);
  screen.on('display-metrics-changed', rebuild);
});

app.on('window-all-closed', () => { clearInterval(loopTimer); app.quit(); });
