// 宠物模拟（主进程，CommonJS）。用「全局虚拟桌面坐标(DIP)」运行，
// 由各显示器窗口各自减去自己的偏移来绘制。多屏唯一真相源在这里，避免各窗口各自为政。

const PetState = {
  IDLE: 'idle', WALK: 'walk', RUN: 'run', DRAG: 'drag', FALL: 'fall'
};

const COMFORT_RADIUS = 90;
const RUN_DISTANCE = 340;
const WALK_SPEED = 150;
const RUN_SPEED = 520;
const GRAVITY = 2400;
const BOUNCE = 0.45;

class PetSim {
  // world: {minX,minY,maxX,maxY} 虚拟桌面外接矩形；start: {x,y} 初始位置（全局 DIP）。
  constructor(world, start) {
    this.world = world;
    this.x = start.x;
    this.y = start.y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.state = PetState.IDLE;
    this.animTime = 0;
    this.walkPhase = 0;
    this.scale = 1;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.idleTimer = 0;
    this.wanderTarget = null;
  }

  setWorld(world) { this.world = world; }

  get floorY() { return this.world.maxY - 8; }

  startDrag(cx, cy) {
    this.dragging = true;
    this.state = PetState.DRAG;
    this.dragOffset = { x: this.x - cx, y: this.y - cy };
    this.vx = 0; this.vy = 0;
  }

  endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.state = PetState.FALL;
  }

  update(dt, cursor) {
    this.animTime += dt;

    if (this.dragging) {
      const nx = cursor.x + this.dragOffset.x;
      const ny = cursor.y + this.dragOffset.y;
      this.vx = (nx - this.x) * 12;
      this.vy = (ny - this.y) * 12;
      this.x = nx; this.y = ny;
      this.state = PetState.DRAG;
    } else if (this.state === PetState.FALL) {
      this._updateFall(dt);
    } else {
      this._updateFollow(dt, cursor);
    }

    if (Math.abs(this.vx) > 5) this.facing = this.vx > 0 ? 1 : -1;
    const moved = Math.hypot(this.vx, this.vy) * dt;
    this.walkPhase += moved * 0.06;
    this.scale = 1 + Math.sin(this.animTime * 2.2) * 0.03;
  }

  _updateFall(dt) {
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.98;
    const { minX, maxX } = this.world;
    if (this.x < minX + 20) { this.x = minX + 20; this.vx = Math.abs(this.vx) * BOUNCE; }
    if (this.x > maxX - 20) { this.x = maxX - 20; this.vx = -Math.abs(this.vx) * BOUNCE; }
    if (this.y >= this.floorY) {
      this.y = this.floorY;
      if (Math.abs(this.vy) > 120) this.vy = -this.vy * BOUNCE;
      else { this.vy = 0; this.vx = 0; this.state = PetState.IDLE; }
    }
  }

  _updateFollow(dt, cursor) {
    const dx = cursor.x - this.x;
    const dy = cursor.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > COMFORT_RADIUS) {
      const speed = dist > RUN_DISTANCE ? RUN_SPEED : WALK_SPEED;
      this.state = dist > RUN_DISTANCE ? PetState.RUN : PetState.WALK;
      const ux = dx / dist, uy = dy / dist;
      const step = Math.min(speed * dt, dist - COMFORT_RADIUS);
      this.vx = ux * speed; this.vy = uy * speed;
      this.x += ux * step; this.y += uy * step;
      this.idleTimer = 0; this.wanderTarget = null;
    } else {
      this.vx *= 0.8; this.vy *= 0.8;
      this.state = PetState.IDLE;
      this._wander(dt);
    }
  }

  _wander(dt) {
    this.idleTimer += dt;
    if (!this.wanderTarget && this.idleTimer > 2.5) {
      const ang = (this.animTime * 97) % (Math.PI * 2);
      this.wanderTarget = { x: this.x + Math.cos(ang) * 60, y: this.y + Math.sin(ang) * 30 };
    }
    if (this.wanderTarget) {
      const dx = this.wanderTarget.x - this.x;
      const dy = this.wanderTarget.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) { this.wanderTarget = null; this.idleTimer = 0; }
      else {
        this.state = PetState.WALK;
        this.vx = (dx / d) * WALK_SPEED * 0.4;
        this.vy = (dy / d) * WALK_SPEED * 0.4;
        this.x += this.vx * dt; this.y += this.vy * dt;
      }
    }
  }

  get snapshot() {
    return {
      x: this.x, y: this.y, facing: this.facing, state: this.state,
      animTime: this.animTime, walkPhase: this.walkPhase, scale: this.scale
    };
  }
}

module.exports = { PetSim, PetState };
