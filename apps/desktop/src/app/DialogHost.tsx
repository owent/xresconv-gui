import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { PendingDialog } from "./session-store";
import { useSessionStore } from "./session-store";

/**
 * 弹框宿主（F09 alert_warning/alert_error，P4-05b 接入，SC06）。
 *
 * - 数据源为 store.pendingDialogs（dialog_request 进队 / dialog_invalidate 出队）；
 *   同一时刻只展示队首一个，应答/失效后下一个再显示——逐框应答保留
 *   yes/no/on_close 回调语义（不把回调简化成普通 toast）。
 * - 按钮语义：yes → choice "yes"；no → "no"；ok（alert_error）→ null（仅关闭，
 *   旧版无回调，main.js:861-877）；ESC/遮罩关闭 → null（on_close 回调，
 *   BD-06：ESC 也必须最终化，否则脚本挂起）。
 * - 应答在途（answering）禁用按钮：已应答不可再点（P2-06 遗留项）；
 *   worker 失效的弹框由 dialog_invalidate 移除，不会点到过期回调。
 */

/** 按钮词 → 应答 choice 与显示文案（旧版 bootstrap 按钮是/否/好）。 */
const BUTTON_META: Record<string, { choice: "yes" | "no" | null; label: string }> = {
  yes: { choice: "yes", label: "是" },
  no: { choice: "no", label: "否" },
  ok: { choice: null, label: "好" },
};

function ScriptDialog({ dialog }: { dialog: PendingDialog }) {
  const respondDialog = useSessionStore((state) => state.respondDialog);
  const respond = (choice: "yes" | "no" | null) => {
    void respondDialog(dialog.token, choice);
  };
  const buttons = dialog.buttons.length > 0 ? dialog.buttons : ["ok"];

  return (
    <ModalOverlay
      className="confirm-overlay"
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) respond(null);
      }}
    >
      <Modal className="confirm-modal">
        <Dialog aria-label={dialog.title || "脚本弹框"} className="confirm-dialog script-dialog">
          <Heading slot="title">{dialog.title}</Heading>
          <p className="script-dialog-content">{dialog.content}</p>
          <div className="confirm-actions">
            {buttons.map((button) => {
              const meta = BUTTON_META[button] ?? { choice: null, label: button };
              return (
                <Button
                  key={button}
                  isDisabled={dialog.answering}
                  onPress={() => respond(meta.choice)}
                >
                  {meta.label}
                </Button>
              );
            })}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function DialogHost() {
  const pendingDialogs = useSessionStore((state) => state.pendingDialogs);
  const current = pendingDialogs[0];
  return (
    <div className="dialog-host" data-testid="dialog-host">
      {current !== undefined && <ScriptDialog dialog={current} />}
    </div>
  );
}
