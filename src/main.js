// WebKit的编码转换有点奇怪的
const process = require("node:process");
const bootstrap = require("bootstrap");

var conv_data = {};
var xconv_gui_options = {
  parallelism: 4,
  parallelism_max: 16,
};
const log4js = require("log4js");

function generate_id() {
  ++conv_data.id_index;

  return conv_data.id_index;
}

function convert_to_boolean(input) {
  if (!input) {
    return false;
  }

  if (Array.isArray(input)) {
    return input.length > 0;
  }

  if (typeof input == "string") {
    const input_lower = input.toLocaleLowerCase();
    return (
      input_lower.length > 0 &&
      input_lower != "no" &&
      input_lower != "false" &&
      input_lower != "0" &&
      input_lower != "disable" &&
      input_lower != "disabled"
    );
  }

  if (typeof input == "number") {
    return input != 0;
  }

  if (input instanceof HTMLElement) {
    if (input.checked === undefined) {
      return convert_to_boolean(input.value);
    } else {
      return convert_to_boolean(input.checked);
    }
  }

  return !!input;
}

function reload_window() {
  const { ipcRenderer } = require("electron");
  ipcRenderer.send("ipc-main", "reload");
}

function on_resize_windows() {
  const window_height = jQuery(window).outerHeight();
  const info_list_panel_height = jQuery("#info_list_panel").outerHeight();
  const logs_panel_height = jQuery("#conv_list_run_log_panel").outerHeight();

  jQuery("#conv_list_panel").css({
    "max-height": window_height,
  });
  jQuery("#conv_list_run_log_panel").css({
    height: window_height - info_list_panel_height + logs_panel_height,
  });
  /**
  const watch_jdom = jQuery("#conv_details_panel");
  const new_height =
    Math.ceil(watch_jdom.outerHeight()) +
    Math.ceil(watch_jdom.offset().top) * 2;
  const new_size = {
    height: new_height,
    width: Math.ceil(new_height / 0.5625),
  };
  console.log(
    `Send resize message to main frame(height: ${new_size.height}, width: ${new_size.width})`
  );
  jQuery("#conv_list_panel").css({
    "max-height": new_height,
  });
  const { ipcRenderer } = require("electron");
  ipcRenderer.send("ipc-resize-window", new_size);
  **/
}

function setup_auto_resize_window() {
  jQuery(window).on("resize", () => {
    on_resize_windows();
  });

  // jQuery('#conv_list_internal_btn_group').outerHeight();
  // jQuery('#conv_list_custom_btn_group').outerHeight();
  // jQuery('#conv_details_options_panel').outerHeight();
  // jQuery('#conv_list_action_panel').outerHeight() -
  // const resizeObserver = new ResizeObserver((_) => {
  //   on_resize_windows();
  // });
  // resizeObserver.observe(document.getElementById("conv_details_panel"));
  on_resize_windows();
}

process.on("uncaughtException", function (err) {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", function (reason, promise) {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("SIGINT", function () {
  console.log("Received SIGINT. Exiting...");
  // process.exit(0);
});

function match_string_rule(rule, input) {
  if (!input && !rule) {
    return true;
  }

  if (!input || !rule) {
    return false;
  }

  return rule.apply(this, [input]);
}

function build_match_string_rule(rule, name) {
  if (!rule) {
    return (input) => {
      return !input;
    };
  }

  try {
    if (rule.toLowerCase().substr(0, 6) == "regex:") {
      const regex_rule = new RegExp(rule.substr(6).trim());
      return (input) => {
        return (input || "").match(regex_rule);
      };
    } else if (rule.toLowerCase().substr(0, 5) == "glob:") {
      const minimatch = require("minimatch");
      const glob_rule = new minimatch.Minimatch(rule.substr(5).trim());
      return (input) => {
        return glob_rule.match(input);
      };
    } else {
      return (input) => {
        return input == rule;
      };
    }
  } catch (e) {
    if (name) {
      logger_append_error_message(`${name} 的规则无效: ${rule}`);
    }
    logger_append_error_message(e);
    return (input) => {
      return input == rule;
    };
  }
}

function logger_append_style_message(msg, module_name, style) {
  const run_log = $("#conv_list_run_log_panel");

  const log_object = {
    message: msg,
    module_name: module_name || "",
    style: style,
  };

  if (
    conv_data.gui &&
    conv_data.gui.append_log_context &&
    conv_data.gui.on_append_log &&
    !conv_data.gui.append_log_callback_guard
  ) {
    try {
      conv_data.gui.append_log_callback_guard = true;
      let vm_context = null;
      for (const vm_script of conv_data.gui.on_append_log) {
        if (!vm_script.enabled) {
          continue;
        }

        if (!vm_context) {
          const vm = require("node:vm");
          vm_context = vm.createContext(
            jQuery.extend(
              {
                data: log_object,
              },
              conv_data.gui.append_log_context
            )
          );
        }
        vm_script.fn.runInContext(vm_context, {
          displayErrors: true,
          timeout: vm_script.timeout,
          breakOnSigint: true,
        });
      }
    } catch (err) {
      const err_msg = logger_format_exception_message(
        err,
        "append log event script"
      );
      logger_append_error_message(err_msg, "APPEND LOG EVENT EXCEPTION");
    }

    conv_data.gui.append_log_callback_guard = false;
  }

  const log_item = document.createElement("div");
  log_item.className = `alert ${log_object.style} alert-compact`;
  log_item.setAttribute("role", "alert");

  if (run_log) {
    if (log_object.module_name) {
      log_item.innerHTML = `[${
        log_object.module_name
      }]: ${log_object.message.toString()}`;
    } else {
      log_item.innerHTML = log_object.message.toString();
    }
    run_log.append(log_item);

    run_log.scrollTop(run_log.prop("scrollHeight"));
  }

  return log_item;
}

function logger_append_info_message(msg, module_name) {
  if (msg instanceof Error) {
    return logger_append_error_message(
      logger_format_exception_message(msg, module_name),
      module_name
    );
  }

  const ret = logger_append_style_message(msg, module_name, "alert-secondary");
  if (log4js) {
    const log = log4js.getLogger(module_name);
    if (log) {
      log.info(ret.innerText);
    }
  }
  return ret;
}

function logger_append_notice_message(msg, module_name) {
  if (msg instanceof Error) {
    return logger_append_error_message(
      logger_format_exception_message(msg, module_name),
      module_name
    );
  }

  const ret = logger_append_style_message(msg, module_name, "alert-primary");
  if (log4js) {
    const log = log4js.getLogger(module_name);
    if (log) {
      log.info(ret.innerText);
    }
  }
  return ret;
}

function logger_append_warning_message(msg, module_name, need_alert) {
  if (msg instanceof Error) {
    return logger_append_error_message(
      logger_format_exception_message(msg, module_name),
      module_name,
      need_alert
    );
  }

  const ret = logger_append_style_message(msg, module_name, "alert-warning");
  console.warn(ret.innerText);
  if (log4js) {
    const log = log4js.getLogger(module_name);
    if (log) {
      log.warn(ret.innerText);
    }
  }
  if (need_alert) {
    alert_error(ret.innerHTML);
  }
  return ret;
}

function logger_append_error_message(msg, module_name, need_alert) {
  if (msg instanceof Error) {
    return logger_append_error_message(
      logger_format_exception_message(msg, module_name),
      module_name,
      need_alert
    );
  }

  const ret = logger_append_style_message(msg, module_name, "alert-danger");
  console.error(ret.innerText);
  if (log4js) {
    const log = log4js.getLogger(module_name);
    if (log) {
      log.error(ret.innerText);
    }
  }

  if (need_alert) {
    alert_error(ret.innerHTML);
  }
  return ret;
}

function logger_format_exception_message(err, module_name, msg) {
  msg = msg || "";
  const html_content = `${err.stack ? err.stack.toString() : err.toString()}`
    .replace("<", "&lt;")
    .replace(">", "&gt;");

  if (module_name) {
    return `[${module_name}]: ${msg}<pre class="conv_pre_default conv_pre_error">${html_content}</pre>`;
  } else {
    return `${msg}<pre class="conv_pre_default conv_pre_error">${html_content}</pre>`;
  }
}

function custom_selector_on_click(selector, force_selected) {
  if (selector.items === undefined) {
    selector.items = [];
    for (const item_key in conv_data.items || {}) {
      const item = conv_data.items[item_key];
      if (item.file && item.scheme) {
        for (const scheme_rule of selector.by_schemes || []) {
          if (!scheme_rule.file_fn) {
            scheme_rule.file_fn = build_match_string_rule(
              scheme_rule.file,
              selector.name
            );
          }
          if (scheme_rule.scheme && !scheme_rule.scheme_fn) {
            scheme_rule.scheme_fn = build_match_string_rule(
              scheme_rule.scheme,
              selector.name
            );
          }
          build_match_string_rule;
          const match_file_name = match_string_rule(
            scheme_rule.file_fn,
            item.file
          );
          const match_scheme_name =
            !scheme_rule.scheme ||
            match_string_rule(scheme_rule.scheme_fn, item.scheme);
          if (match_file_name && match_scheme_name) {
            selector.items.push(item);
            break;
          }
        }
      } else if (item.scheme_data && item.scheme_data.DataSource) {
        const data_srouces = [];
        if (Array.isArray(item.scheme_data.DataSource)) {
          for (const data_source of item.scheme_data.DataSource) {
            data_srouces.push(data_source.split("|"));
          }
        } else {
          data_srouces.push(item.scheme_data.DataSource.split("|"));
        }
        var has_matched = false;
        for (const sheet_rule of selector.by_sheets || []) {
          if (has_matched) {
            break;
          }

          if (!sheet_rule.file_fn) {
            sheet_rule.file_fn = build_match_string_rule(
              sheet_rule.file,
              selector.name
            );
          }
          if (sheet_rule.sheet && !sheet_rule.sheet_fn) {
            sheet_rule.sheet_fn = build_match_string_rule(
              sheet_rule.sheet,
              selector.name
            );
          }

          for (const data_srouce of data_srouces) {
            const match_file_name = match_string_rule(
              sheet_rule.file_fn,
              data_srouce[0]
            );
            const match_sheet_name =
              !sheet_rule.sheet ||
              match_string_rule(sheet_rule.sheet_fn, data_srouce[1]);
            if (match_file_name && match_sheet_name) {
              selector.items.push(item);
              has_matched = true;
              break;
            }
          }
        }
      }
    }

    for (const item of selector.items) {
      console.log(`Custom selector "${selector.name}" add "${item.name}"`);
    }
  }

  if (force_selected === undefined) {
    force_selected = false;
    for (const item of selector.items || []) {
      if (item.ft_node && !item.ft_node.isSelected()) {
        force_selected = true;
        break;
      }
    }
  }

  for (const item of selector.items || []) {
    if (item.ft_node) {
      item.ft_node.setSelected(force_selected);
    }
  }
}

