// 获取依赖
const gulp = require("gulp"),
  childProcess = require("child_process"),
  electron = require("electron"),
  electron_packger = require("@electron/packager"),
  os = require("os");

var packger_options = {
  dir: ".",
  icon: `${__dirname}/doc/logo.ico`,
  ignore: [
    "node_modules/.bin",
    "node_modules/electron",
    "node_modules/electron-prebuilt",
    "node_modules/electron-prebuilt-compile",
    "node_modules/electron-packager",
    "node_modules/@electron",
    ".git",
    ".gitignore",
    ".vscode",
  ],
  out: "out",
  platform: "all",
  arch: "all",
  overwrite: true,
  prune: true,
  asar: true,
};

if ("darwin" == os.platform().toLowerCase()) {
  packger_options.asar = false; // macOS can not read from asar
}

function extend_options(ret) {
  for (var src_i = 1; src_i < arguments.length; ++src_i) {
    const src = arguments[src_i] || {};
    ret = ret || {};
    for (const i in src) {
      if ("object" == typeof src[i] && "object" == typeof ret[i]) {
        ret[i] = extend_options(ret[i], src[i]);
      } else {
        ret[i] = src[i];
      }
    }
  }

  return ret;
}

// 创建 gulp 任务
gulp.task("copy-libs", (done) => {
  // gulp.src('./node_modules/bootstrap/**')
  //   .pipe(gulp.dest('./src/node_modules/bootstrap'))
  //   ;
  // gulp.src('./node_modules/jquery/**')
  //   .pipe(gulp.dest('./src/node_modules/jquery'))
  //   ;
  // gulp.src('./node_modules/jquery.fancytree/**')
  //   .pipe(gulp.dest('./src/node_modules/jquery.fancytree'))
  //   ;
  // gulp.src('./node_modules/popper.js/**')
  //   .pipe(gulp.dest('./src/node_modules/popper.js'))
  //   ;

  done();
});

gulp.task(
  "run",
  gulp.series("copy-libs", (done) => {
    const args = ["--", "."];
    for (const v of process.argv.slice(3)) {
      args.push(v);
    }
    console.log(args);
    childProcess.spawn(electron, args, {
      stdio: "inherit",
    });

    done();
  })
);

gulp.task(
  "debug-run",
  gulp.series("copy-libs", (done) => {
    const args = ["--", ".", "--debug"];
    for (const v of process.argv.slice(3)) {
      args.push(v);
    }
    console.log(args);
    childProcess.spawn(electron, args, {
      stdio: "inherit",
    });

    done();
  })
);

gulp.task(
  "debug",
  gulp.series("copy-libs", (done) => {
    const args = ["--inspect-brk=5858", "--", "."];
    for (const v of process.argv.slice(3)) {
      args.push(v);
    }
    console.log(args);
    childProcess.spawn(electron, args, {
      stdio: "inherit",
    });

    done();
  })
);

gulp.task(
  "package-win32",
  gulp.series("copy-libs", (done) => {
    const os = require("os");
    if (os.platform() === "win32") {
      process.env["PATH"] =
        process.env["PATH"] + ";C:/Windows/System32/WindowsPowerShell/v1.0";
    }
    var opts = extend_options({}, packger_options, {
      platform: "win32",
      arch: "all",
    });
    return electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    })
      .then(function () {
        done();
      })
      .catch(function (reason) {
        console.error(`Package failed: ${reason}`);
        done();
      });
  })
);

gulp.task(
  "package-linux",
  gulp.series("copy-libs", (done) => {
    var opts = extend_options({}, packger_options, {
      platform: "linux",
      arch: "all",
    });
    return electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    })
      .then(function () {
        done();
      })
      .catch(function (reason) {
        console.error(`Package failed: ${reason}`);
        done();
      });
  })
);

gulp.task(
  "package-darwin",
  gulp.series("copy-libs", (done) => {
    var opts = extend_options({}, packger_options, {
      platform: "darwin",
      arch: "all",
      icon: `${__dirname}/doc/logo.icns`,
    });
    return electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    })
      .then(function () {
        done();
      })
      .catch(function (reason) {
        console.error(`Package failed: ${reason}`);
        done();
      });
  })
);

gulp.task(
  "package-all",
  gulp.series("copy-libs", (done) => {
    var opts = extend_options({}, packger_options, {
      platform: "all",
      arch: "all",
    });
    return electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    })
      .then(function () {
        done();
      })
      .catch(function (reason) {
        console.error(`Package failed: ${reason}`);
        done();
      });
  })
);

gulp.task(
  "package-test",
  gulp.series("copy-libs", (done) => {
    const test_packger_options = {};
    for (const key in packger_options) {
      if (key != "icon") {
        test_packger_options[key] = packger_options[key];
      }
    }

    var opts = extend_options({}, test_packger_options, {
      platform: os.platform(),
      arch: "all",
    });

    return electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    })
      .then(function () {
        done();
      })
      .catch(function (reason) {
        console.error(`Package failed: ${reason}`);
        done();
      });
  })
);
