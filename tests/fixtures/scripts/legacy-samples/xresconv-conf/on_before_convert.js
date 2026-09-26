// 这里可以执行nodejs代码，比如下面是Windows平台执行 echo work_dir
var os = require("os");
var spawn = require("child_process").spawn;
if (os.type().substr(0, 7).toLowerCase() == "windows") {
    var exec = spawn("cmd", ["/c", "echo " + work_dir], {
        cwd: work_dir,
        encoding: 'utf-8'
    });
    exec.stdout.on("data", function(data) {
        log_info(data);
    });
    exec.stderr.on("data", function(data) {
        log_error(data);
    });
    exec.on("error", function(data) {
        log_error(data.toString());
        resolve();
        // reject("执行失败" + data.toString());
    });
    exec.on("exit", function(code) {
        if (code === 0) {
            resolve();
        } else {
            resolve();
            // reject("执行失败");
        }
    });
} else {
    resolve();
}
