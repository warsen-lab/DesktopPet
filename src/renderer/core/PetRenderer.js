// 渲染器接口（抽象基类）。
// 行为层只跟这个接口打交道，不关心宠物到底是 2D 精灵还是 3D 模型。
// 想从 2D 换成 3D，只要换一个实现了同样方法的渲染器即可，行为层一行不用改。
export class PetRenderer {
  // 初始化：传入 canvas 与逻辑尺寸（CSS 像素）。
  init(canvas, width, height) {}

  // 窗口尺寸变化时调用。
  resize(width, height) {}

  // 每帧绘制。state 是 Pet 暴露的纯数据快照，dt 为距上一帧的秒数。
  render(state, dt) {}

  // 命中测试：屏幕点 (px,py) 是否落在宠物身上（用于判断能否拖拽 / 点击）。
  hitTest(px, py, state) { return false; }

  // 释放资源。
  dispose() {}
}
