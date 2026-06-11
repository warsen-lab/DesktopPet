// 2D 渲染器：用 canvas 直接画一只程序化的「占位猫」。
// 这一层就是以后替换的目标：把 drawCat() 换成「加载用户宠物照片生成的精灵帧」即可，
// 行为层与主进程完全不用动。drawSpriteFrame() 已经留好了接入位置。

import { PetRenderer } from '../core/PetRenderer.js';
import { PetState } from '../core/Pet.js';

const HIT_RADIUS = 46; // 命中测试半径（CSS 像素）

// 占位猫的配色（橘猫）。换成真实宠物精灵后这些就没用了。
const COLORS = {
  body: '#f4a94b',
  bodyDark: '#e08c2a',
  belly: '#fce8c8',
  ear: '#d97b2b',
  earInner: '#f6c79a',
  eye: '#2b2b2b',
  nose: '#c2566b',
  stroke: '#8a4f17'
};

export class Renderer2D extends PetRenderer {
  constructor() {
    super();
    this.canvas = null;
    this.ctx = null;
    this.dpr = window.devicePixelRatio || 1;
    // 真实宠物精灵（双动画集 idle/walk）：加载完成后 render 走精灵分支，否则回退到占位猫。
    this.sets = {};          // { idle:{imgs,width,height,fps}, walk:{...} }
    this.spriteReady = false;
  }

