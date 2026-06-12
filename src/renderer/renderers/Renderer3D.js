// 3D 渲染器：用 three.js 渲染 .glb 宠物模型，接口与 Renderer2D 完全一致。
//  - 正交相机按 CSS 像素映射（屏幕坐标 (px,py) → 世界 (px,-py)），行为层坐标直接复用。
//  - 模型加载后规格化：脚底贴 y=0、中心对齐，按 MODEL_PX_H 像素高缩放。
//  - 动画：.glb 自带动画剪辑则用 AnimationMixer 播放（按名字匹配 walk/run/idle）；
//    没有剪辑但有骨骼（Tripo 自动绑骨）→ 程序化步态：四肢对角摆动 + 尾巴/头部摆动。
//  - 大便画成三层小球堆的 3D 模型，与 2D 版造型呼应。

import { PetRenderer } from '../core/PetRenderer.js';
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const MODEL_PX_H = 140;   // 模型显示高度（CSS 像素，scale=1 时）；与主进程 MODEL_HALF 保持一致

// Tripo 自动绑骨的骨骼命名（0_=前肢，1_=后肢，_0 为根段）。其他来源的 rig 命中不了就退化为整体起伏。
const BONE = {
  frontLeft: '0_Left_Limb_0', frontRight: '0_Right_Limb_0',
  hindLeft: '1_Left_Limb_0', hindRight: '1_Right_Limb_0',
  tail: ['Tail_0', 'Tail_1', 'Tail_2', 'Tail_3', 'Tail_4'],
  head: 'Head_0', spine: 'Spine_1'
};

export class Renderer3D extends PetRenderer {
  constructor() {
    super();
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.modelRoot = null;     // 位置/缩放层（像素空间）
    this.modelInner = null;    // 朝向层（含规格化后的 gltf 场景）
    this.mixer = null;
    this.clips = {};           // { walk, idle, ... } 按名字归类的动画剪辑
    this.activeAction = null;
    this.bones = {};           // 程序化步态用：命中的骨骼 + 静止四元数
    this.shadow = null;
    this.poopMeshes = new Map(); // id → Group
    this.lastAnimTime = 0;
    this.ready = false;
    this.facingRot = Math.PI / 2; // 模型「面向右」需要的 Y 旋转（按 Tripo 导出朝向 +Z 标定）
  }

  init(canvas, width, height) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(width, height, false);
    this.scene = new THREE.Scene();
    // 像素正交相机：x 向右，y 向下为正（取负映射到 three 的 y 向上）。
    this.camera = new THREE.OrthographicCamera(0, width, 0, -height, -4000, 4000);
    this.camera.position.z = 1000;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(300, 500, 800);
    this.scene.add(sun);

