/**
 * 弹框宿主（F09 alert_warning/alert_error 与用户确认弹框）。
 * P4-05 在此挂载 React Aria Dialog，保持 yes/no/on_close 回调语义与焦点恢复；
 * 被终止 worker 的弹框自动失效，不能点击旧回调。
 */
export function DialogHost() {
  return <div className="dialog-host" data-testid="dialog-host" />;
}
