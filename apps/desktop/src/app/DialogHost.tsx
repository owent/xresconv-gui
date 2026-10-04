import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { translate as t, useI18n } from "../i18n";
import type { PendingDialog } from "./session-store";
import { useSessionStore } from "./session-store";

/**
 * alert_warning / alert_error 弹框宿主。
 *
 * 数据源为 store.pendingDialogs（dialog_request 进队 / dialog_invalidate 出队）；
 *   同一时刻只展示队首一个，应答/失效后下一个再显示——逐框应答保留
 *   yes/no/on_close 回调语义（不把回调简化成普通 toast）。
 * 按钮语义：yes → choice "yes"；no → "no"；ok（alert_error）→ null（仅关闭，
 *   无回调)；ESC/遮罩关闭 → null（on_close 回调，
 *   ESC 也必须最终化，否则脚本挂起）。
 * 应答在途（answering）禁用按钮，防止重复应答；
 *   worker 失效的弹框由 dialog_invalidate 移除，不会点到过期回调。
 */

/** 按钮词对应的应答 choice 与显示文案。 */
function buttonMeta(): Record<string, { choice: "yes" | "no" | null; label: string }> {
  return {
    yes: { choice: "yes", label: t("dialog.yes") },
    no: { choice: "no", label: t("dialog.no") },
    ok: { choice: null, label: t("dialog.ok") },
  };
}

function ScriptDialog({ dialog }: { dialog: PendingDialog }) {
  useI18n();
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
        <Dialog
          aria-label={dialog.title || t("dialog.title")}
          className="confirm-dialog script-dialog"
        >
          <Heading slot="title">{dialog.title}</Heading>
          <p className="script-dialog-content">{dialog.content}</p>
          <div className="confirm-actions">
            {buttons.map((button) => {
              const meta = buttonMeta()[button] ?? { choice: null, label: button };
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
