if (data.running) {
    reject("上一次未完成");
} else {
    data.running = true;
    var left_times = 5;
    function counter() {
        if (left_times > 0) {
            log_notice(`定时器计数: ${left_times}`);
            left_times -= 1;

            require("timers").setTimeout(function(){
                counter();
            }, 1000);
            return;
        }
        log_notice("定时器结束");
        resolve();
    }
    counter();
}
