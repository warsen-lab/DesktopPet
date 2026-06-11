// 3D 渲染器（占位桩）。
// 等 Tripo/Meshy 生成的 .glb 模型准备好后，在这里用 three.js 实现同样的接口：
//   import * as THREE from 'three';
//   import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// 用 WebGLRenderer（alpha:true 透明背景）渲染模型，render() 里根据 state.state
// 切换 AnimationClip（idle/walk/run），用 state.facing 控制朝向。
// 因为接口与 Renderer2D 完全一致，app.js 只要 new Renderer3D() 即可切换，行为层不动。

import { PetRenderer } from '../core/PetRenderer.js';

export class Renderer3D extends PetRenderer {
  init() {
    throw new Error('Renderer3D 尚未实现：先用 2D 看效果，待 .glb 模型就绪后在此接入 three.js。');
  }
}