    this.resize(width, height);
  }

  // 主进程读出 .glb 字节传进来（绕开 file:// 的 fetch 限制）。返回 Promise<boolean>。
  loadModel(bytes) {
    const ab = bytes.buffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes;
    return new Promise((resolve) => {
      new GLTFLoader().parse(ab, '', (gltf) => {
        try {
          this._setupModel(gltf);
          this.ready = true;
          resolve(true);
        } catch (e) {
          console.error('[Renderer3D] 模型装配失败', e);
          resolve(false);
        }
      }, (err) => {
        console.error('[Renderer3D] glb 解析失败', err);
        resolve(false);
      });
    });
  }

  _setupModel(gltf) {
    const obj = gltf.scene;
    // 规格化：脚底贴 y=0，水平居中，高度缩为 1（之后用像素高一次缩放）。
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 1 / (size.y || 1);
    const norm = new THREE.Group();
    norm.add(obj);
    obj.position.set(-center.x, -box.min.y, -center.z);
    norm.scale.setScalar(s);
    norm.position.y = 0;

    this.pitchGroup = new THREE.Group();   // 身体姿态层（俯仰/起伏/抖动，模型空间）
    this.pitchGroup.add(norm);
    this.modelInner = new THREE.Group();   // 朝向层
    this.modelInner.add(this.pitchGroup);
    this.modelRoot = new THREE.Group();    // 位置/缩放层
    this.modelRoot.add(this.modelInner);
    this.modelRoot.visible = false;
    this.scene.add(this.modelRoot);

    // 软阴影（径向渐变贴图的圆片，放脚下）。
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshBasicMaterial({ map: this._shadowTexture(), transparent: true, depthWrite: false })
    );
    this.shadow.scale.set(0.9, 0.22, 1);
    this.shadow.position.set(0, 0.02, -0.3);
    this.modelInner.add(this.shadow);   // 阴影不随身体俯仰，挂朝向层

    // 动画剪辑：有就归类（名字含 walk/run/idle…），没有就准备程序化步态骨骼。
    if (gltf.animations && gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(obj);
      for (const clip of gltf.animations) {
        const n = clip.name.toLowerCase();
        const key = ['walk', 'run', 'idle', 'rest', 'stand'].find(k => n.includes(k)) || 'walk';
        if (!this.clips[key]) this.clips[key] = clip;
        this.clips._first ||= clip;
      }
    } else {
      obj.traverse((node) => {
        if (!node.isBone) return;
        const name = node.name;
        const hit = (key) => name.includes(key);
        if (hit(BONE.frontLeft)) this._grabBone('frontLeft', node, name.endsWith('_0'));
        else if (hit(BONE.frontRight)) this._grabBone('frontRight', node, name.endsWith('_0'));
        else if (hit(BONE.hindLeft)) this._grabBone('hindLeft', node, name.endsWith('_0'));
        else if (hit(BONE.hindRight)) this._grabBone('hindRight', node, name.endsWith('_0'));
        else if (BONE.tail.some(t => hit(t))) this._grabBone('tail' + name.slice(-1), node, true);
        else if (hit(BONE.head)) this._grabBone('head', node, true);
        else if (hit(BONE.spine)) this._grabBone('spine', node, true);
      });
      this._computeBoneAxes();
    }
  }

  // 把「模型空间」的横向轴/竖直轴换算进每根骨骼的局部空间。
  // 腿前后摆 = 绕横向轴转、尾巴左右甩 = 绕竖直轴转——骨骼局部轴向（Tripo 导出）与
  // 模型轴不一致，直接用局部 XYZ 会摆错方向（实测腿会左右晃）。此处用静止姿态的
  // 世界四元数精确换算，一劳永逸。模型身体沿 X 轴 → 横向 = Z、竖直 = Y。
  _computeBoneAxes() {
    this.modelRoot.updateMatrixWorld(true);   // 此时 root 无位移/旋转，世界空间 == 模型空间
    const wq = new THREE.Quaternion();
    for (const b of Object.values(this.bones)) {
      b.node.getWorldQuaternion(wq);
      const inv = wq.clone().invert();
      b.lateral = new THREE.Vector3(0, 0, 1).applyQuaternion(inv).normalize();  // 前后摆动轴
      b.vertical = new THREE.Vector3(0, 1, 0).applyQuaternion(inv).normalize(); // 左右甩动轴
    }
  }

  // 只记录每条链的根段（_0）做摆动；rest 四元数留底，每帧从它出发叠加。
  _grabBone(key, node, take) {
    if (!take || this.bones[key]) return;
    this.bones[key] = { node, rest: node.quaternion.clone() };
  }

  _shadowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.30)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  loadSprites() { /* 3D 模式不用精灵 */ }

  resize(width, height) {
    if (!this.renderer) return;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.camera.right = width;
    this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
  }

  clear() { /* three 每帧整体重绘，render() 在 drawPet 末尾统一执行 */ }

  drawPet(state) {
    if (!this.ready) return;
    const root = this.modelRoot;
    root.visible = true;

    const px = MODEL_PX_H * (state.scale || 1);
    root.scale.setScalar(px);
    // state.y 是宠物中心 → 模型脚底在中心下方半个身位。
    root.position.set(state.x, -(state.y + px / 2), 0);

    // 朝向：facing=1 朝右。再加一点向镜头的偏转，让人看到 3/4 侧身而不是纯剪影。
    this.modelInner.rotation.y = state.facing * this.facingRot - state.facing * 0.5;

    const dt = Math.max(0, Math.min(state.animTime - this.lastAnimTime, 0.1));
    this.lastAnimTime = state.animTime;

    if (this.mixer) this._driveMixer(state, dt);
    else this._driveProcedural(state);

    this.renderer.render(this.scene, this.camera);
  }

  // ——— 真动画剪辑：按状态切剪辑，run 用 walk 加速 ———
  _driveMixer(state, dt) {
    const pick = (...keys) => { for (const k of keys) if (this.clips[k]) return this.clips[k]; return this.clips._first; };
    let clip, timeScale = 1, play = true;
    switch (state.state) {
      case 'walk':  clip = pick('walk'); break;
      case 'run':   clip = pick('run', 'walk'); timeScale = this.clips.run ? 1 : 1.8; break;
      case 'rest':  clip = pick('rest', 'idle'); play = !!(this.clips.rest || this.clips.idle); break;
      case 'stand': clip = pick('idle', 'stand'); play = !!(this.clips.idle || this.clips.stand); break;
      default:      clip = pick('idle', 'stand', 'walk'); play = false; // drag/fall/其他 → 定格
    }
    const action = this.mixer.clipAction(clip);
    if (this.activeAction !== action) {
      if (this.activeAction) this.activeAction.fadeOut(0.2);
      action.reset().fadeIn(0.2).play();
      this.activeAction = action;
    }
    action.timeScale = timeScale;
    action.paused = !play;
    this.mixer.update(dt);
  }

  // ——— 程序化驱动（模型无动画剪辑时的兜底）———
  // 两层叠加：
  //  1) 姿势层（阻尼过渡）：stand→端坐、rest→趴卧、poop→蹲姿、其余站立。
  //     角度都绕「模型横向轴」（_computeBoneAxes 已换算到各骨骼局部空间），正值 = 该部位向身体前方折。
  //  2) 步态层（即时）：行走/奔跑时四肢绕横向轴对角前后摆（walkPhase 随移动距离累加，速度天然同步）。
  _driveProcedural(state) {
    const t = state.animTime;
    const s = state.state;
    const moving = s === 'walk' || s === 'run';
    const dragging = s === 'drag';

    // 姿势目标（y 单位 = 身高）。符号约定（按本模型两轮实测标定）：
    //   pitch 正值 = 前躯抬起（后仰）；腿角负值 = 向前折、正值 = 向后摆；head 负值 = 低头。
    const POSES = {
      // 端坐：前躯上仰、前腿向后补偿仰角保持竖直、后腿前折蜷于身下、微低头。
      sit: { y: -0.12, pitch: 0.5, bones: { hindLeft: -0.9, hindRight: -0.9, frontLeft: 0.5, frontRight: 0.5, head: -0.35 } },
      // 趴卧：身体贴地，前腿前折、后腿向身下收（后肢链骨骼朝向与前肢相反，实测 + 才是收拢）。
      lie: { y: -0.30, pitch: 0, bones: { frontLeft: -0.9, frontRight: -0.9, hindLeft: 0.9, hindRight: 0.9, head: -0.1 } },
      // 蹲姿（拉屎）：后躯下沉前躯微抬，后腿前折。
      squat: { y: -0.14, pitch: 0.28, bones: { hindLeft: -0.6, hindRight: -0.6, frontLeft: 0.28, frontRight: 0.28, head: -0.1 } },
      stand: { y: 0, pitch: 0, bones: {} }
    };
    const pose = s === 'stand' ? POSES.sit
      : s === 'rest' ? POSES.lie
      : s === 'poop' ? POSES.squat
      : POSES.stand;

    // 阻尼系数：姿势切换 ~0.3s 内柔和到位。
    const dt = Math.max(0.001, Math.min(t - (this._lastT ?? t), 0.1));
    this._lastT = t;
    const k = 1 - Math.exp(-dt * 9);
    const cur = (this._poseCur ||= { y: 0, pitch: 0, bones: {} });
    cur.y += (pose.y - cur.y) * k;
    cur.pitch += (pose.pitch - cur.pitch) * k;

    // 步态摆动（即时，不阻尼）：前左+后右 同相，前右+后左 反相。
    const swing = moving ? Math.sin(state.walkPhase * 2) * 0.5 : 0;
    const gait = { frontLeft: swing, hindRight: swing, frontRight: -swing, hindLeft: -swing };

    const q = this._tmpQ ||= new THREE.Quaternion();
    for (const [key, b] of Object.entries(this.bones)) {
      if (key.startsWith('tail')) continue;
      const target = pose.bones[key] || 0;
      const cb = cur.bones[key] = (cur.bones[key] ?? 0) + (target - (cur.bones[key] ?? 0)) * k;
      let angle = cb + (gait[key] || 0);
      // 头部：走路轻点头，待机缓慢张望。
      if (key === 'head') angle += moving ? Math.sin(state.walkPhase * 2) * 0.05 : Math.sin(t * 0.7) * 0.06;
      // 脊柱：静止时呼吸起伏。
      if (key === 'spine') angle += moving ? 0 : Math.sin(t * 2.2) * 0.025;
      b.node.quaternion.copy(b.rest);
      if (angle) b.node.quaternion.multiply(q.setFromAxisAngle(b.lateral, angle));
    }

    // 尾巴：绕竖直轴左右甩，逐节相位差；趴卧时缓慢小幅。
    const wagSpeed = moving ? 8 : s === 'rest' ? 1.6 : 2.5;
    const wagAmp = s === 'rest' ? 0.08 : 0.18;
    for (let i = 0; i <= 4; i++) {
      const b = this.bones['tail' + i];
      if (!b) continue;
      b.node.quaternion.copy(b.rest);
      b.node.quaternion.multiply(q.setFromAxisAngle(b.vertical, Math.sin(t * wagSpeed + i * 0.6) * wagAmp));
    }

    // 身体姿态层：俯仰 + 高度 + 起伏/挣扎/用力抖动。
    const pg = this.pitchGroup;
    pg.rotation.z = cur.pitch + (dragging ? Math.sin(t * 14) * 0.12 : 0);
    let bobY = 0, shakeX = 0;
    if (moving) bobY = Math.abs(Math.sin(state.walkPhase * 2)) * 0.02;
    else if (s === 'rest') bobY = Math.sin(t * 1.6) * 0.008;          // 慢呼吸
    else bobY = Math.sin(t * 2.2) * 0.006;
    if (s === 'angry') shakeX = Math.sin(t * 30) * 0.015;             // 生气抖动
    else if (s === 'poop') shakeX = Math.sin(t * 24) * 0.008;         // 用力颤抖
    pg.position.set(shakeX, cur.y + bobY, 0);
  }

  // ——— 大便：三层球 + 尖顶（与 2D 版造型一致），按 id 增量同步 ———
  drawPoops(list) {
    if (!this.scene) return;
    const alive = new Set();
    for (const p of list) {
      alive.add(p.id);
      if (!this.poopMeshes.has(p.id)) {
        const g = this._makePoop();
        this.scene.add(g);
        this.poopMeshes.set(p.id, g);
      }
      this.poopMeshes.get(p.id).position.set(p.x, -p.y - 10, -50);
    }
    for (const [id, g] of this.poopMeshes) {
      if (!alive.has(id)) { this.scene.remove(g); this.poopMeshes.delete(id); }
    }
  }

  _makePoop() {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const layers = [
      { y: 0, r: 15, sy: 0.5, c: 0x5a3a1e },
      { y: 7, r: 11, sy: 0.55, c: 0x6e4a28 },
      { y: 13, r: 7, sy: 0.6, c: 0x7d5530 },
      { y: 18, r: 3, sy: 1, c: 0x7d5530 }
    ];
    for (const L of layers) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(L.r, 16, 12), mat(L.c));
      m.scale.y = L.sy;
      m.position.y = L.y;
      g.add(m);
    }
    return g;
  }

  dispose() {
    for (const [, g] of this.poopMeshes) this.scene?.remove(g);
    this.poopMeshes.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.ready = false;
  }
}
