// 宠物的「行为层」：位置、状态机、跟随/躲避鼠标、拖拽与抛掷。
// 与渲染完全解耦——它只维护数据，由渲染器去画。

export const PetState = {
  IDLE: 'idle',   // 待机：原地呼吸、甩尾、偶尔眨眼
  WALK: 'walk',   // 走向光标
  RUN: 'run',     // 离得远时快跑追光标
  DRAG: 'drag',   // 被用户抓住拖动
  FALL: 'fall'    // 松手后受重力下落，落到「地面」回到 IDLE
};

const COMFORT_RADIUS = 90;   // 与光标保持的舒适距离，太近就不再靠近
const RUN_DISTANCE = 340;    // 超过这个距离就从走变成跑
const WALK_SPEED = 150;      // px/s
const RUN_SPEED = 520;       // px/s
const GRAVITY = 2400;        // px/s^2，松手后下落用
const BOUNCE = 0.45;         // 落地反弹系数

export class Pet {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.x = width / 2;
    this.y = height / 2;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;          // 1=朝右, -1=朝左
    this.state = PetState.IDLE;
    this.animTime = 0;        // 动画总时长，驱动眨眼/甩尾等
    this.walkPhase = 0;       // 迈腿相位，按移动距离累加
    this.scale = 1;           // 整体缩放（待机呼吸用）

    this.cursor = { x: width / 2, y: height / 2 };
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.idleTimer = 0;
    this.wanderTarget = null;
  }

  resize(width, height) {
    this.w = width;
    this.h = height;
  }

  setCursor(pos) {
    this.cursor = pos;
  }

  // 地面高度：屏幕底部留出一点，让宠物像站在任务栏上方。
  get floorY() {
    return this.h - 8;
  }

  startDrag(px, py) {
    this.dragging = true;
    this.state = PetState.DRAG;
    this.dragOffset = { x: this.x - px, y: this.y - py };
    this.vx = 0;
    this.vy = 0;
  }

  dragTo(px, py) {
    if (!this.dragging) return;
    const nx = px + this.dragOffset.x;
    const ny = py + this.dragOffset.y;
    // 记录速度，松手时变成抛掷初速度。
    this.vx = (nx - this.x) * 12;
    this.vy = (ny - this.y) * 12;
    this.x = nx;
    this.y = ny;
  }

  endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.state = PetState.FALL; // 松手后受重力下落
  }

  update(dt) {
    this.animTime += dt;

    switch (this.state) {
      case PetState.DRAG:
        // 位置由 dragTo 控制，这里只更新动画。
        break;

      case PetState.FALL:
        this._updateFall(dt);
        break;

      default:
        this._updateFollow(dt);
        break;
    }

    // 朝向：按水平速度翻面。
    if (Math.abs(this.vx) > 5) this.facing = this.vx > 0 ? 1 : -1;

    // 迈腿相位按实际移动距离累加，走得快腿动得快。
    const moved = Math.hypot(this.vx, this.vy) * dt;
    this.walkPhase += moved * 0.06;

    // 待机呼吸缩放。
    this.scale = 1 + Math.sin(this.animTime * 2.2) * 0.03;
  }

  _updateFall(dt) {
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.98; // 空气阻力

    // 左右墙反弹
    if (this.x < 20) { this.x = 20; this.vx = Math.abs(this.vx) * BOUNCE; }
    if (this.x > this.w - 20) { this.x = this.w - 20; this.vx = -Math.abs(this.vx) * BOUNCE; }

    // 落地
    if (this.y >= this.floorY) {
      this.y = this.floorY;
      if (Math.abs(this.vy) > 120) {
        this.vy = -this.vy * BOUNCE; // 弹一下
      } else {
        this.vy = 0;
        this.vx = 0;
        this.state = PetState.IDLE; // 停稳，恢复跟随
      }
    }
  }

  _updateFollow(dt) {
    const dx = this.cursor.x - this.x;
    const dy = this.cursor.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > COMFORT_RADIUS) {
      // 朝光标移动，保持舒适距离；远了就跑。
      const speed = dist > RUN_DISTANCE ? RUN_SPEED : WALK_SPEED;
      this.state = dist > RUN_DISTANCE ? PetState.RUN : PetState.WALK;
      const ux = dx / dist;
      const uy = dy / dist;
      // 目标点是「舒适距离」处，避免贴脸抖动。
      const targetDist = dist - COMFORT_RADIUS;
      const step = Math.min(speed * dt, targetDist);
      this.vx = ux * speed;
      this.vy = uy * speed;
      this.x += ux * step;
      this.y += uy * step;
      this.idleTimer = 0;
      this.wanderTarget = null;
    } else {
      // 进入舒适圈：待机 + 偶尔小范围闲逛。
      this.vx *= 0.8;
      this.vy *= 0.8;
      this.state = PetState.IDLE;
      this._wander(dt);
    }
  }

  _wander(dt) {
    this.idleTimer += dt;
    if (!this.wanderTarget && this.idleTimer > 2.5) {
      // 围绕当前位置挑一个近点小逛一下。
      const ang = (this.animTime * 97) % (Math.PI * 2);
      this.wanderTarget = {
        x: this.x + Math.cos(ang) * 60,
        y: this.y + Math.sin(ang) * 30
      };
    }
    if (this.wanderTarget) {
      const dx = this.wanderTarget.x - this.x;
      const dy = this.wanderTarget.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        this.wanderTarget = null;
        this.idleTimer = 0;
      } else {
        this.state = PetState.WALK;
        this.vx = (dx / d) * WALK_SPEED * 0.4;
        this.vy = (dy / d) * WALK_SPEED * 0.4;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
      }
    }
  }

  // 暴露给渲染器的纯数据快照。
  get snapshot() {
    return {
      x: this.x,
      y: this.y,
      facing: this.facing,
      state: this.state,
      animTime: this.animTime,
      walkPhase: this.walkPhase,
      scale: this.scale
    };
  }
}
