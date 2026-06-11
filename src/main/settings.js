// 用户设置（主进程）：存放在 userData/settings.json，与应用安装目录彻底分离，
// 升级/重装应用不会丢用户配置。首次启动时若项目根目录有旧版 config.json，迁移其值作默认。

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  idleRestSeconds: 30,   // 鼠标静止多少秒后宠物趴下休息
  poopMinMinutes: 60,    // 随机拉屎间隔下限（分钟）
  poopMaxMinutes: 120,   // 随机拉屎间隔上限（分钟）
  runSpeed: 520          // 快跑速度（像素/秒，建议 200–900）
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// 旧版配置（项目根目录 config.json）→ 仅在首次创建 settings.json 时作为默认值来源。
function legacyDefaults() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf-8'));
    return {
      idleRestSeconds: Number(c.idleRestSeconds) || undefined,
      poopMinMinutes: Number(c.poopMinMinutes) || undefined,
      poopMaxMinutes: Number(c.poopMaxMinutes) || undefined
    };
  } catch { return {}; }
}

function sanitize(s) {
  const out = { ...DEFAULTS, ...s };
  out.idleRestSeconds = Math.max(5, Math.min(600, Number(out.idleRestSeconds) || DEFAULTS.idleRestSeconds));
  out.poopMinMinutes = Math.max(1, Math.min(1440, Number(out.poopMinMinutes) || DEFAULTS.poopMinMinutes));
  out.poopMaxMinutes = Math.max(out.poopMinMinutes, Math.min(2880, Number(out.poopMaxMinutes) || DEFAULTS.poopMaxMinutes));
  out.runSpeed = Math.max(100, Math.min(1200, Number(out.runSpeed) || DEFAULTS.runSpeed));
  return out;
}

function loadSettings() {
  try {
    return sanitize(JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')));
  } catch {
    const initial = sanitize(legacyDefaults());
    try { saveSettings(initial); } catch { /* 写失败不致命，用内存值 */ }
    return initial;
  }
}

function saveSettings(s) {
  const clean = sanitize(s);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(clean, null, 2));
  return clean;
}

// 换算给 PetSim 用的运行时配置。
function toSimConfig(s) {
  return {
    idleRestSeconds: s.idleRestSeconds,
    poopMinSec: s.poopMinMinutes * 60,
    poopMaxSec: s.poopMaxMinutes * 60,
    runSpeed: s.runSpeed
  };
}

module.exports = { DEFAULTS, loadSettings, saveSettings, toSimConfig, settingsPath };
