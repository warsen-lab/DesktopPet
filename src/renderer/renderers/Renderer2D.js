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

  // 按宠物状态选动画集：移动用 walk，其余（待机/拖拽/下落）用 idle。
  _setFor(state) {
    if ((state.state === 'walk' || state.state === 'run') && this.sets.walk) return this.sets.walk;
    return this.sets.idle || this.sets.walk;
  }

  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
  }

  render(state, dt) {
    const ctx = this.ctx;
    // 清空（保持透明）。
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.scale(state.facing * state.scale, state.scale);

    if (this.spriteReady) {
      this.drawSpriteFrame(ctx, state); // 真实宠物精灵
    } else {
      this.drawCat(ctx, state);         // 占位猫（精灵加载完成前）
    }

    ctx.restore();
  }

  hitTest(px, py, state) {
    if (this.spriteReady) {
      const set = this._setFor(state);
      const hw = (set.width / 2) * 0.9;
      const hh = (set.height / 2) * 0.9;
      return Math.abs(px - state.x) < hw && Math.abs(py - state.y) < hh;
    }
    return Math.hypot(px - state.x, py - state.y) < HIT_RADIUS;
  }

  // 画真实宠物精灵：地面软阴影 + 当前帧（乒乓循环，避免视频非完美循环的跳变）。
  drawSpriteFrame(ctx, state) {
    const set = this._setFor(state);
    const imgs = set.imgs;
    const n = imgs.length;
    // 乒乓索引：0..n-1..0，循环更顺滑。
    const cycle = Math.floor(state.animTime * set.fps);
    const period = (n - 1) * 2 || 1;
    const phase = cycle % period;
    const idx = phase < n ? phase : period - phase;
    const img = imgs[idx] || imgs[0];

    // 脚下软阴影（精灵已水平翻转，阴影画在本地坐标即可）。
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, set.height / 2 - 6, set.width * 0.42, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.drawImage(img, -set.width / 2, -set.height / 2, set.width, set.height);
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
