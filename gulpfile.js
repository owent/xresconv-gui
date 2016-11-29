// 获取依赖
var gulp = require('gulp'), childProcess = require('child_process'),
    electron = require('electron-prebuilt'),
    electron_packger = require('electron-packager');

var packger_options = {
  dir: '.',
  icon: 'doc/logo.ico',
  ignore: ['node_modules', '.git', '.gitignore', '.vscode'],
  out: 'out',
  platform: 'all',
  arch: 'all',
  overwrite: true
};

function extend_options(opts, src) {
  src = src || packger_options;
  var ret = {};
  for (var i in src) {
    if ('object' == typeof(src[i])) {
      ret[i] = extend_options({}, src[i]);
    } else {
      ret[i] = src[i];
    }
  }

  if (opts) {
    for (var i in opts) {
      ret[i] = opts[i];
    }
  }

  return ret;
}

// 创建 gulp 任务
gulp.task('copy-libs', function() {
  gulp.src('./node_modules/bootstrap/dist/**')
      .pipe(gulp.dest('./src/lib/bootstrap'));
  gulp.src('./node_modules/jquery/dist/**').pipe(gulp.dest('./src/lib/jquery'));
  gulp.src('./node_modules/jquery.fancytree/dist/**')
      .pipe(gulp.dest('./src/lib/jquery.fancytree'));
});

gulp.task('run', ['copy-libs'], function() {
  childProcess.spawn(electron, ['.'], {stdio: 'inherit'});
});

gulp.task('debug', ['copy-libs'], function() {
  childProcess.spawn(electron, ['--debug-brk=5858', '.'], {stdio: 'inherit'});
});

gulp.task('package', ['copy-libs'], function() {
  electron_packger(
      extend_options({
        platform: 'all',
        arch: 'x64',
      }),
      function(err, appPaths) {
        if (err) {
          console.log(`${appPaths}: ${err}`);
        }
      });
});

gulp.task('package-all', ['copy-libs'], function() {
  electron_packger(
      extend_options({
        platform: 'all',
        arch: 'all',
      }),
      function(err, appPaths) {
        if (err) {
          console.log(`${appPaths}: ${err}`);
        }
      });
});

gulp.task('package-test', ['copy-libs'], function() {
  electron_packger(
      extend_options({
        platform: 'win32',
        arch: 'x64',
      }),
      function(err, appPaths) {
        if (err) {
          console.log(`${appPaths}: ${err}`);
        }
      });
});