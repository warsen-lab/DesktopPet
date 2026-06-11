// Electron 主进程（多显示器版）：
//  - 每块显示器一个透明 / 置顶 / 点击穿透的覆盖窗口（Windows 透明窗口无法可靠跨多屏）。
//  - 宠物模拟(PetSim)在主进程统一运行（全局虚拟桌面坐标），每帧广播快照给所有窗口绘制。
//  - 悬停/拖拽判定、落地吃图标产生的「可还原遮挡」、托盘菜单都在主进程。

const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { PetSim } = require('./PetSim');

let windows = [];      // [{ win, display, offsetX, offsetY }]
let sim = null;
let loopTimer = null;
let lastT = 0;
let tray = null;
let spriteHalf = { w: 47, h: 75 };
let occlusions = [];   // 被「吃掉」的图标遮挡：[{id,x,y,w,h}]（全局坐标）
let occId = 1;

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf-8'));
    return { idleRestSeconds: Number(cfg.idleRestSeconds) || 30 };
  } catch { return { idleRestSeconds: 30 }; }
}

// 读取精灵清单（双动画集，含各帧 file:// URL）。无则 null。
function loadSpriteManifest() {
  try {
    const catDir = path.join(__dirname, '..', '..', 'assets', 'cat');
    const m = JSON.parse(fs.readFileSync(path.join(catDir, 'manifest.json'), 'utf-8'));
    const sets = {};
    for (const [name, s] of Object.entries(m.sets)) {
      const frames = [];
      for (let i = 0; i < s.frameCount; i++) {
        const file = s.pattern.replace('%02d', String(i).padStart(2, '0'));
        frames.push(pathToFileURL(path.join(catDir, file)).href);
      }
      sets[name] = { frames, width: s.width, height: s.height, fps: s.fps || 12 };
    }
    return { sets };
  } catch { return null; }
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

function pointInBounds(p, b) {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

function broadcastOcclusions() {
  for (const w of windows) {
    if (!w.win.isDestroyed()) w.win.webContents.send('occlusions', occlusions);
  }
}

function createWindows() {
  for (const w of windows) { if (!w.win.isDestroyed()) w.win.destroy(); }
  windows = [];

  const manifest = loadSpriteManifest();
  if (manifest) {
    let mw = 0, mh = 0;
    for (const s of Object.values(manifest.sets)) { mw = Math.max(mw, s.width); mh = Math.max(mh, s.height); }
    spriteHalf = { w: (mw / 2) * 0.9, h: (mh / 2) * 0.9 };
    if (sim) sim.setHalf(mw / 2, mh / 2);
  }

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
      win.webContents.send('init', { offsetX: entry.offsetX, offsetY: entry.offsetY, manifest });
      win.webContents.send('occlusions', occlusions);
    });
    windows.push(entry);
  }
}

function startLoop() {
  const world = worldBounds();
  const primary = screen.getPrimaryDisplay().bounds;
  const cfg = loadConfig();
  sim = new PetSim(world, { x: primary.x + primary.width / 2, y: primary.y + primary.height / 2 },
    { primary, idleRestSeconds: cfg.idleRestSeconds });
  sim.setHalf(spriteHalf.w / 0.9, spriteHalf.h / 0.9);
  lastT = Date.now();

  loopTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    const cursor = screen.getCursorScreenPoint();
    sim.update(dt, cursor);

    // 吃图标：到位后生成一个可还原遮挡。
    const eat = sim.takeEatRequest();
    if (eat) {
      occlusions.push({ id: occId++, ...eat });
      broadcastOcclusions();
    }

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

function restoreIcons() {
  if (!occlusions.length) return;
  occlusions = [];
  broadcastOcclusions();
}

ipcMain.on('drag-start', () => {
  if (!sim) return;
  const c = screen.getCursorScreenPoint();
  sim.startDrag(c.x, c.y);
});
ipcMain.on('drag-end', () => { if (sim) sim.endDrag(); });
ipcMain.on('restore-icons', restoreIcons);

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'cat', 'idle_00.png');
    let img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('桌面宠物');
    const menu = Menu.buildFromTemplate([
      { label: '还原被吃掉的图标', click: restoreIcons },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]);
    tray.setContextMenu(menu);
  } catch { /* 托盘失败不致命 */ }
}

function rebuild() {
  if (sim) { sim.setWorld(worldBounds()); sim.setConfig({ primary: screen.getPrimaryDisplay().bounds }); }
  createWindows();
}

app.whenReady().then(() => {
  startLoop();
  createWindows();
  createTray();
  screen.on('display-added', rebuild);
  screen.on('display-removed', rebuild);
  screen.on('display-metrics-changed', rebuild);
});

app.on('window-all-closed', () => { clearInterval(loopTimer); app.quit(); });
