import { useEffect } from "react";
import { onBackendEvent, onGuardianDead } from "../adapters/backend";
import { useSessionStore } from "./session-store";

/**
 * 订阅壳事件流并汇入 session store（04-ui §状态分层：事件水位）。
 * 订阅经 adapter 引用计数共享，StrictMode 双挂载只建立一条底层 listen；
 * 卸载即 unlisten。不在这里触发任何业务动作（只记录，不自动转换）。
 */
export function useBackendEvents(): void {
  useEffect(() => {
    const offEvent = onBackendEvent((event) => {
      useSessionStore.getState().recordBackendEvent(event);
    });
    const offDead = onGuardianDead((payload) => {
      useSessionStore.getState().markGuardianDead(payload);
    });
    return () => {
      offEvent();
      offDead();
    };
  }, []);
}
