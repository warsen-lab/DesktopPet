// 版本检查（主进程）：每次启动比对 GitHub 最新 Release，有新版只提示、不强更。
// 离线/限流/无 Release 一律静默失败；之后每 24 小时复查一次。

const { app, net, shell } = require('electron');

const REPO = 'warsen-lab/DesktopPet';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

let latest = null;   // { version:'0.3.0', url:'...' } —— 仅在比当前新时填充

function parseVer(v) {
  return String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
}

// a > b ?
function newer(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function fetchLatest() {
  return new Promise((resolve) => {
    try {
      const req = net.request({ url: RELEASES_API });
      req.setHeader('User-Agent', `DesktopPet/${app.getVersion()}`);
      req.setHeader('Accept', 'application/vnd.github+json');
      const timer = setTimeout(() => { try { req.abort(); } catch {} resolve(null); }, 10000);
      req.on('response', (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          clearTimeout(timer);
          try {
            if (res.statusCode !== 200) return resolve(null);
            const j = JSON.parse(body);
            resolve({ tag: j.tag_name || '', url: j.html_url || RELEASES_PAGE });
          } catch { resolve(null); }
        });
        res.on('error', () => { clearTimeout(timer); resolve(null); });
      });
      req.on('error', () => { clearTimeout(timer); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

// 检查一次。有新版返回 {version,url} 并缓存到 latest，否则 null。
async function checkForUpdate() {
  const r = await fetchLatest();
  if (!r || !r.tag) return null;
  const remote = String(r.tag).replace(/^v/i, '');
  if (newer(remote, app.getVersion())) {
    latest = { version: remote, url: r.url };
    return latest;
  }
  return null;
}

// 启动定期检查；发现新版时回调 onUpdate(latest)（用于刷新托盘菜单等）。
function startUpdateChecks(onUpdate) {
  const run = async () => {
    const u = await checkForUpdate();
    if (u && onUpdate) onUpdate(u);
  };
  setTimeout(run, 5000);                 // 启动 5 秒后查，不挡启动
  setInterval(run, CHECK_EVERY_MS);
}

function getLatest() { return latest; }
function openDownloadPage() { shell.openExternal((latest && latest.url) || RELEASES_PAGE); }

module.exports = { checkForUpdate, startUpdateChecks, getLatest, openDownloadPage, RELEASES_PAGE };
