# Desktop Pet（桌面宠物）

透明置顶窗口里的桌宠：跟随鼠标、闲置休息、可拖拽抛掷、落地生气吃图标。
形象来自用户真实宠物视频生成的 2D 精灵；渲染层可替换，未来可无缝换 **3D 模型**。

## 运行

```bash
npm install
npm start
```

## 交互

- **鼠标移动** → 宠物走/跑过来；靠近后站立。
- **静止一段时间** → 宠物原地趴下休息（默认 30 秒，见 `config.json` 的 `idleRestSeconds`）。
- **按住宠物拖动 → 松手** → 自由落体掉下 → 生气 → 原地拉一坨大便。
- **随机事件** → 每隔随机 1–2 小时（`config.json` 的 `poopMin/MaxMinutes`）原地拉一坨。
- **右键宠物** 或 **托盘菜单「清理大便」** → 清理所有大便。
- **退出**：托盘图标右键 →「退出」（或终端 `Ctrl+C`）。

> 大便是画在置顶层的视觉物，不碰你的真实文件，随时可清理。宠物位置钳制在所在屏的**工作区**内，不会被屏幕/任务栏边缘裁切。

## 架构（多屏 + 2D/3D 可换）

```
主进程
   ├─ main.js      每块显示器一个透明/置顶/穿透窗口；统一跑模拟并广播状态；悬停/吃图标遮挡/托盘
   ├─ PetSim.js    行为层（全局坐标）：跟随/休息/拖拽/重力/生气/吃图标 状态机，与画法无关
   └─ preload.js   暴露 onInit / onState / onOcclusions / dragStart|End / restoreIcons
渲染进程（每窗口一份，只画一块屏）
   ├─ core/PetRenderer.js   渲染器接口（clear / drawPet / drawOcclusions / loadSprites）
   ├─ renderers/Renderer2D.js  ← 当前：canvas 画真猫精灵（多动画集 + 程序化怒气/啃食特效）
   └─ renderers/Renderer3D.js  ← 以后：three.js 加载 .glb，接口完全一致
```

- **多屏**：Windows 透明窗口无法可靠跨多屏，故一屏一窗口；宠物全局坐标模拟、各窗口减偏移绘制；位置钳制在可视范围内不被边缘裁切；混合 DPI 也正确。
- **换 3D**：只改 `app.js` 里 `new Renderer2D()` 一行，主进程与行为层不动。

## 素材

- 当前精灵来自用户宠物视频：`idle`（躺，作 rest 回退）+ `walk`（走）。
- **换/加动作**：见 [docs/SPRITE-GUIDE.md](docs/SPRITE-GUIDE.md) —— 用 AI 按规格生成连贯帧，丢进 `assets/cat/`，跑 `node tools/make-manifest.js` 即可。
- 视频转精灵工具链：`ffmpeg 抽帧 → tools/01-remove-bg.js（ONNX 抠背景）→ tools/02-crop-resize.js（idle）/ build-walk-sprites.js（walk）`。抠图与 sharp 分进程跑（同进程会段错误）。

## 路线

- [x] 第1期 MVP：2D 桌宠 + 鼠标互动 + 拖拽 + 多屏（位置钳制在工作区，不被边缘裁切）
- [x] 真实宠物精灵（idle 躺 + walk 走）+ 闲置休息（可配置）
- [x] 拖拽彩蛋：自由落体 → 生气 → 拉屎；随机 1–2 小时拉屎；可清理 + 托盘
- [ ] 更多动作集（stand/run/angry/poop 专用帧，见素材指南）
- [ ] 第3期：用户上传照片/视频 → 服务端生成（API key 走后端代理，绝不进客户端）

## 注意

- 这是纯本地程序，不联网、不收集任何数据。
- 第3期接入照片生成 API 前，务必先过一遍密钥安全检查。
