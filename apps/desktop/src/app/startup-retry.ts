/**
 * 启动期可重试错误判定（dev 启动仍弹
 * "guardian protocol violation: BACKEND_NOT_READY"）。
 *
 * guardian/backend 在壳启动后仍在 starting 时，立即发出的 backend_rpc 会以
 * BACKEND_NOT_READY 失败——这种错误明确表示请求尚未执行，可以
 * 瞬态的：静默重试直到成功或超时，不作为可见错误弹出；业务错误
 * （CONFIG_ERROR/文件不存在等）不在此列，立即失败保持可见。
 *
 * 消费方：配置加载（手动与自动）、启动选择器和初始日志拉取。
 * 共享同一判定，避免词表漂移。
 */
export const STARTUP_RETRY_INTERVAL_MS = 600;
export const STARTUP_RETRY_TIMEOUT_MS = 30_000;

export function isRetryableStartupError(message: string): boolean {
  // Timeout or a lost channel does not prove a mutation was never executed.
  return /^(?:guardian protocol violation:\s*)?BACKEND_NOT_READY\b/.test(message);
}
