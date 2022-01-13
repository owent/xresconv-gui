const os = require("os");

const app_config = {
  debug: false,
  width: 1280,
  height: 768,
  minWidth: 1280,
  minHeight: 768,
  icon: `${__dirname}/../doc/logo.ico`,
  main: `file://${__dirname}/index.html`,
  log_configure: null,
};

if ("darwin" == os.platform().toLowerCase()) {
  app_config.icon = `${__dirname}/../doc/logo.png`; // darwin should use png as icon
}

const electron = require("electron");
// Module to control application life.
const { app } = electron;
// Module to create native browser window.
const { BrowserWindow } = electron;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win = null;
let hold = false;
const custom_selectors = {
  files: [],
  selectors: [],
};

const INPUT_PARAMS_MODE = {
  NONE: 0,
  INPUT_FILE: 1,
  CUSTOM_BUTTON: 2,
  LOG_CONFIGURE: 3,
};

function readCustomSelectors(file_path) {
  const fs = require("fs");
  return new Promise((resolve, reject) => {
    fs.readFile(
      file_path,
      {
        encoding: "utf8",
        flag: "r",
      },
      (err, data) => {
        if (err) {
          reject(`Read file ${file_path} failed: ${err.toString()}`);
          return;
        }

        try {
          const ret = [];
          const jsonContent = JSON.parse(data);
          if (Array.isArray(jsonContent)) {
            for (var i = 0; i < jsonContent.length; ++i) {
              ret.push(jsonContent[i]);
            }
          } else {
            ret.push(jsonContent);
          }
          resolve(ret);
        } catch (e) {
          reject(`Parse json of ${file_path} failed: ${e.toString()}`);
        }
      }
    );
  });
}

async function readAllCustomSelectors(custom_selector_files) {
  const ret = [];

  for (const file_path of custom_selector_files) {
    try {
      const result = await readCustomSelectors(file_path);
      if (Array.isArray(result)) {
        for (var i = 0; i < result.length; ++i) {
          ret.push(result[i]);
        }
      } else {
        ret.push(result);
      }
    } catch (err) {
      ret.push(err);
    }
  }

  return ret;
}

function createWindow() {
  var main_url = app_config.main;

  if (process) {
    var input_file = null;
    custom_selectors.files = [];
    var param_mode = INPUT_PARAMS_MODE.NONE;
    for (const v of process.argv) {
      switch (param_mode) {
        case INPUT_PARAMS_MODE.INPUT_FILE: {
          input_file = v;
          param_mode = INPUT_PARAMS_MODE.NONE;
          break;
        }
        case INPUT_PARAMS_MODE.CUSTOM_BUTTON: {
          custom_selectors.files.push(v);
          param_mode = INPUT_PARAMS_MODE.NONE;
          break;
        }
        case INPUT_PARAMS_MODE.LOG_CONFIGURE: {
          app_config.log_configure = v;
          param_mode = INPUT_PARAMS_MODE.NONE;
          break;
        }
        default: {
          if (v == "--input") {
            param_mode = INPUT_PARAMS_MODE.INPUT_FILE;
          } else if (v == "--custom-selector" || v == "--custom-button") {
            param_mode = INPUT_PARAMS_MODE.CUSTOM_BUTTON;
          } else if (v == "--debug") {
            app_config.debug = true;
          } else if (v == "--log-configure") {
            param_mode = INPUT_PARAMS_MODE.LOG_CONFIGURE;
          }
          break;
        }
      }
    }

    if (input_file) {
      main_url =
        main_url +
        "?input=" +
        encodeURIComponent(input_file.replace(/\\/g, "/"));
    }
  }

  // Create the browser window.
  win = new BrowserWindow({
    width: app_config.width,
    height: app_config.height + (app_config.debug ? 28 : 0),
    minWidth: app_config.minWidth,
    minHeight: app_config.minHeight + (app_config.debug ? 28 : 0),
    resizable: app_config.debug,
    movable: true,
    closable: true,
    fullscreenable: app_config.debug,
    skipTaskbar: false,
    frame: true,
    autoHideMenuBar: !app_config.debug,
    icon: app_config.icon,
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
    },
  });
  hold = false;

  // Emitted when the window is closed.
  win.on("closed", () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  // and load the index.html of the app.
  win.loadURL(main_url);

  // Open the DevTools.
  if (app_config.debug) {
    win.webContents.openDevTools();
  }
}

const { ipcMain } = require("electron");
ipcMain.on("ipc-main", (event, arg) => {
  if (arg === "reload") {
    setTimeout(function () {
      hold = true;
      if (win) {
        win.close();
      }
      createWindow();
    }, 50);
  }

  event.reply("ok");
});

ipcMain.on("ipc-resize-window", (event, arg) => {
  if (win) {
    //win.setSize(arg.width, arg.height + app_config.height + (app_config.debug ? 28 : 0));
    win.setContentSize(
      Math.min(Math.ceil(arg.width), 1778),
      Math.min(Math.ceil(arg.height), 1000)
    );
  }
  event.reply("ok");
});

ipcMain.handle("ipc-get-custom-selectors", async (event, _) => {
  if (custom_selectors.selectors && custom_selectors.selectors.length > 0) {
    return custom_selectors.selectors;
  }

  if (!custom_selectors.files || custom_selectors.files.length <= 0) {
    return custom_selectors.selectors;
  }

  return await readAllCustomSelectors(custom_selectors.files).then((ret) => {
    custom_selectors.selectors = ret;
    return ret;
  });
});

ipcMain.handle("ipc-reload-custom-selectors", (event, _) => {
  custom_selectors.selectors = [];
});

ipcMain.handle("ipc-get-log4js", async (event, _) => {
  return app_config.log_configure;
});

ipcMain.handle("ipc-get-app-version", async (event, _) => {
  const appVersion = app.getVersion();
  return appVersion;
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (!hold && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (!hold && win === null) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
