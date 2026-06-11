// 渲染器接口（抽象基类）。
// 行为层只跟这个接口打交道，不关心宠物到底是 2D 精灵还是 3D 模型。
// 想从 2D 换成 3D，只要换一个实现了同样方法的渲染器即可，行为层一行不用改。
export class PetRenderer {
  // 初始化：传入 canvas 与逻辑尺寸（CSS 像素）。
  init(canvas, width, height) {}

  // 由主进程把精灵清单（双动画集）传进来。
  loadSprites(manifest) {}

  // 窗口尺寸变化时调用。
  resize(width, height) {}

  // 每帧三步：清空 → 画遮挡 → 画宠物（state 为模拟快照的本屏局部坐标版）。
  clear() {}
  drawOcclusions(list) {}
  drawPet(state) {}

  // 释放资源。
  dispose() {}
}