  init(canvas, width, height) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize(width, height);
  }

  // 由主进程把精灵清单（双动画集，含各帧 file:// URL）传进来，全部加载完成后启用。
  loadSprites(manifest) {
    if (!manifest || !manifest.sets) return; // 没生成精灵 → 用占位猫
    let total = 0, loaded = 0;
    const sets = {};
    for (const [name, s] of Object.entries(manifest.sets)) {
      const imgs = s.frames.map((url) => { const img = new Image(); img.src = url; return img; });
      sets[name] = { imgs, width: s.width, height: s.height, fps: s.fps || 12 };
      total += imgs.length;
    }
    const done = () => { if (++loaded === total) { this.sets = sets; this.spriteReady = true; } };
    for (const s of Object.values(sets)) {
      for (const img of s.imgs) {
        if (img.complete) done();
        else { img.onload = done; img.onerror = done; }
      }
    }
  }

  // 按宠物状态选动画集（带回退）：优先用与状态同名的集，没有就回退。
  //  walk/run/eat → walk(动)，rest → idle 躺(动)，stand/drag/fall/angry → 站立定帧。
  _animFor(state) {
    const pick = (n) => this.sets[n];
    const s = state.state;
    if (s === 'rest') return { set: pick('rest') || pick('idle') || pick('walk'), animated: true };
    if (s === 'walk' || s === 'run') return { set: pick('walk') || pick('idle'), animated: true };
    if (s === 'angry') return { set: pick('angry') || pick('walk') || pick('idle'), animated: !!pick('angry') };
    // stand / drag / fall / poop / 默认 → 站立定帧
    return { set: pick('stand') || pick('walk') || pick('idle'), animated: !!pick('stand') };
  }

  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
  }

  // 每帧先清空（保持透明）。
  clear() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // 画宠物（局部坐标）。
  drawPet(state) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.scale(state.facing * state.scale, state.scale);
    if (this.spriteReady) {
      this.drawSpriteFrame(ctx, state);
      this._drawFx(ctx, state);
    } else {
      this.drawCat(ctx, state);
    }
    ctx.restore();
  }

  // 画真实宠物精灵：地面软阴影 + 当前帧（乒乓循环，避免视频非完美循环跳变）。
  drawSpriteFrame(ctx, state) {
    const { set, animated } = this._animFor(state);
    if (!set) return;
    const imgs = set.imgs;
    const n = imgs.length;
    let idx = 0;
    if (animated) {
      const cycle = Math.floor(state.animTime * set.fps);
      const period = (n - 1) * 2 || 1;
      const phase = cycle % period;
      idx = phase < n ? phase : period - phase;
    }
    const img = imgs[idx] || imgs[0];

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, set.height / 2 - 6, set.width * 0.42, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.drawImage(img, -set.width / 2, -set.height / 2, set.width, set.height);
  }

  // 生气 / 拉屎 的程序化特效（没有专用精灵时也能读出状态）。
  _drawFx(ctx, state) {
    const { set } = this._animFor(state);
    const topY = set ? -set.height / 2 : -60;
    if (state.state === 'angry') {
      // 头顶「怒」气符号 + 轻微抖动。
      ctx.save();
      ctx.scale(state.facing, 1);                 // 抵消水平翻转，符号不镜像
      const jitter = Math.sin(state.animTime * 40) * 1.5;
      ctx.translate(set ? set.width * 0.28 : 18, topY + 14 + jitter);
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(2, 2); ctx.moveTo(2, -6); ctx.lineTo(-6, 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -8); ctx.lineTo(12, -2); ctx.moveTo(12, -8); ctx.lineTo(6, -2); ctx.stroke();
      ctx.restore();
    } else if (state.state === 'poop') {
      // 用力符号（头顶冒汗 + 抖动），表示正在拉。
      ctx.save();
      ctx.scale(state.facing, 1);
      const shake = Math.sin(state.animTime * 30) * 1.2;
      ctx.translate((set ? set.width * 0.3 : 20) + shake, topY + 10);
      ctx.fillStyle = '#7ec8ff';
      ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 4.4, 0, 0, Math.PI * 2); ctx.fill();   // 汗滴
      ctx.restore();
    }
  }

  // 画地上的大便（局部坐标）。可清理（清理后就不再传进来）。
  drawPoops(list) {
    const ctx = this.ctx;
    for (const p of list) {
      const x = p.x, y = p.y;
      if (x < -40 || y < -40 || x > this.canvas.width + 40 || y > this.canvas.height + 40) continue;
      ctx.save();
      ctx.translate(x, y);
      // 地面阴影
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); ctx.ellipse(0, 6, 17, 5, 0, 0, Math.PI * 2); ctx.fill();
      // 三层逐渐变小的「便便」堆
      const layers = [
        { y: 2, rx: 15, ry: 7, c: '#5a3a1e' },
        { y: -5, rx: 11, ry: 6, c: '#6e4a28' },
        { y: -11, rx: 7, ry: 4.5, c: '#7d5530' }
      ];
      for (const L of layers) {
        ctx.fillStyle = L.c;
        ctx.beginPath(); ctx.ellipse(0, L.y, L.rx, L.ry, 0, 0, Math.PI * 2); ctx.fill();
      }
      // 顶部尖
      ctx.fillStyle = '#7d5530';
      ctx.beginPath(); ctx.ellipse(0, -15, 3, 3, 0, 0, Math.PI * 2); ctx.fill();
      // 高光
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.ellipse(-4, -7, 3, 2, -0.5, 0, Math.PI * 2); ctx.fill();
      // 两道臭气
      ctx.strokeStyle = 'rgba(150,180,120,0.5)';
      ctx.lineWidth = 1.5;
      for (const ox of [-7, 7]) {
        ctx.beginPath();
        ctx.moveTo(ox, -16);
        ctx.quadraticCurveTo(ox + 4, -22, ox, -28);
        ctx.quadraticCurveTo(ox - 4, -34, ox, -40);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ——— 当前占位实现：程序化画一只猫 ———
  drawCat(ctx, state) {
    const t = state.animTime;
    const walking = state.state === PetState.WALK || state.state === PetState.RUN;
    const dragging = state.state === PetState.DRAG;
    const legSwing = walking ? Math.sin(state.walkPhase * 2) * 6 : 0;
    const tailWag = Math.sin(t * (walking ? 9 : 3)) * 0.5;

    // 影子（落在脚下，让它有「站在桌面上」的感觉）
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 30, 30, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.stroke;
    ctx.lineWidth = 2;

    // 尾巴（身后，会摆动）
    ctx.save();
    ctx.translate(-26, 6);
    ctx.rotate(tailWag - 0.4);
    ctx.fillStyle = COLORS.bodyDark;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-22, -6, -20, -28);
    ctx.quadraticCurveTo(-12, -20, -6, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 四条腿（走路时前后摆）
    const legY = 18;
    ctx.strokeStyle = COLORS.bodyDark;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    const legs = [-14, -4, 8, 18];
    legs.forEach((lx, i) => {
      const swing = (i % 2 === 0 ? legSwing : -legSwing);
      ctx.beginPath();
      ctx.moveTo(lx, legY - 6);
      ctx.lineTo(lx + swing * 0.3, legY + 12 + (dragging ? 4 : 0));
      ctx.stroke();
    });

    // 身体
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.stroke;
    ctx.fillStyle = COLORS.body;
    ctx.beginPath();
    ctx.ellipse(0, 6, 28, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 肚皮
    ctx.fillStyle = COLORS.belly;
    ctx.beginPath();
    ctx.ellipse(2, 12, 16, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // 头
    const headX = 20, headY = -8;
    ctx.fillStyle = COLORS.body;
    ctx.beginPath();
    ctx.arc(headX, headY, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 耳朵
    [[-8, -1], [8, 1]].forEach(([ox, dir]) => {
      ctx.fillStyle = COLORS.ear;
      ctx.beginPath();
      ctx.moveTo(headX + ox - 6 * dir, headY - 12);
      ctx.lineTo(headX + ox + 2 * dir, headY - 24);
      ctx.lineTo(headX + ox + 8 * dir, headY - 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.earInner;
      ctx.beginPath();
      ctx.moveTo(headX + ox - 1 * dir, headY - 13);
      ctx.lineTo(headX + ox + 3 * dir, headY - 20);
      ctx.lineTo(headX + ox + 5 * dir, headY - 12);
      ctx.closePath();
      ctx.fill();
    });

    // 眼睛（每几秒眨一次）
    const blink = (t % 3.4) > 3.2; // 短暂闭眼
    ctx.fillStyle = COLORS.eye;
    [[-6, 0], [6, 0]].forEach(([ex]) => {
      ctx.beginPath();
      if (blink) {
        ctx.rect(headX + ex - 3, headY - 1, 6, 1.6);
        ctx.fill();
      } else {
        ctx.arc(headX + ex, headY, 3, 0, Math.PI * 2);
        ctx.fill();
        // 高光
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(headX + ex + 1, headY - 1, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.eye;
      }
    });

    // 鼻子 + 嘴
    ctx.fillStyle = COLORS.nose;
    ctx.beginPath();
    ctx.moveTo(headX - 2, headY + 6);
    ctx.lineTo(headX + 2, headY + 6);
    ctx.lineTo(headX, headY + 8.5);
    ctx.closePath();
    ctx.fill();

    // 胡须
    ctx.strokeStyle = 'rgba(80,50,20,0.5)';
    ctx.lineWidth = 1;
    [[-1, -2], [-1, 0], [-1, 2]].forEach(([_, oy]) => {
      ctx.beginPath();
      ctx.moveTo(headX + 2, headY + 6 + oy);
      ctx.lineTo(headX + 18, headY + 4 + oy * 2);
      ctx.stroke();
    });

    // 被抓起时头顶冒个「!」感叹气泡
    if (dragging) {
      ctx.fillStyle = '#ff5a5a';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.scale(state.facing, 1); // 文字不要被水平翻转
      ctx.fillText('!', 0, -34);
    }
  }
}
