# Desktop Pet（桌面宠物）

透明置顶窗口里的桌宠：跟随鼠标、闲置休息、可拖拽抛掷、落地生气拉屎。
形象来自用户真实宠物视频生成的 2D 精灵；渲染层可替换，未来可无缝换 **3D 模型**。

## 安装（普通用户）

到 [Releases](https://github.com/warsen-lab/DesktopPet/releases/latest) 下载 `DesktopPet-Setup-x.y.z.exe`，双击安装即自动启动。
启动后宠物出现在桌面，右下角托盘可打开 **设置** 与 **宠物素材工坊**。

## 运行（开发者）

```bash
npm install
npm start          # 开发运行
npm run dist       # 打包 Windows 安装包（dist/DesktopPet-Setup-*.exe）
```

## 交互

- **鼠标移动** → 宠物走/跑过来；靠近后端坐。
- **静止一段时间** → 宠物原地趴下休息（默认 30 秒，可在设置里调）。
- **按住宠物拖动 → 松手** → 自由落体掉下 → 生气 → 原地拉一坨大便。
- **随机事件** → 每隔随机 1–2 小时（设置里可调区间）原地拉一坨。
- **右键宠物** 或 **托盘菜单「清理大便」** → 清理所有大便。
- **托盘菜单**：设置（开机自启 / 休息 / 拉屎频率 / 跑步速度）、宠物素材工坊、清理大便、退出。托盘图标就是你的宠物。

> 大便是画在置顶层的视觉物，不碰你的真实文件，随时可清理。宠物位置钳制在所在屏的**工作区**内，不会被屏幕/任务栏边缘裁切。

## 素材与配置都在用户目录（升级不丢）

- 素材：`%APPDATA%/desktop-pet/pets/cat/`，首次启动自动从内置素材复制，之后**升级/重装都不会覆盖**你的自定义素材。
- 配置：`%APPDATA%/desktop-pet/settings.json`，由设置窗口管理。
- 想换成你家宠物：托盘 →「宠物素材工坊」，里面有每个动作的**拍摄角度线条示意图**、命名规则，替换 PNG 后点「重新扫描并应用」即时生效（含托盘图标）。详细制作流程见 [docs/SPRITE-GUIDE.md](docs/SPRITE-GUIDE.md)。

## 版本与更新

每次启动后台比对 GitHub 最新 Release（仅此一个网络请求，失败静默）；有新版时托盘菜单和设置窗口会出现「去下载」入口，不自动更新、不强更。

## 架构（多屏 + 2D/3D 可换）

```
主进程
   ├─ main.js        每块显示器一个透明/置顶/穿透窗口；统一跑模拟并广播状态；托盘/UI窗口/IPC
   ├─ PetSim.js      行为层（全局坐标）：跟随/休息/拖拽/重力/生气/拉屎 状态机，与画法无关
   ├─ assets.js      素材管理：userData 播种/重建 manifest（nativeImage，不依赖 sharp）/托盘图标
   ├─ settings.js    用户设置：userData/settings.json 读写与钳制
   ├─ updater.js     版本检查：GitHub Releases API，离线静默
   ├─ preload.js     覆盖窗口桥：onInit / onState / onPoops / dragStart|End / cleanPoops
   └─ preload-ui.js  设置/工坊窗口桥：ui:* invoke API
渲染进程（每窗口一份，只画一块屏）
   ├─ core/PetRenderer.js      渲染器接口（clear / drawPet / drawPoops / loadSprites）
   ├─ renderers/Renderer2D.js  ← 当前：canvas 画真猫精灵（多动画集 + 程序化特效）
   └─ renderers/Renderer3D.js  ← 以后：three.js 加载 .glb，接口完全一致
UI 窗口（src/ui/）
   ├─ settings.html  设置：开机自启 / 休息 / 拉屎频率 / 跑步速度 / 检查更新
   └─ guide.html     素材工坊：拍摄角度线条示意 + 素材状态 + 打开文件夹 / 重扫热重载
```

- **多屏**：Windows 透明窗口无法可靠跨多屏，故一屏一窗口；宠物全局坐标模拟、各窗口减偏移绘制；位置钳制在可视范围内不被边缘裁切；混合 DPI 也正确。
- **换 3D**：只改 `app.js` 里 `new Renderer2D()` 一行，主进程与行为层不动。

## 素材工具链（开发者）

- 视频转精灵：`ffmpeg 抽帧 → tools/01-remove-bg.js（ONNX 抠背景）→ tools/02-crop-resize.js / build-*-sprites.js`。抠图与 sharp 分进程跑（同进程会段错误）。
- `tools/make-manifest.js`：扫描 `assets/cat/` 生成内置种子的 manifest（用户侧由工坊窗口的「重新扫描」完成，不需要 Node）。
- `tools/build-app-icon.js`：从素材帧生成 `build/icon.png` 应用图标。

## 路线

- [x] 第1期 MVP：2D 桌宠 + 鼠标互动 + 拖拽 + 多屏（位置钳制在工作区，不被边缘裁切）
- [x] 真实宠物精灵（idle/walk/stand/run/angry/poop）+ 闲置休息（可配置）
- [x] 拖拽彩蛋：自由落体 → 生气 → 拉屎；随机拉屎；可清理 + 托盘
- [x] v0.2.0：素材/配置分离到用户目录、素材工坊（角度示意+热重载）、设置窗口（自启/频率/速度）、版本检查、NSIS 安装包
- [ ] 第3期：用户上传照片/视频 → 服务端生成（API key 走后端代理，绝不进客户端）

## 隐私

- 本地运行，不收集任何数据；唯一的网络请求是启动时向 GitHub 查询最新版本号（不上传任何信息，失败静默）。
- 第3期接入照片生成 API 前，务必先过一遍密钥安全检查。
