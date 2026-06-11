// Electron 主进程（多显示器版）：
//  - 每块显示器创建一个透明 / 置顶 / 点击穿透的覆盖窗口（Windows 上透明窗口无法可靠跨多屏，
//    所以一屏一个窗口）。
//  - 宠物模拟(PetSim)在主进程统一运行，用全局虚拟桌面坐标；每帧把快照广播给所有窗口，
//    各窗口减去自己显示器的偏移来绘制 → 宠物可跨屏、混合 DPI 也正确。
//  - 悬停判定与点击穿透切换也在主进程做（它掌握宠物坐标+全局光标+各屏边界）。

const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { PetSim } = require('./PetSim');

let windows = [];      // [{ win, display, offsetX, offsetY }]
let sim = null;
let loopTimer = null;
let lastT = 0;
let spriteHalf = { w: 46, h: 46 };

// 读取精灵清单（双动画集 idle/walk，含各帧 file:// URL）。无则 null。
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
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  return { minX, minY, maxX, maxY };
}

function pointInBounds(p, b) {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

function createWindows() {
  // 销毁旧窗口（显示器变化时重建）。
  for (const w of windows) { if (!w.win.isDestroyed()) w.win.destroy(); }
  windows = [];

  const manifest = loadSpriteManifest();
  if (manifest) {
    // 悬停判定用最大那套的尺寸，保证拖拽好点中。
    let mw = 0, mh = 0;
    for (const s of Object.values(manifest.sets)) { mw = Math.max(mw, s.width); mh = Math.max(mh, s.height); }
    spriteHalf = { w: (mw / 2) * 0.9, h: (mh / 2) * 0.9 };
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
    });
    windows.push(entry);
  }
}

function startLoop() {
  const world = worldBounds();
  const primary = screen.getPrimaryDisplay().bounds;
  sim = new PetSim(world, { x: primary.x + primary.width / 2, y: primary.y + primary.height / 2 });
  lastT = Date.now();

  loopTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    const cursor = screen.getCursorScreenPoint();
    sim.update(dt, cursor);
    const snap = sim.snapshot;

    // 悬停：光标是否压在宠物身上（全局坐标）。
    const hover = Math.abs(cursor.x - snap.x) < spriteHalf.w &&
                  Math.abs(cursor.y - snap.y) < spriteHalf.h;

    for (const w of windows) {
      if (w.win.isDestroyed()) continue;
      // 只有「光标所在那块屏」的窗口在悬停/拖拽时变可交互，其余保持穿透。
      const cursorHere = pointInBounds(cursor, w.display.bounds);
      const interactive = (hover || sim.dragging) && cursorHere;
      w.win.setIgnoreMouseEvents(!interactive, { forward: true });
      w.win.webContents.send('state', snap);
    }
  }, 16);
}

ipcMain.on('drag-start', () => {
  if (!sim) return;
  const c = screen.getCursorScreenPoint();
  sim.startDrag(c.x, c.y);
});
ipcMain.on('drag-end', () => { if (sim) sim.endDrag(); });

function rebuild() {
  if (sim) sim.setWorld(worldBounds());
  createWindows();
}

app.whenReady().then(() => {
  createWindows();
  startLoop();
  screen.on('display-added', rebuild);
  screen.on('display-removed', rebuild);
  screen.on('display-metrics-changed', rebuild);
});

app.on('window-all-closed', () => { clearInterval(loopTimer); app.quit(); });