function shell_color_to_html(data) {
  const style_map = {
    1: "font-weight: bolder;",
    4: "text-decoration: underline;",
    30: "color: black;",
    31: "color: darkred;",
    32: "color: darkgreen;",
    33: "color: brown;",
    34: "color: darkblue;",
    35: "color: purple;",
    36: "color: darkcyan;",
    37: "color: gray;",
    40: "background-color: black;",
    41: "background-color: darkred;",
    42: "background-color: darkgreen;",
    43: "background-color: brown;",
    44: "background-color: darkblue;",
    45: "background-color: purple;",
    46: "background-color: darkcyan;",
    47: "background-color: white;",
  };

  const split_group = data.toString().split(/(\x1b?\[[\d;]*m)/g);
  var span_level = 0;

  function finish_tail() {
    var ret = "";
    while (span_level > 0) {
      --span_level;
      ret += "</span>";
    }
    return ret;
  }
  const convert_group = [];
  for (var i = 0; i < split_group.length; ++i) {
    const msg = split_group[i];
    if (msg.match(/^\x1b?\[[\d;]*m$/)) {
      var all_flags = msg.match(/\d+/g);
      var style_list = [];
      for (var j = 0; all_flags && j < all_flags.length; ++j) {
        if ("0" == all_flags[j]) {
          convert_group.push(finish_tail());
          break;
        } else if (style_map[all_flags[j]]) {
          style_list.push(style_map[all_flags[j]]);
        }
      }

      if (style_list.length > 0) {
        ++span_level;
        convert_group.push('<span style="' + style_list.join(" ") + '">');
      }
    } else if (msg) {
      convert_group.push(msg);
    }
  }

  return (convert_group.join("") + finish_tail())
    .replace(/\r\n/g, "\n")
    .replace(/ /g, "&nbsp;")
    .replace(/\t/g, "&nbsp;&nbsp;")
    .replace(/\n/g, "<br />");
}

function run_custom_button_action_script(custom_button, script_name) {
  if (
    conv_data.gui.scripts &&
    conv_data.gui.scripts &&
    conv_data.gui.scripts[script_name]
  ) {
    const custom_script = conv_data.gui.scripts[script_name];
    try {
      const tree = $.ui.fancytree.getTree("#conv_list");
      const selected_nodes = tree.getSelectedNodes();

      const selected_items = [];
      selected_nodes.forEach(function (node) {
        if (node.key && conv_data.items[node.key]) {
          selected_items.push(conv_data.items[node.key]);
        }
      });

      const vm = require("node:vm");
      const vm_context_obj = {
        work_dir: custom_script.work_dir,
        configure_file: (conv_data.input_file || {}).path,
        xresloader_path: jQuery("#conv_list_xresloader").val(),
        global_options: conv_data.global_options || [],
        selected_nodes: selected_nodes,
        selected_items: selected_items,
        alert_warning: alert_warning,
        alert_error: alert_error,
        log_info: function (content) {
          if (content) {
            logger_append_info_message(
              content,
              `CONV SCRIPT:${shell_color_to_html(script_name)}`
            );
          }
        },
        log_notice: function (content) {
          if (content) {
            logger_append_notice_message(
              content,
              `CONV SCRIPT:${shell_color_to_html(script_name)}`
            );
          }
        },
        log_warning: function (content) {
          if (content) {
            logger_append_warning_message(
              content,
              `CONV SCRIPT:${shell_color_to_html(script_name)}`
            );
          }
        },
        log_error: function (content) {
          if (content) {
            logger_append_error_message(
              content,
              `CONV SCRIPT:${shell_color_to_html(script_name)}`
            );
          }
        },
        // resolve: resolve,
        // reject: reject,
        require: require,
      };

      const evt_obj = {
        vm_script: custom_script,
        has_done: false,
        timer_handle: null,
      };

      return new Promise((resolve, reject) => {
        if (evt_obj.vm_script.enabled !== undefined) {
          if (evt_obj.vm_script.enabled instanceof HTMLElement) {
            if (!convert_to_boolean(evt_obj.vm_script.enabled)) {
              evt_obj.has_done = true;
              resolve(vm_context_obj);
              return;
            }
          } else if (!evt_obj.vm_script.enabled) {
            evt_obj.has_done = true;
            resolve(vm_context_obj);
            return;
          }
        }
        let vm_context;
        try {
          vm_context = vm.createContext(
            jQuery.extend(
              {
                resolve: (value) => {
                  if (null != evt_obj.timer_handle) {
                    clearTimeout(evt_obj.timer_handle);
                    evt_obj.timer_handle = null;
                  }
                  if (!evt_obj.has_done) {
                    evt_obj.has_done = true;
                    resolve(value);
                  }
                },
                reject: (reason) => {
                  if (null != evt_obj.timer_handle) {
                    clearTimeout(evt_obj.timer_handle);
                    evt_obj.timer_handle = null;
                  }
                  if (!evt_obj.has_done) {
                    evt_obj.has_done = true;
                    reject(reason);
                  }
                },
                data: custom_button.data,
              },
              vm_context_obj
            )
          );
          evt_obj.vm_script.fn.runInContext(vm_context, {
            displayErrors: true,
            timeout: evt_obj.vm_script.timeout,
            breakOnSigint: true,
          });
          evt_obj.timer_handle = setTimeout(function () {
            evt_obj.timer_handle = null;
            if (!evt_obj.has_done) {
              evt_obj.has_done = true;
              reject("timeout");
            }
          }, evt_obj.vm_script.timeout);
        } catch (err) {
          if (null != evt_obj.timer_handle) {
            clearTimeout(evt_obj.timer_handle);
            evt_obj.timer_handle = null;
          }
          if (!evt_obj.has_done) {
            const msg = logger_format_exception_message(
              err,
              `gui.script.${script_name}`
            );
            evt_obj.has_done = true;
            reject(msg);
          }
        }
      });
    } catch (err) {
      return (async () => {
        const msg = logger_format_exception_message(
          err,
          `gui.script.${script_name}`
        );
        logger_append_error_message(msg, "GUI SCRIPT", true);
      })();
    }
  } else {
    return (async () => {
      logger_append_error_message(
        `script ${script_name} not found.`,
        "GUI SCRIPT"
      );
    })();
  }
}

function run_custom_button_action(custom_button, action_type) {
  if (typeof action_type != "string") {
    return (async () => {})();
  }

  const trim_action = action_type.trim();
  const action_name = trim_action.toLowerCase();

  if (action_name == "reload") {
    const { ipcRenderer } = require("electron");
    return ipcRenderer.invoke("ipc-reload-custom-selectors").then((_) => {
      setup_custom_selectors();
    });
  }

  if (action_name == "select_all") {
    return (async () => {
      jQuery.ui.fancytree
        .getTree("#conv_list")
        .getRootNode()
        .visit(function (node) {
          node.setSelected(true);
        });
    })();
  }

  if (action_name == "unselect_all") {
    return (async () => {
      jQuery.ui.fancytree
        .getTree("#conv_list")
        .getRootNode()
        .visit(function (node) {
          node.setSelected(false);
        });
    })();
  }

  const try_match_script = trim_action.match(/script\s*:(.*)/i);
  if (try_match_script) {
    var script_name = try_match_script[1].trim();
    if (
      script_name.length >= 2 &&
      script_name[0] == script_name[script_name.length - 1] &&
      (script_name[0] == '"' || script_name[0] == "'")
    ) {
      script_name = script_name.substr(0, script_name.length - 2);
    }

    return run_custom_button_action_script(custom_button, script_name);
  }

  return (async () => {})();
}

function setup_custom_selectors() {
  try {
    const availableStyles = [
      "outline-primary",
      "outline-secondary",
      "outline-success",
      "outline-danger",
      "outline-warning",
      "outline-info",
      "outline-light",
      "outline-dark",
      "primary",
      "secondary",
      "success",
      "danger",
      "warning",
      "info",
      "light",
      "dark",
    ];

    const { ipcRenderer } = require("electron");
    ipcRenderer.invoke("ipc-get-custom-selectors").then((custom_selectors) => {
      const conv_list_custom_btn_group = jQuery("#conv_list_custom_btn_group");

      if (!custom_selectors || custom_selectors.length <= 0) {
        conv_list_custom_btn_group.addClass("visually-hidden");
        return;
      }

      conv_list_custom_btn_group.removeClass("visually-hidden");
      conv_list_custom_btn_group.empty();

      for (const custom_selector of custom_selectors) {
        var error_message = null;

        if (typeof custom_selector == "string") {
          error_message = custom_selector;
        } else if (!custom_selector.name) {
          error_message = "自定义选择器必须配置名称";
        } else if (
          (custom_selector.by_schemes || []).length <= 0 &&
          (custom_selector.by_sheets || []).length <= 0 &&
          (custom_selector.action || []).length <= 0
        ) {
          error_message = `自定义选择器 ${custom_selector.name} 的规则无效`;
        }

        if (error_message) {
          logger_append_error_message(error_message, "CUSTOM SELECTOR");
          continue;
        }

        // 私有数据
        custom_selector.data = custom_selector.data || {};

        // 构建自定义选择器按钮
        console.log(`Add custom selector ${custom_selector.name}`);
        var style = custom_selector.style || undefined;
        if (
          !(
            style &&
            availableStyles.filter((x) => {
              return x.toLocaleLowerCase() === style;
            })
          )
        ) {
          if (custom_selector.action) {
            style = "outline-dark";
          } else {
            style = "outline-secondary";
          }
        }
        const new_btn = jQuery('<button type="button" class="btn"></button>');
        new_btn.addClass(`btn-${style}`);
        new_btn.text(custom_selector.name);
        conv_list_custom_btn_group.append(new_btn);

        if ((custom_selector.action || []).length > 0) {
          const actions = [];
          if (Array.isArray(custom_selector.action)) {
            for (const action_type of custom_selector.action) {
              actions.push(action_type);
            }
          } else {
            actions.push(action_type);
          }

          new_btn.on("click", function () {
            var future = null;
            for (const action_type of actions) {
              if (future) {
                future = future.then(() => {
                  return run_custom_button_action(custom_selector, action_type);
                });
              } else {
                future = run_custom_button_action(custom_selector, action_type);
              }
            }

            if (future) {
              future.catch(function (err) {
                logger_append_error_message(err, "CUSTOM SELECTOR");
              });
            }
          });
        } else {
          new_btn.on("click", function () {
            custom_selector_on_click(custom_selector);
          });
          if (custom_selector.default_selected) {
            custom_selector_on_click(custom_selector, true);
          }
        }

        custom_selector.dom = new_btn;
      }

      conv_data.custom_selectors = custom_selectors;
      setup_auto_resize_window();
    });
  } catch (err) {
    logger_append_error_message(err, "CUSTOM SELECTOR");
  }

  try {
    const { ipcRenderer } = require("electron");
    ipcRenderer.invoke("ipc-get-log4js").then((log_configure) => {
      try {
        if (log_configure) {
          log4js.configure(log_configure);
        } else {
          log4js.configure(require("./log4js.json"));
        }
      } catch (err) {
        logger_append_error_message(err, "LOG");
        log4js.configure(require("./log4js.json"));
      }
    });
  } catch (err) {
    logger_append_error_message(err, "LOG");
  }
}

function alert_error(content, title) {
  const title_dom = document.getElementById("dlg_alert_error_title");
  if (title_dom) {
    title_dom.innerHTML = title || "出错啦";
  }
  const content_dom = document.getElementById("dlg_alert_error_content");
  if (content_dom) {
    content_dom.innerHTML = content || "";
  }
  const modal_dom = document.getElementById("dlg_alert_error_modal");
  if (modal_dom) {
    if (!modal_dom.bootstrapModal) {
      modal_dom.bootstrapModal = new bootstrap.Modal(modal_dom);
    }
    modal_dom.bootstrapModal.show();
  }
}

function alert_warning(content, tittle, options) {
  options = options || {};
  const dlg = document.getElementById("dlg_parallelism_warning_modal");
  const dlg_body = document.getElementById("dlg_parallelism_warning_content");
  const dlg_head = document.getElementById("dlg_parallelism_warning_title");
  dlg_body.innerHTML = content || "无内容，参数错误";
  dlg_head.innerHTML = tittle || "警告";

  const btn_yes = $(
    '<button type="button" class="btn btn-secondary" data-dismiss="modal">是</button>'
  );
  const btn_no = $(
    '<button type="button" class="btn btn-secondary" data-dismiss="modal">否</button>'
  );
  btn_yes.on("click", function () {
    if (dlg.bootstrapModal) {
      dlg.bootstrapModal.hide();
    }
    if (typeof options.yes == "function") {
      options.yes.apply(this, [arguments]);
    }
    if (typeof options.on_close == "function") {
      options.on_close.apply(this, [arguments]);
    }
  });

  btn_no.on("click", function () {
    if (dlg.bootstrapModal) {
      dlg.bootstrapModal.hide();
    }
    if (typeof options.no == "function") {
      options.no.apply(this, [arguments]);
    }

    if (typeof options.on_close == "function") {
      options.on_close.apply(this, [arguments]);
    }
  });
  $(".modal-footer", dlg).empty().append(btn_yes).append(btn_no);

  if (!dlg.bootstrapModal) {
    dlg.bootstrapModal = new bootstrap.Modal(dlg);
  }
  dlg.bootstrapModal.show();
}

(function ($, window) {
  function reset_conv_data() {
    conv_data = {
      id_index: 0,
      global_options: [],
      default_scheme: {},
      java_options: ["-Dfile.encoding=UTF-8"],
      groups: {},
      items: {},
      run_seq: 0,
      gui: {
        set_name: null,
        on_before_convert: [],
        on_after_convert: [],
        on_append_log: [],
        scripts: {},
        append_log_context: null,
        append_log_callback_guard: false,
      },
      tree: [],
      category: {},
      file_map: {},
      input_file: null,
      custom_selectors: conv_data.custom_selectors || undefined,
    };
    for (const selector of conv_data.custom_selectors || []) {
      selector.items = undefined;
    }
  }

  async function get_string_file(file_path, data) {
    if (!data) {
      const fs = require("fs");
      try {
        data = await fs.promises.readFile(file_path, { encoding: "utf8" });
      } catch (err) {
        logger_append_error_message(err);
        alert_error(err.toString(), "加载 " + file_path + " 失败");
      }
    }

    const ret = {
      path: file_path,
      filename: "",
      dirname: ".",
      data: data,
    };

    const mres = ret.path.match(/[^\/\\]*$/);
    if (mres) {
      ret.filename = mres[0];
    }

    if (ret.filename && ret.path.length > ret.filename.length + 1) {
      ret.dirname = ret.path.substr(
        0,
        ret.path.length - ret.filename.length - 1
      );
    } else if (ret.filename && ret.path.length == ret.filename.length + 1) {
      ret.dirname = ret.path[0];
    }

    return ret;
  }

  async function get_dom_file(dom_id) {
    var sel_dom = document.getElementById(dom_id);
    if (!sel_dom) {
      return ret;
    }

    const file = sel_dom.files.length > 0 ? sel_dom.files[0] : null;
    if (file) {
      return await get_string_file(
        file.path ||
          (function () {
            const { webUtils } = require("electron");
            return webUtils.getPathForFile(file);
          })() ||
          sel_dom.value,
        await file.text()
      );
    } else {
      return await get_string_file(sel_dom.value);
    }
  }

  function check_matrix_rule(matrix_rule, item_data) {
    if (matrix_rule.tags && matrix_rule.tags.length > 0) {
      if (
        !output.tags.find((x) => (item_data.tags || []).find((y) => x === y))
      ) {
        return false;
      }
    }

    if (matrix_rule.classes && matrix_rule.classes.length > 0) {
      if (
        !matrix_rule.classes.find((x) =>
          (item_data.classes || []).find((y) => x === y)
        )
      ) {
        return false;
      }
    }

    return true;
  }

  function show_output_matrix() {
    const conv_list_output_custom_multi = document.getElementById(
      "conv_list_output_custom_multi"
    );
    if (
      conv_list_output_custom_multi.parentNode.selectedIndex ==
      conv_list_output_custom_multi.index
    ) {
      const run_log = $("#conv_list_run_log_panel");
      const hint_dom = conv_list_output_custom_multi.hint_dom;
      if (hint_dom) {
        run_log.append(hint_dom);
        if (log4js) {
          const log = log4js.getLogger("default");
          if (log) {
            log.info(hint_dom.text());
          }
        }
      }
      run_log.scrollTop(run_log.prop("scrollHeight"));

      // Disable all invalid nodes for matrix
      if (conv_list_output_custom_multi.output_matrix_with_rule) {
        $.ui.fancytree
          .getTree("#conv_list")
          .getRootNode()
          .visit(function (node) {
            if (node.isFolder()) {
              return;
            }
            var allow_selected = false;
            for (const matrix_rule of conv_list_output_custom_multi.output_matrix) {
              if (check_matrix_rule(matrix_rule, node.data.item)) {
                allow_selected = true;
                break;
              }
            }

            if (!allow_selected) {
              node.data.option.auto_select = node.isSelected();
              node.setSelected(false);
              node.unselectable = true;
              node.render();
            }
          });
      }
    } else {
      const hint_dom = conv_list_output_custom_multi.hint_dom;
      if (hint_dom) {
        hint_dom.remove();
      }

      // Enable all nodes for matrix
      if (conv_list_output_custom_multi.output_matrix_with_rule) {
        $.ui.fancytree
          .getTree("#conv_list")
          .getRootNode()
          .visit(function (node) {
            if (node.isFolder()) {
              return;
            }
            var allow_selected = false;
            for (const matrix_rule of conv_list_output_custom_multi.output_matrix) {
              if (check_matrix_rule(matrix_rule, node.data.item)) {
                allow_selected = true;
                break;
              }
            }

            if (!allow_selected) {
              node.unselectable = false;
              node.setSelected(node.data.option.auto_select);
              node.render();
            }
          });
      }
    }
  }

  function clear_conv_list_event_group() {
    const parent_wrapper_dom = jQuery("#conv_list_event_group_wrapper");
    const parent_inner_dom = jQuery("#conv_list_event_group_inner");
    if ((parent_inner_dom.children() || []).length > 0) {
      parent_inner_dom.empty();
      parent_wrapper_dom.addClass("visually-hidden");
    }
  }

  function append_conv_list_event_group(xml_node, event_type_name) {
    const parent_wrapper_dom = jQuery("#conv_list_event_group_wrapper");
    const parent_inner_dom = jQuery("#conv_list_event_group_inner");
    if ((parent_inner_dom.children() || []).length <= 0) {
      parent_wrapper_dom.removeClass("visually-hidden");
    }

    const wrapper = jQuery('<div class="form-check form-switch"></div>');
    const ret = jQuery('<input class="form-check-input" type="checkbox">');
    const label = jQuery(
      '<label class="form-check-label">Default switch checkbox input</label>'
    );

    const event_name = xml_node.getAttribute("name") || "";
    const default_checked = xml_node.getAttribute("checked");
    const default_mutable = xml_node.getAttribute("mutable");

    if (event_name.length <= 0) {
      if (default_checked && default_checked.length > 0) {
        return convert_to_boolean(default_checked);
      } else {
        return true;
      }
    }

    let event_type_desc;
    if (event_type_name == "on_before_convert") {
      event_type_desc = "转表前执行";
    } else if (event_type_name == "on_after_convert") {
      event_type_desc = "转表后执行";
    } else if (event_type_name == "on_append_log") {
      event_type_desc = "日志Hook";
    } else {
      event_type_name = "on_unknown_event";
      event_type_desc = "未知事件";
    }
    const id = `conv_list_event_${event_type_name}_${generate_id()}`;
    ret.attr("id", id);

    if (default_checked && default_checked.length > 0) {
      ret.prop("checked", convert_to_boolean(default_checked));
    } else {
      ret.prop("checked", true);
    }
    if (default_mutable && default_mutable.length > 0) {
      ret.prop("disabled", !convert_to_boolean(default_mutable));
    } else {
      ret.prop("disabled", false);
    }
    label.attr("for", id);
    label.text(event_name);

    wrapper.append(ret);
    wrapper.append(label);

    parent_inner_dom.append(wrapper);

    console.log(`Add ${event_type_name} event ${event_name}: ${id}`);

    wrapper.attr("title", event_type_desc);
    wrapper.attr("data-bs-toggle", "tooltip");
    wrapper.attr("data-bs-placement", "top");
    wrapper.addClass("col-auto");

    // const bootstrap = require("bootstrap");
    // new bootstrap.Tooltip(wrapper);

    return ret.get(0);
  }

  function build_conv_tree(context, current_path) {
    // $("#conv_list").empty();

    // 初始化
    let jdom;
    try {
      jdom = $(context);
    } catch (e) {
      logger_append_error_message(e.toString(), `CONFIGURE: ${current_path}`);
    }

    var include_list = [];
    // nw.js/electron 获取文件路径
    var prefix_dir = current_path.replace(/[^\\\/]*$/, "");
    //// 加载include项目
    $.each(jdom.children("include"), function (k, dom) {
      var file_path = $(dom).html();
      if (file_path) {
        if (!file_path.match(/^(\w:|\/)/i)) {
          file_path = prefix_dir + file_path;
        }
        include_list.push(file_path);
      }
    });

    var active_run = function (resolve, reject) {
      const output_matrix = [];

      // 加载并覆盖全局配置
      const conv_list_proto_files = [];
      let conv_list_data_src_dirs = undefined;

      $.each(jdom.children("global").children(), function (k, dom) {
        var tn = dom.tagName.toLowerCase();
        var val = $(dom).html().trim();

        if ("work_dir" == tn) {
          $("#conv_list_work_dir").val(val);
        } else if ("xresloader_path" == tn) {
          $("#conv_list_xresloader").val(val);
        } else if ("proto_file" == tn) {
          conv_list_proto_files.push(val);
        } else if ("output_dir" == tn) {
          $("#conv_list_output_dir").val(val);
        } else if ("data_version" == tn) {
          $("#conv_list_data_version").val(val);
        } else if ("data_src_dir" == tn || "data_source_dir" == tn) {
          if (conv_list_data_src_dirs == undefined) {
            conv_list_data_src_dirs = [];
          }
          if (val) {
            conv_list_data_src_dirs.push(val);
          }
        } else if ("rename" == tn) {
          $("#conv_list_rename").val(val);
        } else if ("proto" == tn) {
          var protocol_cfg = $("#conv_list_protocol option[value=" + val + "]");
          if (protocol_cfg.length > 0) {
            $("#conv_list_protocol").get(0).selectedIndex =
              protocol_cfg.get(0).index;
          } else {
            var parent_node = $("#conv_list_protocol");
            var unknown_node = $("<option></option>")
              .attr("value", val)
              .text("未知协议: " + val);
            parent_node.append(unknown_node);
            parent_node.get(0).selectedIndex = unknown_node.get(0).index;
          }
        } else if ("output_type" == tn) {
          const output_type_rename_rule = (
            dom.getAttribute("rename") || ""
          ).trim();
          output_matrix.push({
            type: val,
            rename: output_type_rename_rule,
            tags: (dom.getAttribute("tag") || "")
              .trim()
              .split(/[\s]+/)
              .filter((x) => !!x),
            classes: (dom.getAttribute("class") || "")
              .trim()
              .split(/[\s]+/)
              .filter((x) => !!x),
          });
        } else if ("option" == tn && val) {
          conv_data.global_options.push({
            name: dom.getAttribute("name") || val,
            desc: dom.getAttribute("desc") || val,
            value: val,
          });
        } else if ("java_option" == tn && val) {
          conv_data.java_options.push(val);
        } else if ("default_scheme" == tn && val) {
          var scheme_key = dom.getAttribute("name").trim();
          if (scheme_key) {
            if (conv_data.default_scheme[scheme_key]) {
              conv_data.default_scheme[scheme_key].push(val);
            } else {
              conv_data.default_scheme[scheme_key] = [val];
            }
          }
        }
      });

      if (conv_list_proto_files.length > 0) {
        if (conv_list_proto_files.length == 1) {
          $("#conv_list_proto_file").val(conv_list_proto_files[0]);
        } else {
          $("#conv_list_proto_file").val(JSON.stringify(conv_list_proto_files));
        }
      }

      if (conv_list_data_src_dirs !== undefined) {
        if (conv_list_data_src_dirs.length == 0) {
          $("#conv_list_data_source_dir").val("");
        }
        if (conv_list_data_src_dirs.length == 1) {
          $("#conv_list_data_source_dir").val(conv_list_data_src_dirs[0]);
        } else {
          $("#conv_list_data_source_dir").val(
            JSON.stringify(conv_list_data_src_dirs)
          );
        }
      }

      // select output_type or output_matrix
      const conv_list_output_custom_multi = document.getElementById(
        "conv_list_output_custom_multi"
      );

      conv_list_output_custom_multi.output_matrix_with_rule =
        output_matrix.length > 0;
      for (const matrix_rule of output_matrix) {
        if (matrix_rule.tags.length === 0 && matrix_rule.classes.length === 0) {
          conv_list_output_custom_multi.output_matrix_with_rule = false;
          break;
        }
      }

      if (
        output_matrix.length > 1 ||
        (output_matrix.length == 1 &&
          (output_matrix[0].tags.length > 0 ||
            output_matrix[0].classes.length > 0))
      ) {
        conv_list_output_custom_multi.parentNode.selectedIndex =
          conv_list_output_custom_multi.index;
        conv_list_output_custom_multi.output_matrix = output_matrix;
        conv_list_output_custom_multi.disabled = false;

        // build hint dom
        if (!conv_list_output_custom_multi.hint_dom) {
          conv_list_output_custom_multi.hint_dom = $(
            '<div class="alert alert-secondary" role="alert"></div>'
          );
        }
        const hint_dom = conv_list_output_custom_multi.hint_dom;
        hint_dom.empty();
        hint_dom.append(
          shell_color_to_html(
            "当前选中的是来自配置文件的[1;m自定义输出类型[0;m<br />\r\n"
          )
        );

        for (const output of output_matrix) {
          if (output.type) {
            const output_option = document.querySelector(
              '#conv_list_output_type option[value="' +
                output.type.toLowerCase() +
                '"]'
            );
            var msg =
              "&nbsp;&nbsp;&nbsp;&nbsp;输出类型: [1;32;m" +
              (output_option
                ? output_option.innerHTML
                : "未知类型:" + output.type) +
              "[0;m(" +
              output.type +
              ")";
            if (output.rename) {
              msg += '\r\n\t\t重命名规则: "[1;35;m' + output.rename + '[0;m"';
            }
            if (output.tags && output.tags.length > 0) {
              msg +=
                '\r\n\t\t限定Tag列表: "[1;35;m' +
                output.tags.map((x) => x.toString()).join(",") +
                '[0;m"';
            }
            if (output.classes && output.classes.length > 0) {
              msg +=
                '\r\n\t\t限定class列表: "[1;35;m' +
                output.classes.map((x) => x.toString()).join(",") +
                '[0;m"';
            }
            msg += "<br />\r\n";
          }

          hint_dom.append(shell_color_to_html(msg));
        }
      } else {
        if (output_matrix.length == 0) {
          output_matrix.push({
            type: "bin",
            rename: null,
          });
        }
        var output_type_cfg = $(
          '#conv_list_output_type option[value="' + output_matrix[0].type + '"]'
        );
        if (output_type_cfg.length > 0) {
          $("#conv_list_output_type").get(0).selectedIndex =
            output_type_cfg.get(0).index;
        } else {
          var parent_node = $("#conv_list_output_type");
          var unknown_node = $("<option></option>")
            .attr("value", output_matrix[0].type)
            .text("未知格式: " + output_matrix[0].type);
          parent_node.append(unknown_node);
          parent_node.get(0).selectedIndex = unknown_node.get(0).index;
        }

        if (output_matrix[0].rename) {
          $("#conv_list_rename").val(output_matrix[0].rename);
        }

        conv_list_output_custom_multi.disabled = true;
        conv_list_output_custom_multi.output_matrix = output_matrix;

        if (conv_list_output_custom_multi.hint_dom) {
          conv_list_output_custom_multi.hint_dom.empty();
        }
      }

      var work_dir = $("#conv_list_work_dir").val();
      if (
        work_dir &&
        work_dir[0] != "/" &&
        (work_dir.length < 2 || work_dir[1] != ":")
      ) {
        work_dir = prefix_dir + work_dir;
      }

      // 加载分类信息
      var treeData = conv_data.tree;
      var cat_map = conv_data.category;

      function build_tree_fn(root, xml_dom) {
        $.each($(xml_dom).children("tree"), function (k, xml_node) {
          var nj_node = $(xml_node);
          var new_option = {
            title: nj_node.attr("name") || nj_node.attr("id"),
            tooltip: nj_node.attr("name") || nj_node.attr("id"),
            folder: true,
            children: [],
          };

          if (nj_node.attr("id")) {
            cat_map[nj_node.attr("id")] = new_option;
          }

          build_tree_fn(new_option.children, nj_node);
          root.push(new_option);
        });
      }
      build_tree_fn(treeData, jdom.children("category"));

      // GUI 功能
      conv_data.gui.set_name = null;
      $.each(jdom.children("gui").children("set_name"), function (k, dom) {
        try {
          const vm = require("node:vm");
          conv_data.gui.set_name = new vm.Script($(dom).html(), {
            filename: current_path,
          });
        } catch (err) {
          const msg = logger_format_exception_message(
            err,
            "gui.set_name",
            "GUI脚本编译错误"
          );
          logger_append_error_message(msg, "GUI EVENT", true);
        }
      });

      // 重置 GUI 事件可选项
      clear_conv_list_event_group();
      conv_data.gui.on_before_convert = [];
      $.each(jdom.children("gui").children("on_before_convert"), (_, dom) => {
        try {
          const env_jdom = $(dom);
          const vm = require("node:vm");
          const timeout_str = env_jdom.attr("timeout");
          var timeout = 30000;
          if (timeout_str) {
            timeout = parseInt(timeout_str);
          }
          const fn = new vm.Script(env_jdom.html(), {
            filename: current_path,
          });
          conv_data.gui.on_before_convert.push({
            fn: fn,
            timeout: timeout,
            enabled: append_conv_list_event_group(
              env_jdom.get(0),
              "on_before_convert"
            ),
          });
        } catch (err) {
          const msg = logger_format_exception_message(
            err,
            "gui.on_before_convert",
            "GUI脚本编译错误"
          );

          logger_append_error_message(msg, "GUI EVENT", true);
        }
      });

      conv_data.gui.on_after_convert = [];
      $.each(jdom.children("gui").children("on_after_convert"), (_, dom) => {
        try {
          const env_jdom = $(dom);
          const vm = require("node:vm");
          const timeout_str = env_jdom.attr("timeout");
          var timeout = 30000;
          if (timeout_str) {
            timeout = parseInt(timeout_str);
          }
          const fn = new vm.Script(env_jdom.html(), {
            filename: current_path,
          });
          conv_data.gui.on_after_convert.push({
            fn: fn,
            timeout: timeout,
            enabled: append_conv_list_event_group(
              env_jdom.get(0),
              "on_after_convert"
            ),
          });
        } catch (err) {
          const msg = logger_format_exception_message(
            err,
            "gui.on_after_convert",
            "GUI脚本编译错误"
          );
          logger_append_error_message(msg, "GUI EVENT", true);
        }
      });

      const event_on_append_log = [];
      $.each(jdom.children("gui").children("on_append_log"), (_, dom) => {
        try {
          const env_jdom = $(dom);
          const vm = require("node:vm");
          const timeout_str = env_jdom.attr("timeout");
          var timeout = 30000;
          if (timeout_str) {
            timeout = parseInt(timeout_str);
          }
          const fn = new vm.Script(env_jdom.html(), {
            filename: current_path,
          });
          event_on_append_log.push({
            fn: fn,
            timeout: timeout,
            enabled: append_conv_list_event_group(
              env_jdom.get(0),
              "on_append_log"
            ),
          });
        } catch (err) {
          const msg = logger_format_exception_message(
            err,
            "gui.on_append_log",
            "GUI脚本编译错误"
          );
          logger_append_error_message(msg, "GUI EVENT", true);
        }
      });
      conv_data.gui.on_append_log = event_on_append_log;

      conv_data.gui.scripts = {};
      $.each(jdom.children("gui").children("script"), (key, dom) => {
        try {
          const env_jdom = $(dom);
          const vm = require("node:vm");
          const timeout_str = env_jdom.attr("timeout");
          var timeout = 30000;
          if (timeout_str) {
            timeout = parseInt(timeout_str);
          }

          const script_name = env_jdom.attr("name") || "";
          conv_data.gui.scripts[script_name] = {
            name: script_name,
            fn: new vm.Script(env_jdom.html(), {
              filename: current_path,
            }),
            timeout: timeout,
            work_dir: work_dir,
          };
        } catch (err) {
          const msg = logger_format_exception_message(
            err,
            `gui.script.${key}`,
            "GUI脚本编译错误"
          );
          logger_append_error_message(msg, "GUI SCRIPT", true);
        }
      });

      $.each(jdom.children("list").children("item"), function (k, item_node) {
        var jitem = $(item_node);
        var id = generate_id();

        var item_data = {
          id: id,
          file: jitem.attr("file"),
          scheme: jitem.attr("scheme"),
          name: jitem.attr("name").trim() || "",
          cat: jitem.attr("cat"),
          options: [],
          desc: jitem.attr("name").trim() || jitem.attr("desc").trim() || "",
          scheme_data: {},
          ft_node: null,
          tags: (jitem.attr("tag") || "")
            .trim()
            .split(/[\s]+/)
            .filter((x) => !!x),
          classes: (jitem.attr("class") || "")
            .trim()
            .split(/[\s]+/)
            .filter((x) => !!x),
        };
        const item_tag_class_text = [];
        if (item_data.tags && item_data.tags.length > 0) {
          item_tag_class_text.push("Tags: " + item_data.tags.join(","));
        }
        if (item_data.classes && item_data.classes.length > 0) {
          item_tag_class_text.push("Classes: " + item_data.classes.join(","));
        }
        const item_data_source_text = [];

        if (item_data.file && item_data.scheme) {
          item_data_source_text.push(
            '文件名: "' +
              jitem.attr("file") +
              '" 描述信息: "' +
              jitem.attr("scheme") +
              '"'
          );
        }

        $.each(jitem.children("option"), function (k, v) {
          var nj_node = $(v);
          item_data.options.push({
            name: nj_node.attr("name"),
            desc: nj_node.attr("desc"),
            value: nj_node.html().trim(),
          });
        });

        $.each(jitem.children("scheme"), function (k, v) {
          var nj_node = $(v);
          var scheme_key = nj_node.attr("name").trim();
          if (scheme_key) {
            if (item_data.scheme_data[scheme_key]) {
              item_data.scheme_data[scheme_key].push(nj_node.html());
            } else {
              item_data.scheme_data[scheme_key] = [nj_node.html()];
            }

            if (scheme_key.toLowerCase() == "datasource") {
              var data_source = nj_node.html().split("|");
              if (data_source && data_source.length > 1) {
                item_data.file = data_source[0];
                item_data_source_text.push(
                  '文件名: "' +
                    data_source[0] +
                    '" 表: "' +
                    data_source[1] +
                    '"'
                );
              } else if (data_source) {
                item_data.file = data_source[0];
                item_data_source_text.push('文件名: "' + data_source[0]);
              }
            }
          }
        });
        for (var key in conv_data.default_scheme) {
          if (!item_data.scheme_data[key]) {
            item_data.scheme_data[key] = conv_data.default_scheme[key];
          }
        }

        var scheme_info_text = "";
        if (item_data_source_text) {
          scheme_info_text += "\n -- " + item_data_source_text.join("\n -- ");
        }
        if (item_tag_class_text) {
          scheme_info_text += "\nLimit:\n\t" + item_tag_class_text.join("\n\t");
        }
        item_data.desc = item_data.desc + scheme_info_text;

        // GUI 显示规则
        if (conv_data.gui.set_name) {
          try {
            const vm = require("node:vm");
            const vm_context = vm.createContext({
              work_dir: work_dir,
              configure_file: current_path,
              item_data: item_data,
              data: {},
              alert_warning: alert_warning,
              alert_error: alert_error,
              log_info: function (content) {
                if (content) {
                  logger_append_info_message(
                    shell_color_to_html(content),
                    "CONV EVENT"
                  );
                }
              },
              log_notice: function (content) {
                if (content) {
                  logger_append_notice_message(
                    shell_color_to_html(content),
                    "CONV EVENT"
                  );
                }
              },
              log_warning: function (content) {
                if (content) {
                  logger_append_warning_message(
                    shell_color_to_html(content),
                    `CONV EVENT`
                  );
                }
              },
              log_error: function (content) {
                if (content) {
                  logger_append_error_message(
                    shell_color_to_html(content),
                    "CONV EVENT"
                  );
                }
              },
            });
            conv_data.gui.set_name.runInContext(vm_context);
          } catch (err) {
            const msg = logger_format_exception_message(
              err,
              "gui.set_name",
              "GUI脚本编译错误"
            );
            logger_append_error_message(msg, "GUI EVENT", true);
          }
        }

        conv_data.items[item_data.id] = item_data;

        const ft_node = {
          title: item_data.name,
          tooltip: item_data.desc,
          key: item_data.id,
          data: {
            item: item_data,
            option: {
              auto_select: false,
            },
          },
        };
        // item_data.ft_node = ft_node;
        if (item_data.cat && cat_map[item_data.cat]) {
          cat_map[item_data.cat].children.push(ft_node);
        } else {
          treeData.push(ft_node);
        }
      });

      // resolve promise
      resolve.apply(this, [current_path]);
    };

    var ret = null;

    while (include_list.length > 0) {
      var file_path = null;

      file_path = include_list.shift();

      try {
        if (conv_data.file_map[file_path]) {
          alert("文件 " + file_path + " 已被加载过，不能循环include文件");
        } else {
          conv_data.file_map[file_path] = true;

          var fs = require("fs"); // node.js - File System
          const file_inst = fs.createReadStream(file_path);

          const load_sub_file = function () {
            return new Promise(function (resolve, reject) {
              let buffer_list = [];
              file_inst.on("data", (content) => {
                buffer_list.push(content);
              });

              file_inst.on("end", (content) => {
                const buffer = require("buffer");
                resolve.apply(this, [
                  build_conv_tree(
                    buffer.Buffer.concat(buffer_list).toString(),
                    file_path
                  ),
                ]);
              });

              file_inst.on("error", (err) => {
                const msg = logger_format_exception_message(
                  err,
                  "IO",
                  `尝试读取文件失败: ${file_path}`
                );
                const log_item = logger_append_error_message(msg);
                console.error(log_item.innerText);
                alert(log_item.innerText);

                reject.apply(this, [msg]);
              });
            });
          };
          if (ret === null) {
            ret = load_sub_file();
          } else {
            ret.then(load_sub_file);
          }
        }
      } catch (err) {
        const msg = "文件 " + file_path + " 加载失败。" + err.toString();
        alert(msg);
        logger_append_error_message(msg);
      }
    }

    if (ret === null) {
      ret = new Promise(active_run);
    } else {
      ret = ret.then(() => {
        return new Promise(active_run);
      });
    }
    return ret;
  }

  function rebind_ft_node_and_item(ft_node) {
    if (ft_node.data && ft_node.data.item) {
      ft_node.data.item.ft_node = ft_node;
    }

    if (ft_node.children) {
      for (const child_node of ft_node.children) {
        rebind_ft_node_and_item(child_node);
      }
    }
  }
  function show_conv_tree() {
    if ($("#conv_list").children().length > 0) {
      $("#conv_list").fancytree("destroy");
    }
    $("#conv_list").fancytree({
      checkbox: true,
      selectMode: 3,
      source: conv_data.tree,
      dblclick: function (event, data) {
        data.node.toggleSelected();
      },
      keydown: function (event, data) {
        if (event.which === 32) {
          data.node.toggleSelected();
          return false;
        }
      },
      createNode: function (_, data) {
        rebind_ft_node_and_item(data.node);
      },
      cookieId: "conv_list-ft",
      idPrefix: "conv_list-ft-",
    });

    show_output_matrix();

    for (const selector of conv_data.custom_selectors || []) {
      if (selector.default_selected) {
        custom_selector_on_click(selector, true);
      }
    }
  }

  function conv_start() {
    try {
      var work_dir = $("#conv_list_work_dir").val();
      if (
        work_dir &&
        work_dir[0] != "/" &&
        (work_dir.length < 2 || work_dir[1] != ":")
      ) {
        work_dir = conv_data.input_file.dirname + "/" + work_dir;
      }

      var xresloader_path = $("#conv_list_xresloader").val();

      var global_options = {
        "-p": $("#conv_list_protocol").val(),
        "-o": $("#conv_list_output_dir").val(),
      };

      const output_matrix = [];
      const conv_list_output_custom_multi = document.getElementById(
        "conv_list_output_custom_multi"
      );
      if (
        conv_list_output_custom_multi.parentNode.selectedIndex ==
        conv_list_output_custom_multi.index
      ) {
        const global_output_type = $("#conv_list_output_type").val();
        const global_rename_rule = $("#conv_list_rename").val();
        for (const output of conv_list_output_custom_multi.output_matrix) {
          output_matrix.push({
            type: output.type || global_output_type,
            rename: output.rename || global_rename_rule,
            tags: output.tags || null,
            classes: output.classes || null,
          });
        }
      } else {
        output_matrix.push({
          type: $("#conv_list_output_type").val(),
          rename: $("#conv_list_rename").val(),
          tags: null,
          classes: null,
        });
      }

      if ($("#conv_list_data_version").val()) {
        global_options["-a"] = $("#conv_list_data_version").val();
      }

      var tree = $.ui.fancytree.getTree("#conv_list");
      var selected_nodes = [];
      if (tree) {
        selected_nodes = tree.getSelectedNodes() || [];
      }

      var cmd_params = "";
      for (var k in global_options) {
        if (global_options[k]) {
          cmd_params += " " + k + ' "' + global_options[k] + '"';
        }
      }

      $.each(conv_data.global_options, function (k, v) {
        if (v.value) {
          cmd_params += " " + v.value;
        }
      });

      const conv_list_proto_files_str = $("#conv_list_proto_file").val().trim();
      if (
        conv_list_proto_files_str.length > 0 &&
        conv_list_proto_files_str[0] == "["
      ) {
        for (const file of JSON.parse(conv_list_proto_files_str)) {
          cmd_params += ' -f "' + file + '"';
        }
      } else {
        cmd_params += ' -f "' + conv_list_proto_files_str + '"';
      }

      const conv_list_data_src_dir_str = $("#conv_list_data_source_dir")
        .val()
        .trim();
      if (
        conv_list_data_src_dir_str.length > 0 &&
        conv_list_data_src_dir_str[0] == "["
      ) {
        for (const file of JSON.parse(conv_list_data_src_dir_str)) {
          cmd_params += ' -d "' + file + '"';
        }
      } else {
        cmd_params += ' -d "' + conv_list_data_src_dir_str + '"';
      }

      var run_log = $("#conv_list_run_log_panel");
      run_log.empty();
      run_log.removeClass("conv_list_run_error");
      run_log.removeClass("conv_list_run_success");
      run_log.addClass("conv_list_run_running");

      show_output_matrix();

      var pending_script = [];
      var selected_items = [];
      selected_nodes.forEach(function (node) {
        if (node.key && conv_data.items[node.key]) {
          selected_items.push(conv_data.items[node.key]);
          for (const output of output_matrix) {
            var item_data = conv_data.items[node.key];
            var cmd_args = cmd_params;

            if (!check_matrix_rule(output, item_data)) {
              continue;
            }

            if (output.type) {
              cmd_args += ' -t "' + output.type + '"';
            }
            if (output.rename) {
              cmd_args += ' -n "' + output.rename + '"';
            }

            for (const item_option of item_data.options) {
              if (item_option.value) {
                cmd_args += " " + item_option.value;
              }
            }

            if (item_data.file && item_data.scheme) {
              cmd_args +=
                ' -s "' + item_data.file + '" -m "' + item_data.scheme + '"';
            } else {
              for (var key in item_data.scheme_data) {
                var vals = item_data.scheme_data[key];
                for (var i in vals) {
                  cmd_args += ' -m "' + key + "=" + vals[i] + '"';
                }
              }
            }

            pending_script.push(cmd_args);
          }
        }
      });

      var run_seq = generate_id();
      var running_count = 0;
      var failed_count = 0;
      conv_data.run_seq = run_seq;

      var current_promise = new Promise(function (resolve, reject) {
        resolve.apply(this, [arguments]);
      });

      let logger = null;
      if (log4js) {
        logger = log4js.getLogger("default");
      }

      function run_all_cmds(resolve, reject) {
        const path = require("path");
        const fs = require("fs");
        const download_hint =
          'you can download it from <a href="https://github.com/xresloader/xresloader/releases" target="_blank">https://github.com/xresloader/xresloader/releases</>';
        if (path.isAbsolute(xresloader_path)) {
          if (!fs.existsSync(xresloader_path)) {
            //run_log.append();
            failed_count += pending_script.length;
            reject.apply(this, [
              `[${work_dir}] ${xresloader_path} not exists, ${download_hint}`,
            ]);
            return;
          }
        } else {
          if (!fs.existsSync(path.join(work_dir, xresloader_path))) {
            failed_count += pending_script.length;
            reject.apply(this, [
              `[${work_dir}] ${xresloader_path} not exists, ${download_hint}`,
            ]);
            return;
          }
        }

        function run_one_cmd(xresloader_index, xresloader_proc) {
          let msg;
          let log_item;
          if (pending_script.length > 0 && conv_data.run_seq == run_seq) {
            var cmd = pending_script.pop();
            msg = `[CONV ${xresloader_index}] ${cmd}\r\n`;
            log_item = logger_append_info_message(
              shell_color_to_html(cmd),
              `[CONV ${xresloader_index}]`
            );
            run_log.scrollTop(run_log.prop("scrollHeight"));

            xresloader_proc.exec.stdin.write(cmd);
            xresloader_proc.exec.stdin.write("\r\n");
          } else {
            xresloader_proc.exec.stdin.end();
            if (xresloader_proc.timer) {
              clearInterval(xresloader_proc.timer);
              xresloader_proc.timer = null;
            }

            msg = `[Process ${xresloader_proc.index} close stdin.]\r\n`;
            log_item = logger_append_info_message(msg, null);
          }

          if (logger) {
            logger.info(log_item.innerText);
          }
        }

        running_count = xconv_gui_options.parallelism;
        function run_one_child_process(xresloader_index) {
          const spawn = require("child_process").spawn;
          const xresloader_cmds = conv_data.java_options.concat([
            "-jar",
            xresloader_path,
            "--stdin",
          ]);
          const msg = `[${work_dir}] Process ${xresloader_index} : ${xresloader_cmds.join(
            " "
          )}\r\n`;
          const log_item = logger_append_info_message(
            shell_color_to_html(
              `Process ${xresloader_index} : ${xresloader_cmds.join(" ")}\r\n`
            ),
            `${work_dir}`
          );
          if (logger) {
            logger.info(log_item.innerText);
          }

          console.log("start xresloader at " + work_dir);
          const xresloader_proc = {
            exec: spawn("java", xresloader_cmds, {
              cwd: work_dir,
              encoding: "utf8",
            }),
            timer: null,
            index: xresloader_index,
          };

          var has_triggered_exit = false;
          var handle_exit_fn = function (code, signal) {
            if (has_triggered_exit) {
              return;
            }
            has_triggered_exit = true;
            let error_msg;
            if (signal) {
              error_msg = `[Process ${xresloader_index} exit with signal ${signal}.]`;
              if (logger) {
                logger.error(error_msg);
              }
            } else if (code != 0) {
              error_msg = `[Process ${xresloader_index} exit with code ${code}.]`;
              if (logger) {
                logger.error(error_msg);
              }
            } else {
              error_msg = `[Process ${xresloader_index} exit.]`;
              if (logger) {
                logger.info(error_msg);
              }
            }
            logger_append_notice_message(shell_color_to_html(error_msg));
            --running_count;

            if (code > 0) {
              failed_count += code;
            }

            if (running_count <= 0 && conv_data.run_seq == run_seq) {
              if (failed_count <= 0) {
                resolve.apply(this, [arguments]);
              } else {
                reject.apply(this, [error_msg]);
              }
            }
          };
          xresloader_proc.exec.on("exit", handle_exit_fn);
          xresloader_proc.exec.on("error", handle_exit_fn);
          xresloader_proc.exec.on("close", handle_exit_fn);

          xresloader_proc.exec.stdout.on("data", function (data) {
            const log_item = logger_append_notice_message(
              "<span style='color: Green;'>" +
                shell_color_to_html(data) +
                "</span>"
            );
            if (logger) {
              logger.info(log_item.innerText);
            }
            run_log.scrollTop(run_log.prop("scrollHeight"));
            run_one_cmd(xresloader_index, xresloader_proc);
          });

          xresloader_proc.exec.stderr.on("data", function (data) {
            const data_str = data ? data.toString() : "";
            if (data_str && data_str.substr(0, 5).toLowerCase() == "[warn") {
              const log_item = logger_append_warning_message(
                shell_color_to_html(data_str)
              );
              if (logger) {
                logger.warn(log_item.innerText);
              }
            } else {
              const log_item = logger_append_error_message(
                shell_color_to_html(data_str)
              );
              if (logger) {
                logger.error(log_item.innerText);
              }
            }
            run_log.scrollTop(run_log.prop("scrollHeight"));
            run_one_cmd(xresloader_index, xresloader_proc);
          });

          xresloader_proc.timer = setInterval(function () {
            if (!(pending_script.length > 0 && conv_data.run_seq == run_seq)) {
              run_one_cmd(xresloader_index, xresloader_proc);
            }
          }, 3000);
          setTimeout(function () {
            run_one_cmd(xresloader_index, xresloader_proc);
          }, 32);
        }

        for (var i = 0; i < xconv_gui_options.parallelism; ++i) {
          run_one_child_process(i + 1);
        }
      }

      // 初始化执行链
      if (
        conv_data.gui &&
        (conv_data.gui.on_before_convert ||
          conv_data.gui.on_after_convert ||
          conv_data.gui.on_append_log)
      ) {
        var current_promise = new Promise(function (resolve, reject) {
          resolve.apply(this, [arguments]);
        });

        try {
          const vm = require("node:vm");
          const vm_context_obj = {
            work_dir: work_dir,
            configure_file: conv_data.input_file.path,
            xresloader_path: xresloader_path,
            global_options: global_options,
            selected_nodes: selected_nodes,
            selected_items: selected_items,
            run_seq: run_seq,
            alert_warning: alert_warning,
            alert_error: alert_error,
            log_info: function (content) {
              if (content) {
                logger_append_info_message(
                  shell_color_to_html(content),
                  "CONV EVENT"
                );
              }
            },
            log_notice: function (content) {
              if (content) {
                logger_append_notice_message(
                  shell_color_to_html(content),
                  "CONV EVENT"
                );
              }
            },
            log_warning: function (content) {
              if (content) {
                logger_append_warning_message(
                  shell_color_to_html(content),
                  `CONV EVENT`
                );
              }
            },
            log_error: function (content) {
              if (content) {
                logger_append_error_message(
                  shell_color_to_html(content),
                  "CONV EVENT"
                );
              }
            },
            // resolve: resolve,
            // reject: reject,
            require: require,
          };
          conv_data.gui.append_log_context = vm_context_obj;

          function append_event(cur_promise, evt_list) {
            if (evt_list) {
              for (var i = 0; i < evt_list.length; ++i) {
                const evt_obj = {
                  vm_script: evt_list[i],
                  has_done: false,
                  timer_handle: null,
                };
                cur_promise = cur_promise.then(() => {
                  return new Promise(function (resolve, reject) {
                    if (evt_obj.vm_script.enabled !== undefined) {
                      if (evt_obj.vm_script.enabled instanceof HTMLElement) {
                        if (!convert_to_boolean(evt_obj.vm_script.enabled)) {
                          evt_obj.has_done = true;
                          resolve(vm_context_obj);
                          return;
                        }
                      } else if (!evt_obj.vm_script.enabled) {
                        evt_obj.has_done = true;
                        resolve(vm_context_obj);
                        return;
                      }
                    }
                    let vm_context;
                    try {
                      vm_context = vm.createContext(
                        jQuery.extend(
                          {
                            resolve: function (value) {
                              if (null != evt_obj.timer_handle) {
                                clearTimeout(evt_obj.timer_handle);
                                evt_obj.timer_handle = null;
                              }
                              if (!evt_obj.has_done) {
                                evt_obj.has_done = true;
                                resolve(value);
                              }
                            },
                            reject: function (reason) {
                              ++failed_count;
                              if (null != evt_obj.timer_handle) {
                                clearTimeout(evt_obj.timer_handle);
                                evt_obj.timer_handle = null;
                              }
                              if (!evt_obj.has_done) {
                                evt_obj.has_done = true;
                                reject(reason);
                              }
                            },
                            data: {},
                          },
                          vm_context_obj
                        )
                      );
                      evt_obj.vm_script.fn.runInContext(vm_context, {
                        displayErrors: true,
                        timeout: evt_obj.vm_script.timeout,
                        breakOnSigint: true,
                      });
                      evt_obj.timer_handle = setTimeout(function () {
                        evt_obj.timer_handle = null;
                        if (!evt_obj.has_done) {
                          ++failed_count;
                          evt_obj.has_done = true;
                          vm_context_obj.log_error(
                            "Run event callback timeout"
                          );
                          reject("Run event callback timeout");
                        }
                      }, evt_obj.vm_script.timeout);
                    } catch (err) {
                      ++failed_count;
                      const err_msg = logger_format_exception_message(
                        err,
                        "event script"
                      );
                      logger_append_error_message(
                        err_msg,
                        "CONV EVENT EXCEPTION"
                      );
                      if (null != evt_obj.timer_handle) {
                        clearTimeout(evt_obj.timer_handle);
                        evt_obj.timer_handle = null;
                      }
                      if (!evt_obj.has_done) {
                        evt_obj.has_done = true;
                        reject(err_msg);
                      }
                    }
                  });
                });
              }
            }
            return cur_promise;
          }

          current_promise = append_event(
            current_promise,
            conv_data.gui.on_before_convert
          );
          current_promise = current_promise.then(() => {
            return new Promise(run_all_cmds);
          });
          current_promise = append_event(
            current_promise,
            conv_data.gui.on_after_convert
          );
        } catch (err) {
          const err_msg = logger_format_exception_message(err, "event script");
          logger_append_error_message(err_msg, "CONV EVENT");
        }
      } else {
        current_promise = current_promise.then(() => {
          return new Promise(run_all_cmds);
        });
      }

      // 结束
      current_promise = current_promise
        .catch(function (msg) {
          logger_append_error_message(msg, "CONV");
        })
        .finally(function () {
          conv_data.gui.append_log_context = null;

          if (failed_count > 0) {
            run_log.append(
              "<span style='color: DarkRed;'>All jobs done, " +
                failed_count +
                " job(s) failed.</strong>\r\n"
            );
            run_log.addClass("conv_list_run_error");
            run_log.removeClass("conv_list_run_running");
            if (logger) {
              logger.error(`All jobs done, ${failed_count} job(s) failed.`);
            }
          } else {
            run_log.append(
              "<span style='color: DarkRed;'>All jobs done.</strong>\r\n"
            );
            run_log.addClass("conv_list_run_success");
            run_log.removeClass("conv_list_run_running");
            if (logger) {
              logger.info("All jobs done.");
            }
          }
          run_log.scrollTop(run_log.prop("scrollHeight"));
        });
    } catch (err) {
      const log_item = logger_append_error_message(
        logger_format_exception_message(err),
        "CONV"
      );
      console.error(log_item.innerText);
      alert("出错啦: " + err.toString());
    }
  }

  function conv_env_check() {
    var run_log = $("#conv_list_run_log_panel");
    var dep_text = "";
    var dep_msg =
      '<div class="alert alert-danger" role="alert">请确保已安装<a href="http://www.oracle.com/technetwork/java/javase/downloads/index.html" target="_blank">64位的JRE或JDK 8</a>或以上</div>,推荐发行版如下:\r\n';
    dep_msg += "<ol>";
    dep_msg +=
      '<li><a href="https://adoptium.net/" target="_blank">TemurinJDK</li>';
    dep_msg +=
      '<li><a href="https://www.microsoft.com/openjdk" target="_blank">Microsoft JDK</li>';
    dep_msg +=
      '<li><a href="https://bell-sw.com/" target="_blank">LibericaJDK</li>';
    dep_msg +=
      '<li><a href="https://www.azul.com/downloads/zulu-community/" target="_blank">Zulu</li>';
    dep_msg +=
      '<li><a href="https://developers.redhat.com/products/openjdk/download" target="_blank">OpenJDK</li>';
    dep_msg += "</ol>";

    let logger = null;
    if (log4js) {
      logger = log4js.getLogger("default");
    }
    try {
      const { ipcRenderer } = require("electron");
      ipcRenderer.invoke("ipc-get-app-version").then((app_version) => {
        const app_version_text = `xresconv-gui version: ${app_version}`;
        run_log.append(
          `<div class="alert alert-primary alert-compact" role="alert">${app_version_text}</div>`
        );
        if (logger) {
          logger.info(app_version_text);
        }
      });
    } catch (_) {}

    try {
      var spawn = require("child_process").spawn;
      var java_exec = spawn("java", ["-version"], {
        encoding: "utf8",
        shell: true,
      });
      java_exec.stdout.on("data", function (data) {
        dep_text += data;
      });
      java_exec.stderr.on("data", function (data) {
        dep_text += data;
      });
      java_exec.on("exit", function () {
        const find_java_version = dep_text.match(/\d+/g);
        if (find_java_version && find_java_version.length < 2) {
          run_log.append(
            '<div class="alert alert-danger" role="alert">查询不到java版本号</div>'
          );
          run_log.append(dep_msg);
          if (logger) {
            logger.error("查询不到java版本号");
            logger.info(dep_msg);
          }
        } else if (
          find_java_version &&
          (parseInt(find_java_version[0]) > 1 ||
            parseInt(find_java_version[1]) >= 8)
        ) {
          run_log.append(
            '<div class="alert alert-primary alert-compact" role="alert">' +
              dep_text +
              "</div>"
          );
          if (logger) {
            logger.error(dep_text);
          }
          if (!dep_text.match(/64-Bit/i)) {
            run_log.append(dep_msg);
            if (logger) {
              logger.info(dep_msg);
            }
          }
        } else {
          if (dep_text) {
            run_log.append(
              '<div class="alert alert-primary alert-compact" role="alert">' +
                dep_text +
                "</div>"
            );
            if (logger) {
              logger.info(dep_text);
            }
          }
          run_log.append(
            '<div class="alert alert-danger" role="alert">检测不到java或java版本号过老</div>'
          );
          run_log.append(dep_msg);
          if (logger) {
            logger.error("检测不到java或java版本号过老");
            logger.info(dep_msg);
          }
        }
      });

      java_exec.stdin.end();
    } catch (err) {
      run_log.append(dep_msg);
      if (logger) {
        logger.error(dep_msg);
      }
      logger_append_error_message(err);
    }

    run_log.scrollTop(run_log.prop("scrollHeight"));
  }

  $(function () {
    // 并行转表选项
    (function () {
      // 获取CPU信息，默认并行度为CPU核心数量/2
      try {
        xconv_gui_options.parallelism = parseInt(
          (require("os").cpus().length - 1) / 2 + 1
        );

        // 实际使用过程中发现，java的运行时优化反而比并行执行更节省性能
        if (xconv_gui_options.parallelism > 2) {
          xconv_gui_options.parallelism = 2;
        }
      } catch (err) {
        console.log("judge cpu count require node.js");
        xconv_gui_options.parallelism = 2;
        console.error(err);
      }

      var father_dom = $("#conv_config_parallelism");
      for (var i = 0; i < xconv_gui_options.parallelism_max; ++i) {
        var paral_opt = $("<option></option>");
        paral_opt.attr("value", i + 1);
        paral_opt.prop("value", i + 1);
        paral_opt.html(i + 1);

        if (xconv_gui_options.parallelism == i + 1) {
          paral_opt.attr("selected", "selected");
          paral_opt.attr("selected", true);
        }

        father_dom.append(paral_opt);
      }

      console.log("转表并发数: " + xconv_gui_options.parallelism);
      father_dom.on("change", function () {
        var new_value = parseInt(father_dom.val());
        if (xconv_gui_options.parallelism == new_value) {
          return;
        }

        if (new_value <= 6) {
          xconv_gui_options.parallelism = new_value;
          console.log("转表并发数: " + xconv_gui_options.parallelism);
        } else {
          var html_content =
            "并发度过大时会导致JVM有很高的内存消耗，可能会导致执行过程中达到JVM堆栈内存而崩溃。<br />";
          html_content +=
            "通常可以通过修改JVM默认内存限制实现。(如: -Xmx2048m)<br />";
          html_content +=
            "您确定要把并发转表的进程数调整到 <strong>" +
            new_value +
            "</strong> 吗？<br />";
          alert_warning(html_content, "高并行度警告", {
            yes: function () {
              xconv_gui_options.parallelism = new_value;
              console.log("转表并发数: " + xconv_gui_options.parallelism);
              if (xconv_gui_options.parallelism != new_value) {
                father_dom.get(0).selectedIndex =
                  xconv_gui_options.parallelism - 1;
              }
            },
            no: function () {
              if (xconv_gui_options.parallelism != new_value) {
                father_dom.get(0).selectedIndex =
                  xconv_gui_options.parallelism - 1;
              }
            },
          });
        }
      });
    })();

    $("#conv_list_file_btn").on("click", function () {
      $("#conv_list_file").val("");
      $("#conv_list_file").trigger("click");
    });
    $("#conv_list_file").on("click", function () {
      $(this).val("");
    });

    const on_load_conv_list_file = function (input_file) {
      var clf = input_file;
      $("#conv_list_file_val").val(clf.path);
      if (!clf.data) {
        $("#conv_list_file_val").val("加载文件失败！");
        return;
      }

      try {
        reset_conv_data();
        conv_data.input_file = input_file;
        conv_data.file_map[clf.path] = true;

        build_conv_tree(clf.data, clf.path).then(() => {
          // 显示属性树
          show_conv_tree();
        });
      } catch (err) {
        logger_append_error_message(err);
        alert_error(err.toString(), "加载 " + clf.path + " 失败");
      }
    };
    $("#conv_list_file").on("change", async function () {
      on_load_conv_list_file(await get_dom_file("conv_list_file"));
    });

    $("#conv_list_btn_select_all").on("click", function () {
      $.ui.fancytree
        .getTree("#conv_list")
        .getRootNode()
        .visit(function (node) {
          if (!node.isFolder() && !node.unselectable) {
            return;
          }
          node.setSelected(true);
        });
    });

    $("#conv_list_btn_select_none").on("click", function () {
      $.ui.fancytree
        .getTree("#conv_list")
        .getRootNode()
        .visit(function (node) {
          node.setSelected(false);
        });
    });

    $("#conv_list_btn_expand").on("click", function () {
      $.ui.fancytree
        .getTree("#conv_list")
        .getRootNode()
        .visit(function (node) {
          node.setExpanded(true);
        });
    });

    $("#conv_list_btn_collapse").on("click", function () {
      $.ui.fancytree
        .getTree("#conv_list")
        .getRootNode()
        .visit(function (node) {
          node.setExpanded(false);
        });
    });

    $("#conv_list_btn_start_conv").on("click", function () {
      conv_start();
    });
    $("#conv_list_btn_reload").on("click", reload_window);
    $("a", "#conv_list_rename_samples").on("click", function () {
      $("#conv_list_rename").val($(this).attr("data-rename"));

      const conv_list_output_custom_multi = document.getElementById(
        "conv_list_output_custom_multi"
      );
      if (
        conv_list_output_custom_multi.parentNode.selectedIndex ==
        conv_list_output_custom_multi.index
      ) {
        alert_warning(
          "当<strong>输出类型</strong>使用配置文件中的<strong>自定义输出类型</strong>时，此选项仅影响未配置过重命名规则的输出类型。"
        );
      }
    });

    $("#conv_list_rename").on("change", function () {
      const conv_list_output_custom_multi = document.getElementById(
        "conv_list_output_custom_multi"
      );
      if (
        conv_list_output_custom_multi.parentNode.selectedIndex ==
        conv_list_output_custom_multi.index
      ) {
        alert_warning(
          "当<strong>输出类型</strong>使用配置文件中的<strong>自定义输出类型</strong>时，此选项仅影响未配置过重命名规则的输出类型。"
        );
      }
    });

    $("#conv_list_output_type").on("change", function () {
      show_output_matrix();
    });

    conv_env_check();

    try {
      if (location.search) {
        var input_file = location.search.match(/input=([^\\&\\#]+)/i);
        if (input_file && input_file.length > 1) {
          const init_file_path = decodeURIComponent(input_file[1]);
          (async function () {
            console.log("open file: " + init_file_path);
            on_load_conv_list_file(await get_string_file(init_file_path));
          })();
        }
      }

      setup_custom_selectors();
      setup_auto_resize_window();
    } catch (err) {
      // ignore load initialize file failed
      logger_append_error_message(err);
    }
  });
})(jQuery, window);
