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

    this.modelInner = new THREE.Group();   // 朝向层
    this.modelInner.add(norm);
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
    this.modelInner.add(this.shadow);

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
      case 'walk': clip = pick('walk'); break;
      case 'run':  clip = pick('run', 'walk'); timeScale = this.clips.run ? 1 : 1.8; break;
      case 'rest': clip = pick('rest', 'idle'); play = !!(this.clips.rest || this.clips.idle); break;
      case 'idle': clip = pick('idle', 'stand'); play = !!(this.clips.idle || this.clips.stand); break;
      default:     clip = pick('idle', 'stand', 'walk'); play = false; // drag/fall/其他 → 定格
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

  // ——— 程序化步态（模型无动画剪辑时的兜底）———
  //  - 行走/奔跑：四肢绕局部 X 轴对角摆动（walkPhase 由移动距离累加，速度天然同步），
  //  - 尾巴逐节相位差摆动，头部轻点；待机呼吸起伏；拖拽倾斜；rest 整体放平一点。
  _driveProcedural(state) {
    const t = state.animTime;
    const moving = state.state === 'walk' || state.state === 'run';
    const dragging = state.state === 'drag';
    const swing = moving ? Math.sin(state.walkPhase * 2) * 0.55 : 0;

    const rot = (key, axis, angle) => {
      const b = this.bones[key];
      if (!b) return;
      b.node.quaternion.copy(b.rest);
      if (angle) {
        const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        b.node.quaternion.multiply(q);
      }
    };
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

    // 四肢对角步态：前左+后右 同相，前右+后左 反相。
    rot('frontLeft', X, swing);
    rot('hindRight', X, swing);
    rot('frontRight', X, -swing);
    rot('hindLeft', X, -swing);

    // 尾巴：逐节相位差，走路摆得快。
    const wagSpeed = moving ? 8 : 2.5;
    for (let i = 0; i <= 4; i++) {
      rot('tail' + i, Y, Math.sin(t * wagSpeed + i * 0.6) * 0.18);
    }
    // 头:走路轻点头,待机偶尔转头。
    rot('head', X, moving ? Math.sin(state.walkPhase * 2) * 0.06 : Math.sin(t * 0.7) * 0.08);
    // 脊柱:呼吸起伏。
    rot('spine', X, moving ? 0 : Math.sin(t * 2.2) * 0.03);

    // 整体姿态:拖拽倾斜挣扎,rest 压低,角色起伏。
    const inner = this.modelInner;
    if (dragging) {
      inner.rotation.z = Math.sin(t * 14) * 0.12;
      inner.position.y = 0;
    } else if (state.state === 'rest') {
      inner.rotation.z = 0;
      inner.scale.y = 0.92;
      inner.position.y = Math.sin(t * 1.6) * 0.008;   // 慢呼吸
      return;
    } else {
      inner.rotation.z = 0;
      inner.position.y = moving ? Math.abs(Math.sin(state.walkPhase * 2)) * 0.02 : Math.sin(t * 2.2) * 0.006;
    }
    inner.scale.y = 1;
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
