// 宠物模拟（主进程，CommonJS）。全局虚拟桌面坐标(DIP)，各显示器窗口减自身偏移绘制。
// 状态机：跟随鼠标 / 静止超时后原地休息 / 拖拽抛掷 / 落地生气 / 走去吃图标。

const S = {
  WALK: 'walk',   // 走向光标
  RUN: 'run',     // 远距离快跑
  STAND: 'stand', // 到达光标附近、警觉站立（休息超时前）
  REST: 'rest',   // 静止超时后趴下休息
  DRAG: 'drag',   // 被拖拽
  FALL: 'fall',   // 松手后自由落体
  ANGRY: 'angry', // 落地后生气
  EAT: 'eat'      // 走向图标并吃掉
};

const COMFORT_RADIUS = 90;
const RUN_DISTANCE = 340;
const WALK_SPEED = 150;
const RUN_SPEED = 520;
const GRAVITY = 2400;
const BOUNCE = 0.45;
const CURSOR_MOVE_EPS = 3;     // 光标位移超过此值才算「在动」
const ANGRY_SECONDS = 1.6;     // 生气持续时间
const EAT_SPEED = 260;         // 走去吃图标的速度

class PetSim {
  // world:{minX,minY,maxX,maxY} 虚拟桌面外接矩形；start:{x,y}；
  // opts:{ idleRestSeconds, primary:{x,y,width,height} }
  constructor(world, start, opts = {}) {
    this.world = world;
    this.primary = opts.primary || { x: 0, y: 0, width: 1920, height: 1080 };
    this.idleRestSeconds = opts.idleRestSeconds ?? 30;
    this.half = { w: 47, h: 75 };   // 精灵半宽高，主进程按清单设置，用于钳制不出屏

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
    this.eatTarget = null;
    this.eatRequest = null;         // 主进程消费：{x,y,w,h}
  }

  setWorld(world) { this.world = world; }
  setHalf(w, h) { this.half = { w, h }; }
  setConfig(opts = {}) {
    if (opts.idleRestSeconds != null) this.idleRestSeconds = opts.idleRestSeconds;
    if (opts.primary) this.primary = opts.primary;
  }

  get floorY() { return this.world.maxY - this.half.h - 4; }

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
    this.state = S.FALL;   // 松手 → 自由落体
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
        case S.EAT: this._eat(dt); break;
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
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.98;
    const { minX, maxX } = this.world;
    if (this.x < minX + this.half.w) { this.x = minX + this.half.w; this.vx = Math.abs(this.vx) * BOUNCE; }
    if (this.x > maxX - this.half.w) { this.x = maxX - this.half.w; this.vx = -Math.abs(this.vx) * BOUNCE; }
    if (this.y >= this.floorY) {
      this.y = this.floorY;
      if (Math.abs(this.vy) > 120) { this.vy = -this.vy * BOUNCE; }
      else { this.vy = 0; this.vx = 0; this.state = S.ANGRY; this.angryTimer = ANGRY_SECONDS; }
    }
  }

  _angry(dt) {
    this.vx *= 0.8; this.vy *= 0.8;
    this.angryTimer -= dt;
    if (this.angryTimer <= 0) {
      this.eatTarget = this._nearestIconCell();
      this.state = S.EAT;
    }
  }

  _eat(dt) {
    if (!this.eatTarget) { this.state = S.STAND; return; }
    const dx = this.eatTarget.x - this.x;
    const dy = this.eatTarget.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) {
      // 到位 → 请求主进程在此处生成一个可还原的遮挡（吃掉图标）。
      this.eatRequest = { x: this.eatTarget.x, y: this.eatTarget.y, w: 72, h: 84 };
      this.eatTarget = null;
      this.state = S.STAND;
    } else {
      this.state = S.EAT;
      this.vx = (dx / d) * EAT_SPEED;
      this.vy = (dy / d) * EAT_SPEED;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }
  }

  _normal(dt, cursor, cursorMoving) {
    // 静止超时 → 原地趴下休息；光标一动立刻醒。
    if (!cursorMoving && this.restTimer >= this.idleRestSeconds) {
      this.vx *= 0.8; this.vy *= 0.8;
      this.state = S.REST;
      return;
    }
    const dx = cursor.x - this.x;
    const dy = cursor.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > COMFORT_RADIUS) {
      const speed = dist > RUN_DISTANCE ? RUN_SPEED : WALK_SPEED;
      this.state = dist > RUN_DISTANCE ? S.RUN : S.WALK;
      const ux = dx / dist, uy = dy / dist;
      const step = Math.min(speed * dt, dist - COMFORT_RADIUS);
      this.vx = ux * speed; this.vy = uy * speed;
      this.x += ux * step; this.y += uy * step;
    } else {
      this.vx *= 0.8; this.vy *= 0.8;
      this.state = S.STAND;   // 到达、警觉站立（未到休息超时）
    }
  }

  // 找离宠物最近的「桌面图标格子」（主屏左上若干列），作为吃的目标。
  _nearestIconCell() {
    const gx0 = this.primary.x + 44, gy0 = this.primary.y + 36;
    const cellW = 80, cellH = 92, cols = 3, rows = Math.max(1, Math.floor((this.primary.height - 80) / cellH));
    let col = Math.round((this.x - gx0) / cellW);
    let row = Math.round((this.y - gy0) / cellH);
    col = Math.max(0, Math.min(cols - 1, col));
    row = Math.max(0, Math.min(rows - 1, row));
    return { x: gx0 + col * cellW, y: gy0 + row * cellH };
  }

  _clampToScreen() {
    const { minX, minY, maxX, maxY } = this.world;
    this.x = Math.max(minX + this.half.w, Math.min(maxX - this.half.w, this.x));
    this.y = Math.max(minY + this.half.h, Math.min(maxY - this.half.h, this.y));
  }

  // 取出并清空待处理的「吃图标」请求。
  takeEatRequest() { const r = this.eatRequest; this.eatRequest = null; return r; }

  get snapshot() {
    return {
      x: this.x, y: this.y, facing: this.facing, state: this.state,
      animTime: this.animTime, walkPhase: this.walkPhase, scale: this.scale
    };
  }
}

module.exports = { PetSim, PetStates: S };
