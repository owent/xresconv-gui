/**
 * vitest 全局 setup（apps/desktop）：
 * jsdom 没有 ResizeObserver——@tanstack/react-virtual 与 RAC Virtualizer 依赖
 * 它测量滚动容器；缺失时“挂载后新增日志”这类动态变更无法触发重测量，
 * getVirtualItems() 恒为空（2026-09-26 三轮改版：环境诊断日志在挂载后写入，
 * App 级测试需要看到日志行）。shim 立即回报固定视口（1024×768）触发首次
 * 测量；真实浏览器/WebView 不受影响。
 */
class ResizeObserverShim {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const size = {
      width: 1024,
      height: 768,
      inlineSize: 1024,
      blockSize: 768,
    };
    // virtual-core 优先读 borderBoxSize（缺省回退 offsetHeight=0），
    // 两个口径都给足；字段经 as 收敛，不逐字段实现 ResizeObserverEntry。
    const entry = {
      target,
      borderBoxSize: [size],
      contentBoxSize: [size],
      devicePixelContentBoxSize: [size],
      contentRect: {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        top: 0,
        left: 0,
        bottom: size.height,
        right: size.width,
      },
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve(): void {}

  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverShim as unknown as typeof ResizeObserver;
}
