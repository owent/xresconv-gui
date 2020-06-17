const app_config = {
  debug: false,
  width: 1280,
  height: 768,
  minWidth: 1280,
  minHeight: 768,
  icon: `${__dirname}/../doc/logo.ico`,
  main: `file://${__dirname}/index.html`,
};

const electron = require("electron");
// Module to control application life.
const { app } = electron;
// Module to create native browser window.
const { BrowserWindow } = electron;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
let hold = false;

function createWindow() {
  var main_url = app_config.main;
  if (process) {
    var is_input = false;
    for (const v of process.argv) {
      if (is_input) {
        main_url =
          main_url + "?input=" + encodeURIComponent(v.replace(/\\/g, "/"));
        is_input = false;
        break;
      } else if (v == "--input") {
        is_input = true;
      } else if (v == "--debug") {
        app_config.debug = true;
      }
    }
  }

  // Create the browser window.
  win = new BrowserWindow({
    width: app_config.width,
    height: app_config.height + (app_config.debug ? 28 : 0),
    minWidth: app_config.minWidth,
    minHeight: app_config.minHeight,
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
