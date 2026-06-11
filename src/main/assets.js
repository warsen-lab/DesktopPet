// 宠物素材管理（主进程）：素材与应用本体分离。
//  - 运行时素材目录：userData/pets/cat（升级/重装应用不会覆盖用户自定义素材）。
//  - 首次启动：从应用内置的「种子素材」复制一份过去；之后只要目录里有帧就绝不再动。
//  - manifest.json 可由主进程重建（用 nativeImage 读尺寸，不依赖 sharp，打包友好）。

const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 各动作默认播放帧率（与 tools/make-manifest.js 保持一致）。
const FPS = { idle: 10, rest: 8, stand: 6, walk: 13, run: 16, angry: 12, poop: 8, eat: 12, drag: 1, fall: 1 };

const FRAME_RE = /^([a-z]+)_(\d+)\.png$/;

// 用户素材目录（运行时唯一读取来源）。
function petsDir() {
  return path.join(app.getPath('userData'), 'pets', 'cat');
}

// 应用自带的种子素材目录：打包后在 resources/assets/cat，开发时在项目 assets/cat。
function bundledDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'cat')
    : path.join(__dirname, '..', '..', 'assets', 'cat');
}

function listFrames(dir) {
  try { return fs.readdirSync(dir).filter(f => FRAME_RE.test(f)); } catch { return []; }
}

// 首次启动（或用户清空了素材目录）时播种；目录里已有任何帧则绝不覆盖。
function ensurePetAssets() {
  const dst = petsDir();
  if (listFrames(dst).length > 0) return false;
  const src = bundledDir();
  const frames = listFrames(src);
  if (!frames.length) return false;          // 连种子都没有（异常安装），交给占位猫兜底
  fs.mkdirSync(dst, { recursive: true });
  for (const f of frames) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  const mf = path.join(src, 'manifest.json');
  if (fs.existsSync(mf)) fs.copyFileSync(mf, path.join(dst, 'manifest.json'));
  return true;
}

// 扫描素材目录重建 manifest.json（用户替换素材后从工坊窗口触发）。
// 返回 { sets: {name:{frameCount,width,height}}, errors: [] }；目录为空返回 null。
function rebuildManifest() {
  const dir = petsDir();
  const files = listFrames(dir);
  if (!files.length) return null;

  const groups = {};
  for (const f of files) {
    const m = f.match(FRAME_RE);
    (groups[m[1]] ||= []).push(f);
  }

  const sets = {};
  const errors = [];
  for (const [name, list] of Object.entries(groups)) {
    list.sort();
    const img = nativeImage.createFromPath(path.join(dir, list[0]));
    if (img.isEmpty()) { errors.push(`${name}: 首帧 ${list[0]} 无法读取，已跳过该动作`); continue; }
    const { width, height } = img.getSize();
    sets[name] = {
      pattern: `${name}_%02d.png`,
      frameCount: list.length,
      width, height,
      fps: FPS[name] || 12
    };
  }
  if (!Object.keys(sets).length) return null;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ sets }, null, 2));
  return { sets, errors };
}

// 读取精灵清单（含各帧 file:// URL）。manifest 缺失但有帧时自动重建。无素材返回 null。
function loadSpriteManifest() {
  const dir = petsDir();
  let m = null;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')); } catch { /* 下面重建 */ }
  if (!m || !m.sets || !Object.keys(m.sets).length) {
    const rebuilt = rebuildManifest();
    if (!rebuilt) return null;
    m = { sets: rebuilt.sets };
  }
  const sets = {};
  for (const [name, s] of Object.entries(m.sets)) {
    const frames = [];
    for (let i = 0; i < s.frameCount; i++) {
      const file = s.pattern.replace('%02d', String(i).padStart(2, '0'));
      frames.push(pathToFileURL(path.join(dir, file)).href);
    }
    sets[name] = { frames, width: s.width, height: s.height, fps: s.fps || 12 };
  }
  return { sets };
}

// 素材状态（工坊窗口展示）：每个动作集的帧数与尺寸，以及缺哪些推荐动作。
function assetStatus() {
  const dir = petsDir();
  const files = listFrames(dir);
  const groups = {};
  for (const f of files) {
    const m = f.match(FRAME_RE);
    (groups[m[1]] ||= []).push(f);
  }
  const sets = {};
  for (const [name, list] of Object.entries(groups)) {
    list.sort();
    const img = nativeImage.createFromPath(path.join(dir, list[0]));
    const size = img.isEmpty() ? null : img.getSize();
    sets[name] = { frameCount: list.length, width: size?.width ?? 0, height: size?.height ?? 0 };
  }
  return { dir, sets };
}

// 用户素材的代表帧（优先 stand，其次 idle，再退到任意第一帧）。无素材返回 null。
function representativeImage() {
  const dir = petsDir();
  const files = listFrames(dir);
  if (!files.length) return null;
  const prefer = ['stand_00.png', 'idle_00.png', 'walk_00.png'];
  const pick = prefer.find(p => files.includes(p)) || files.sort()[0];
  const img = nativeImage.createFromPath(path.join(dir, pick));
  return img.isEmpty() ? null : img;
}

// 等比缩放到指定高度（保持透明背景）。
function scaledIcon(targetH) {
  const img = representativeImage();
  if (!img) return null;
  const { width, height } = img.getSize();
  const w = Math.max(1, Math.round(targetH * (width / height)));
  return img.resize({ width: Math.min(w, targetH), height: targetH });
}

// 托盘图标（高 18px）/ 窗口图标（高 64px），都来自用户素材，替换素材重扫后即更新。
function trayIcon() { return scaledIcon(18); }
function windowIcon() { return scaledIcon(64); }

module.exports = { petsDir, bundledDir, ensurePetAssets, rebuildManifest, loadSpriteManifest, assetStatus, trayIcon, windowIcon };
