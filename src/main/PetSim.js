// 宠物模拟（主进程，CommonJS）。全局虚拟桌面坐标(DIP)，各显示器窗口减自身偏移绘制。
// 状态机：跟随鼠标 / 静止超时原地休息 / 拖拽抛掷 / 落地生气 / 拉屎（生气后 + 随机定时）。
// 关键：钳制与落地都按「宠物当前所在那块屏的工作区」，避免越过屏幕可视边缘被裁。

const S = {
  WALK: 'walk', RUN: 'run', STAND: 'stand', REST: 'rest',
  DRAG: 'drag', FALL: 'fall', ANGRY: 'angry', POOP: 'poop'
};

const COMFORT_RADIUS = 90;      // 行走的目标间距：走到离鼠标这么近就够了
const ARRIVE_MARGIN = 10;       // 到达余量：走进 COMFORT_RADIUS+10 内即判定到达并停下（吸收浮点误差，杜绝原地踏步）
const FOLLOW_RADIUS = 135;      // 滞回外圈：站立时鼠标拉开到此距离才重新起步（防边界反复横跳）
const RUN_DISTANCE = 340;
const WALK_SPEED = 150;
const DEFAULT_RUN_SPEED = 520;
const GRAVITY = 2400;
const BOUNCE = 0.45;
const CURSOR_MOVE_EPS = 3;
const ANGRY_SECONDS = 1.4;
const POOP_SECONDS = 1.3;       // 蹲下拉屎的持续时间

class PetSim {
  // world:{minX,minY,maxX,maxY}; start:{x,y};
  // opts:{ idleRestSeconds, displays:[workArea...], poopMinSec, poopMaxSec }
  constructor(world, start, opts = {}) {
    this.world = world;
    this.displays = opts.displays || [];      // 各屏工作区 [{x,y,width,height}]
    this.idleRestSeconds = opts.idleRestSeconds ?? 30;
    this.poopMinSec = opts.poopMinSec ?? 3600;
    this.poopMaxSec = opts.poopMaxSec ?? 7200;
    this.runSpeed = opts.runSpeed ?? DEFAULT_RUN_SPEED;
    this.half = { w: 47, h: 75 };

    this.x = start.x; this.y = start.y;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.state = S.STAND;
    this.animTime = 0;
    this.walkPhase = 0;
    this.scale = 1;

    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.restTimer = 0;
    this.lastCursor = { x: start.x, y: start.y };
    this.angryTimer = 0;
    this.poopTimer = 0;
    this.poopRequest = null;       // 主进程消费：{x,y}
    this._resetPoopCountdown();
  }

  setWorld(world) { this.world = world; }
  setHalf(w, h) { this.half = { w, h }; }
  setDisplays(areas) { this.displays = areas || []; }
  setConfig(opts = {}) {
    if (opts.idleRestSeconds != null) this.idleRestSeconds = opts.idleRestSeconds;
    if (opts.poopMinSec != null) this.poopMinSec = opts.poopMinSec;
    if (opts.poopMaxSec != null) this.poopMaxSec = opts.poopMaxSec;
    if (opts.runSpeed != null) this.runSpeed = opts.runSpeed;
    // 拉屎间隔变了就按新区间重新倒计时（否则旧的超长倒计时可能拖到几小时后才生效）。
    if (opts.poopMinSec != null || opts.poopMaxSec != null) this._resetPoopCountdown();
  }

  _resetPoopCountdown() {
    const span = Math.max(1, this.poopMaxSec - this.poopMinSec);
    this.poopCountdown = this.poopMinSec + Math.random() * span;
  }

  // 宠物当前所在那块屏的工作区（不含任务栏）；不在任何屏内则取最近的。
  _areaAt(x, y) {
    let best = null, bestD = Infinity;
    for (const a of this.displays) {
      if (x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height) return a;
      const cx = Math.max(a.x, Math.min(a.x + a.width, x));
      const cy = Math.max(a.y, Math.min(a.y + a.height, y));
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) return best;
    return { x: this.world.minX, y: this.world.minY, width: this.world.maxX - this.world.minX, height: this.world.maxY - this.world.minY };
  }

  startDrag(cx, cy) {
    this.dragging = true;
    this.state = S.DRAG;
    this.dragOffset = { x: this.x - cx, y: this.y - cy };
    this.vx = 0; this.vy = 0;
    this.restTimer = 0;
  }

  endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.state = S.FALL;
  }

  update(dt, cursor) {
    this.animTime += dt;

    const movedDist = Math.hypot(cursor.x - this.lastCursor.x, cursor.y - this.lastCursor.y);
    const cursorMoving = movedDist > CURSOR_MOVE_EPS;
    if (cursorMoving) { this.restTimer = 0; this.lastCursor = { x: cursor.x, y: cursor.y }; }
    else { this.restTimer += dt; }

    if (this.dragging) {
      this._drag(cursor);
    } else {
      switch (this.state) {
        case S.FALL: this._fall(dt); break;
        case S.ANGRY: this._angry(dt); break;
        case S.POOP: this._poop(dt); break;
        default: this._normal(dt, cursor, cursorMoving); break;
      }
    }

    if (Math.abs(this.vx) > 5) this.facing = this.vx > 0 ? 1 : -1;
    this.walkPhase += Math.hypot(this.vx, this.vy) * dt * 0.06;
    this.scale = 1 + Math.sin(this.animTime * 2.2) * 0.03;

    this._clampToScreen();
  }

  _drag(cursor) {
    const nx = cursor.x + this.dragOffset.x;
    const ny = cursor.y + this.dragOffset.y;
    this.vx = (nx - this.x) * 12;
    this.vy = (ny - this.y) * 12;
    this.x = nx; this.y = ny;
    this.state = S.DRAG;
  }

  _fall(dt) {
    const a = this._areaAt(this.x, this.y);
    const floorY = a.y + a.height - this.half.h - 4;
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.98;
    if (this.x < a.x + this.half.w) { this.x = a.x + this.half.w; this.vx = Math.abs(this.vx) * BOUNCE; }
    if (this.x > a.x + a.width - this.half.w) { this.x = a.x + a.width - this.half.w; this.vx = -Math.abs(this.vx) * BOUNCE; }
    if (this.y >= floorY) {
      this.y = floorY;
      if (Math.abs(this.vy) > 120) { this.vy = -this.vy * BOUNCE; }
      else { this.vy = 0; this.vx = 0; this.state = S.ANGRY; this.angryTimer = ANGRY_SECONDS; }
    }
  }

  _angry(dt) {
    this.vx *= 0.8; this.vy *= 0.8;
    this.angryTimer -= dt;
    if (this.angryTimer <= 0) { this.state = S.POOP; this.poopTimer = POOP_SECONDS; } // 被摔后气得拉屎
  }

  _poop(dt) {
    this.vx = 0; this.vy = 0;
    this.poopTimer -= dt;
    if (this.poopTimer <= 0) {
      // 在屁股位置（脚下偏后）落下一坨。
      this.poopRequest = { x: this.x - this.facing * 16, y: this.y + this.half.h - 12 };
      this.state = S.STAND;
      this._resetPoopCountdown();
    }
  }

  _normal(dt, cursor, cursorMoving) {
    // 随机定时拉屎：倒计时到点且当前空闲（非拖拽/下落）就蹲下。
    this.poopCountdown -= dt;
    if (this.poopCountdown <= 0) { this.state = S.POOP; this.poopTimer = POOP_SECONDS; return; }

    if (!cursorMoving && this.restTimer >= this.idleRestSeconds) {
      this.vx *= 0.8; this.vy *= 0.8;
      this.state = S.REST;
      return;
    }
    const dx = cursor.x - this.x;
    const dy = cursor.y - this.y;
    const dist = Math.hypot(dx, dy);
    // 滞回 + 到达余量：杜绝「贴到鼠标边缘还在原地踏步、或边界处反复横跳切走/停」。
    //   - 站立时要等鼠标拉开到 FOLLOW_RADIUS 才重新起步；
    //   - 一旦行走，走进 COMFORT_RADIUS + ARRIVE_MARGIN 内就立刻判定到达 → 站立不动。
    // 中间地带（stopAt..FOLLOW_RADIUS）保持当前状态，光标微抖也不会触发走路。
    const moving = this.state === S.WALK || this.state === S.RUN;
    const stopAt = COMFORT_RADIUS + ARRIVE_MARGIN;
    if (moving ? dist > stopAt : dist > FOLLOW_RADIUS) {
      const running = dist > RUN_DISTANCE;
      const speed = running ? this.runSpeed : WALK_SPEED;
      this.state = running ? S.RUN : S.WALK;
      const ux = dx / dist, uy = dy / dist;
      const step = Math.min(speed * dt, dist - COMFORT_RADIUS);
      this.vx = ux * speed; this.vy = uy * speed;
      this.x += ux * step; this.y += uy * step;
    } else {
      this.vx *= 0.8; this.vy *= 0.8;
      this.state = S.STAND;
    }
  }

  _clampToScreen() {
    // X：用所有屏的并集范围钳制，允许横跨多屏（否则会被单屏边界挡住过不去）。
    this.x = Math.max(this.world.minX + this.half.w, Math.min(this.world.maxX - this.half.w, this.x));
    // Y：用「当前所在那块屏的工作区」钳制，防止越过该屏可视区下/上边缘被裁。
    const a = this._areaAt(this.x, this.y);
    this.y = Math.max(a.y + this.half.h, Math.min(a.y + a.height - this.half.h, this.y));
  }

  takePoopRequest() { const r = this.poopRequest; this.poopRequest = null; return r; }

  get snapshot() {
    return {
      x: this.x, y: this.y, facing: this.facing, state: this.state,
      animTime: this.animTime, walkPhase: this.walkPhase, scale: this.scale
    };
  }
}

module.exports = { PetSim, PetStates: S };
