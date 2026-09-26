/**
 * 启动期可重试错误判定（2026-09-26 用户反馈：dev 启动仍弹
 * "guardian protocol violation: BACKEND_NOT_READY"）。
 *
 * guardian/backend 在壳启动后仍在 starting 时，立即发出的 backend_rpc 会以
 * BACKEND_NOT_READY/BACKEND_TIMEOUT/guardian 通道未就绪失败——这类错误是
 * 瞬态的：静默重试直到成功或超时，不作为可见错误弹出；业务错误
 * （CONFIG_ERROR/文件不存在等）不在此列，立即失败保持可见。
 *
 * 消费方：display-settings 自动加载重试、session-store initLogs 初始拉取重试
 * （两处共享同一判定，避免词表漂移）。
 */
export const STARTUP_RETRY_INTERVAL_MS = 600;
export const STARTUP_RETRY_TIMEOUT_MS = 30_000;

export function isRetryableStartupError(message: string): boolean {
  return (
    message.includes("BACKEND_NOT_READY") ||
    message.includes("BACKEND_TIMEOUT") ||
    message.includes("guardian") ||
    message.includes("channel")
  );
}
