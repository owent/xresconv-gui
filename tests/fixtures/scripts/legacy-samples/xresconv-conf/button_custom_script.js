// 同上
data.call_times = (data.call_times || 0) + 1;
alert_warning("自定义脚本，可用于自定义按钮");
log_notice(`自定义脚本:\n可用于自定义按钮 - notice日志(${data.call_times})`);
log_warning("自定义脚本\n可用于自定义按钮 - warning日志");
// resolve();
data.running = false;
resolve();
