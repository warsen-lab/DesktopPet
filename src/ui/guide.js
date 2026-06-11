// 素材工坊窗口逻辑：展示素材目录与各动作集状态；打开文件夹；重扫并热重载。
const $ = (id) => document.getElementById(id);

// 推荐动作集（与 guide.html 卡片一致）。rest 与 idle 等价（idle 是 rest 的回退名）。
const KNOWN = ['walk', 'run', 'idle', 'rest', 'stand', 'angry', 'poop'];

function renderStatus(st) {
  $('petsDir').textContent = st.dir;

  // 每张姿势卡片的状态行
  for (const card of document.querySelectorAll('.pose')) {
    const name = card.dataset.set;
    const el = card.querySelector('[data-status]');
    // idle 卡片同时认 rest_*
    const s = st.sets[name] || (name === 'idle' ? st.sets.rest : undefined);
    if (s) {
      el.innerHTML = `<span class="ok">✓ 已有 ${s.frameCount} 帧（${s.width}×${s.height}）</span>`;
    } else {
      el.innerHTML = `<span class="warn">✗ 暂无 — 程序会自动回退到相近动作</span>`;
    }
  }

  // 状态总表（含用户自定义的非标准动作名）
  const rows = [];
  const names = [...new Set([...KNOWN.filter(n => st.sets[n]), ...Object.keys(st.sets)])];
  for (const n of names) {
    const s = st.sets[n];
    rows.push(`<tr><td><code>${n}</code></td><td>${s.frameCount}</td><td>${s.width}×${s.height}</td></tr>`);
  }
  $('statusTable').innerHTML = rows.join('') || '<tr><td colspan="3" class="warn">素材目录是空的 — 程序当前显示内置占位猫</td></tr>';
}

async function init() {
  renderStatus(await window.petUI.getAssetStatus());

  $('btnOpenFolder').addEventListener('click', () => window.petUI.openPetsFolder());

  $('btnRescan').addEventListener('click', async () => {
    $('rescanResult').textContent = '扫描中…';
    const r = await window.petUI.rescanAssets();
    renderStatus(r.status);
    if (r.ok) {
      $('rescanResult').innerHTML = r.errors.length
        ? `<span class="warn">已应用，但有问题：${r.errors.join('；')}</span>`
        : '<span class="ok">✓ 已应用新素材（托盘图标同步更新）</span>';
    } else {
      $('rescanResult').innerHTML = '<span class="warn">没有找到可用的帧（检查命名是否为 动作_两位序号.png）</span>';
    }
  });
}

init();
