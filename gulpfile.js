// 获取依赖
var gulp = require("gulp"),
  childProcess = require("child_process"),
  electron = require("electron"),
  electron_packger = require("electron-packager");

var packger_options = {
  dir: ".",
  icon: `${__dirname}/doc/logo.ico`,
  ignore: [
    "node_modules/.bin",
    "node_modules/electron",
    "node_modules/electron-prebuilt",
    "node_modules/electron-prebuilt-compile",
    "node_modules/electron-packager",
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
gulp.task("copy-libs", function (done) {
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
  gulp.series("copy-libs", function (done) {
    const args = ["."];
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
  gulp.series("copy-libs", function (done) {
    const args = ["--inspect-brk=5858", "."];
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
  gulp.series("copy-libs", function (done) {
    var opts = extend_options({}, packger_options, {
      platform: "win32",
      arch: "all",
    });
    electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    }).then(function () {
      done();
    });
  })
);

gulp.task(
  "package-linux",
  gulp.series("copy-libs", function (done) {
    var opts = extend_options({}, packger_options, {
      platform: "linux",
      arch: "all",
    });
    electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    }).then(function () {
      done();
    });
  })
);

gulp.task(
  "package-darwin",
  gulp.series("copy-libs", function (done) {
    var opts = extend_options({}, packger_options, {
      platform: "darwin",
      arch: "all",
      icon: `${__dirname}/doc/logo.icns`,
    });
    electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    }).then(function () {
      done();
    });
  })
);

gulp.task(
  "package-all",
  gulp.series("copy-libs", function (done) {
    var opts = extend_options({}, packger_options, {
      platform: "all",
      arch: "all",
    });
    electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    }).then(function () {
      done();
    });
  })
);

gulp.task(
  "package-test",
  gulp.series("copy-libs", function (done) {
    const test_packger_options = {};
    for (const key in packger_options) {
      if (key != "icon") {
        test_packger_options[key] = packger_options[key];
      }
    }

    const os = require("os");
    var opts = extend_options({}, test_packger_options, {
      platform: os.platform(),
      arch: "all",
    });

    electron_packger(opts, function (err, appPaths) {
      if (err) {
        console.log(`${appPaths}: ${err}`);
      }
    }).then(function () {
      done();
    });
  })
);
