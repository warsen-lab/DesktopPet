# Desktop Pet（桌面宠物）

透明置顶窗口里的桌宠：跟随/躲避鼠标、可拖拽抛掷。当前是 **2D 占位猫** 版本，用于先看效果。
渲染层可替换，未来可无缝换成用宠物照片生成的 **3D 模型**。

## 运行

```bash
npm install
npm start
```

启动后桌面上会出现一只小猫，鼠标移动它会追过来，移到它身上可以按住拖动、松手会掉下来。
关闭：在终端按 `Ctrl+C`。

## 架构（多屏 + 2D/3D 可换）

```
主进程
   ├─ main.js      每块显示器一个透明/置顶/穿透窗口；统一跑模拟并广播宠物状态；悬停/拖拽判定
   ├─ PetSim.js    行为层（全局虚拟桌面坐标）：跟随/拖拽/重力状态机，与画法无关
   └─ preload.js   暴露 onInit / onState / dragStart|End
渲染进程（每窗口一份，只画一块屏）
   ├─ core/PetRenderer.js   渲染器接口（init/loadSprites/render/resize）
   ├─ renderers/Renderer2D.js  ← 当前：canvas 画真猫精灵（idle/walk 双动画）
   └─ renderers/Renderer3D.js  ← 以后：three.js 加载 .glb，接口完全一致
```

- **多屏**：Windows 透明窗口无法可靠跨多屏，故一屏一窗口；宠物用全局坐标模拟，各窗口减偏移绘制，混合 DPI 也正确。
- **换 3D**：只改 `app.js` 里 `new Renderer2D()` 一行，主进程与行为层不动。

## 精灵构建流程（把宠物视频做成精灵）

```
ffmpeg 抽帧 → tools/01-remove-bg.js（抠背景，ONNX，无需 Python）
            → tools/02-crop-resize.js（idle：并集裁剪，保留自然摆动）
            → tools/build-walk-sprites.js（walk：逐帧归一化居中，做原地走）
            → assets/cat/{idle,walk}_*.png + manifest.json
```
抠图与缩放分两个进程跑（onnxruntime 与 sharp 同进程会段错误）。

## 路线

- [x] 第1期 MVP：2D 桌宠 + 鼠标互动 + 拖拽 + 多屏
- [x] 真实宠物精灵（idle 躺 + walk 走，来自用户视频）
- [ ] 第2期：桌面图标恶作剧（覆盖层视觉伪装，不碰真实文件）
- [ ] 第3期：用户上传照片/视频 → 服务端生成（API key 走后端代理，绝不进客户端）

## 注意

- 这是纯本地程序，不联网、不收集任何数据。
- 第3期接入照片生成 API 前，务必先过一遍密钥安全检查。
