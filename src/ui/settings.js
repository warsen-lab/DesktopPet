// 设置窗口逻辑：读 → 显示 → 改动即保存即生效（主进程 sim.setConfig + 写 settings.json）。
const $ = (id) => document.getElementById(id);

let saving = null; // 防抖定时器

function debounceSave(partial) {
  clearTimeout(saving);
  saving = setTimeout(async () => {
    const s = await window.petUI.saveSettings(partial);
    render(s); // 用主进程清洗后的值回填（min/max 互相钳制等）
  }, 200);
}

function fmtMin(n) { return n >= 60 ? `${(n / 60).toFixed(n % 60 ? 1 : 0)} 小时` : `${n} 分钟`; }

function render(s) {
  $('idleRest').value = s.idleRestSeconds;
  $('idleRestVal').textContent = `${s.idleRestSeconds} 秒`;
  $('poopMin').value = s.poopMinMinutes;
  $('poopMinVal').textContent = fmtMin(s.poopMinMinutes);
  $('poopMax').value = s.poopMaxMinutes;
  $('poopMaxVal').textContent = fmtMin(s.poopMaxMinutes);
  $('runSpeed').value = s.runSpeed;
  $('runSpeedVal').textContent = `${s.runSpeed} px/s`;
}

function showUpdate(latest) {
  if (!latest) return;
  $('updateText').textContent = `发现新版本 v${latest.version}，建议更新。`;
  $('updateBanner').classList.add('show');
}

async function init() {
  render(await window.petUI.getSettings());

  // 行为滑条：拖动实时显示，松手（input 事件防抖）保存。
  $('idleRest').addEventListener('input', (e) => {
    $('idleRestVal').textContent = `${e.target.value} 秒`;
    debounceSave({ idleRestSeconds: Number(e.target.value) });
  });
  $('poopMin').addEventListener('input', (e) => {
    $('poopMinVal').textContent = fmtMin(Number(e.target.value));
    debounceSave({ poopMinMinutes: Number(e.target.value) });
  });
  $('poopMax').addEventListener('input', (e) => {
    $('poopMaxVal').textContent = fmtMin(Number(e.target.value));
    debounceSave({ poopMaxMinutes: Number(e.target.value) });
  });
  $('runSpeed').addEventListener('input', (e) => {
    $('runSpeedVal').textContent = `${e.target.value} px/s`;
    debounceSave({ runSpeed: Number(e.target.value) });
  });

  // 开机自启
  const info = await window.petUI.getVersion();
  $('autoLaunch').checked = await window.petUI.getAutoLaunch();
  if (!info.packaged) {
    $('autoLaunchHint').textContent = '（开发模式下此开关对安装版才有效）';
  }
  $('autoLaunch').addEventListener('change', async (e) => {
    e.target.checked = await window.petUI.setAutoLaunch(e.target.checked);
  });

  // 版本与更新
  $('version').textContent = `v${info.version}`;
  showUpdate(info.latest);
  $('btnDownload').addEventListener('click', () => window.petUI.openDownload());
  $('btnCheck').addEventListener('click', async () => {
    $('checkResult').textContent = '正在检查…';
    const u = await window.petUI.checkUpdate();
    if (u) {
      $('checkResult').textContent = `发现新版本 v${u.version}！`;
      showUpdate(u);
    } else {
      $('checkResult').textContent = '已是最新版本（或暂时无法连接更新服务器）。';
    }
  });
}

init();
