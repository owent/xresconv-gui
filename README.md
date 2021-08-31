xresconv-gui
==========

[ci-github-action]: https://github.com/xresloader/xresconv-gui/workflows/build/badge.svg
![ci-github-action]

这是一个符合 [xresconv-conf](https://github.com/xresloader/xresconv-conf) 规范的GUI转表工具，并且使用 [xresloader](https://github.com/xresloader/xresloader) 作为数据导出工具后端。

本项目基于 [Electron](http://electron.atom.io/) 项目，所以支持[Electron](http://electron.atom.io/)支持得所有平台（Linux、macOS和Windows）

下载和使用
======

点击[此处](https://github.com/xresloader/xresconv-gui/releases)并根据需要下载对应系统的包，直接执行里面的二进制即可。

启动参数
------

+ `--input <文件名>` : 指定初始的转表清单文件。
+ `--debug` : 开启debug模式并启动开发人员工具。
+ `--custom-selector/--custom-button <json文件名>` : 增加自定义选择器,允许多个
+ `--log-configure <log设置文件 json文件名>` : 设置额外的log配置。设置文件结构请参见: https://www.npmjs.com/package/log4js

### 自定义选择器规则

文件必须是UTF-8编码

```json
{
    "name": "选择器按钮名称",                           // [必须] 按钮显示名称
    "by_schemes": [{                                    // [必须] item里配置file和scheme属性的选取规则（by_schemes和by_sheets里至少要配置一个）
        "file": "文件名, 比如: 资源转换示例.xlsx",      // [必须]
        "scheme": "转表规则名, 比如: scheme_upgrade"    // [可选] 此项可以为空，如果为空会命中所有file匹配的条目
    }],
    "by_sheets": [{                                     // [必须] item里的DataSource子节点配置DataSource的选取规则（by_schemes和by_sheets里至少要配置一个）
        "file": "文件名, 比如: 资源转换示例.xlsx",      // [必须]
        "sheet": "文件名, 比如: arr_in_arr"             // [可选] 此项可以为空，如果为空会命中所有DataSource中第一个选项和file匹配的条目
    }],
    "default_selected": false,                          // [可选] 默认选中
    "style": "outline-secondary",                       // [可选] 按钮Style。默认: outline-secondary
    // "action": ["unselect_all", "reload"]             // [可选] 特殊行为，具体内容请参考下面的文档。
}
```

以上 ```file``` 、 ```scheme``` 、 ```sheet``` 字段都支持 ```完全匹配的名称``` 、 ```glob: 通配符``` 和 ```regex: 正则表达式``` 三种形式。
按钮风格默认是 ```outline-secondary``` 。可选项为(详见: https://getbootstrap.com/docs/5.0/components/buttons/):

+ outline-primary
+ outline-secondary
+ outline-success
+ outline-danger
+ outline-warning
+ outline-info
+ outline-light
+ outline-dark
+ primary
+ secondary
+ success
+ danger
+ warning
+ info
+ light
+ dark

> Sample: 使用 [doc/custom-selector.json](doc/custom-selector.json) 和 https://github.com/xresloader/xresconv-conf/blob/master/sample.xml 里的配置，可以使用 ```--custom-selector doc/custom-selector.json``` 来启动。

特殊行为 **action** 字段的特殊功能:

+ ```reload``` : 重新加载自定义按钮
+ ```select_all``` : 全部选中
+ ```unselect_all``` : 全部反选
+ ```script: <脚本名字>``` : 执行脚本，**脚本名字** 为 ```//root/gui/script``` 节点的 ```name``` 属性。

示例
------

![示例截图-1](doc/snapshoot-1.gif)

![示例截图-2](doc/snapshoot-2.gif)

![示例截图-3](doc/snapshoot-4.png)

自定义按钮启动示例: ```./xresconv-gui.exe --custom-selector ./doc/custom-selector.json```

注意事项
======

1. 文件名最好全英文，因为GUI工具中的编码统一使用UTF-8，而Windows默认编码是GBK。如果转表工具也使用UTF-8的话Windows下会找不到中文文件名。

事件支持
======

2.1.0 版本开始增加了事件支持。事件格式如下：

```xml
<gui>
    <set_name description="设置转表项的名字字段，每个转表项会调用一次">
        // 事件代码脚本
    </set_name>
    <on_before_convert 
        name="事件名称(可选,如果设置了名称，可以在执行时选择是否关闭)" 
        checked="true/false(可选,默认是否选中/启用)" 
        mutable="true/false(可选,是否可修改选中/启用状态)" 
        type="text/javascript" timeout="超时时间（毫秒,默认: 30000）" description="开始转表前的事件回调函数，事件执行结束必须调用done()函数，以触发进行下一步">
        
    </on_before_convert>
    <on_after_convert 
        name="事件名称(可选,如果设置了名称，可以在执行时选择是否关闭)" 
        checked="true/false(可选,默认是否选中/启用)" 
        mutable="true/false(可选,是否可修改选中/启用状态)"
        type="text/javascript" timeout="超时时间（毫秒,默认: 30000）" description="转表结束后的事件回调函数，事件执行结束必须调用done()函数，以触发进行下一步">
        // 事件代码脚本
    </on_after_convert>
    <script name="自定义脚本" type="text/javascript" timeout="超时时间（毫秒,默认: 30000）">
        // 同上
        alert_warning("自定义脚本，可用于自定义按钮");
        resolve();
    </script>
</gui>
```

> 注: 事件的 ```name``` 、 ```checked``` 、 ```mutable``` 和自定义脚本的```<script></script>``` 标签需要版本 **>=2.3.0** 。

在 **set_name** 事件系统中，可用的接口如下:

```javascript
{
    work_dir: "当前配置下的执行xresloader的工作目录",
    configure_file: "当前配置XML路径",
    item_data: {
        id: id,
        file: "数据源文件",
        scheme: "数据源scheme表名",
        name: "描述名称",
        cat: "分类名称",
        options: ["额外选项"],
        desc: "描述信息",
        scheme_data: {"元数据Key": "元数据Value"},
        tags: ["tag列表"],     // 版本 >= 2.2.3
        classes: ["class列表"] // 版本 >= 2.2.3
    },
    data: {}， // 绑定在事件上的私有数据,可用于保存全局状态, 版本 >= 2.3.0
    alert_warning: function(content, title, options) {}, // 警告弹框， options 结构是 {yes: 点击是按钮回调, no: 点击否按钮回调, on_close: 关闭后回调}
    alert_error: function(content, title) {}, // 错误弹框
    log_info: function (content) {}, // 打印info日志
    log_notice: function (content) {}, // 打印notice日志, 版本 >= 2.3.0
    log_warning: function (content) {}, // 打印warning日志, 版本 >= 2.3.0
    log_error: function (content) {}, // 打印error日志
}
```

在 **on_before_convert/on_after_convert** 事件系统中，可用的接口如下:

```javascript
{
    work_dir: "执行xresloader的工作目录",
    xresloader_path: "xresloader目录",
    global_options: {"全局选项": "VALUE"},
    selected_nodes: ["选中要执行转表的节点集合"],
    selected_items: ["选中要执行转表的item对象集合,数据结构同上面的 item_data"], // 版本 >= 2.2.3
    run_seq: "执行序号",
    data: {}， // 绑定在事件上的私有数据,可用于保存全局状态, 版本 >= 2.3.0
    alert_warning: function(content, title, options) {}, // 警告弹框， options 结构是 {yes: 点击是按钮回调, no: 点击否按钮回调, on_close: 关闭后回调}
    alert_error: function(content, title) {}, // 错误弹框
    log_info: function (content) {}, // 打印info日志
    log_notice: function (content) {}, // 打印notice日志, 版本 >= 2.3.0
    log_warning: function (content) {}, // 打印warning日志, 版本 >= 2.3.0
    log_error: function (content) {}, // 打印error日志
    resolve: function (value) {}, // 通知上层执行结束,相当于Promise的resolve
    reject: function(reason) {}, // 通知上层执行失败,相当于Promise的reject
    require: function (name) {} // 相当于 nodejs的 require(name) 用于导入nodejs 模块
}
```

在自定义脚本 **script** 中，可用的接口如下:

```javascript
{
    work_dir: "执行xresloader的工作目录",
    xresloader_path: "xresloader目录",
    global_options: {"全局选项": "VALUE"},
    selected_nodes: ["选中要执行转表的节点集合"],
    selected_items: ["选中要执行转表的item对象集合,数据结构同上面的 item_data"],
    data: {}， // 绑定在按钮上的私有数据,可用于保存全局状态
    alert_warning: function(content, title, options) {}, // 警告弹框， options 结构是 {yes: 点击是按钮回调, no: 点击否按钮回调, on_close: 关闭后回调}
    alert_error: function(content, title) {}, // 错误弹框
    log_info: function (content) {}, // 打印info日志
    log_notice: function (content) {}, // 打印notice日志
    log_warning: function (content) {}, // 打印warning日志
    log_error: function (content) {}, // 打印error日志
    resolve: function (value) {}, // 通知上层执行结束,相当于Promise的resolve
    reject: function(reason) {}, // 通知上层执行失败,相当于Promise的reject
    require: function (name) {} // 相当于 nodejs的 require(name) 用于导入nodejs 模块
}
```

开发使用说明
======

以下内容仅是对这个工具的开发和维护进行说明，直接使用的话[下载预发布包](https://github.com/xresloader/xresconv-gui/releases)即可

环境准备
======

1. 请自行安装node.js和npm（详见： https://nodejs.org ）

```bash
# 基本组件安装
npm install -g yarn
yarn install

# 开发环境安装
yarn install --dev
yarn install -g gulp-cli

# 升级依赖包
npm install -g ncu
ncu
ncu -u
```

直接启动
------

```bash
yarn run start
```

调试模式启动
------

```bash
yarn run debug-start
```

VSCode调试启动
------

先使用设定调试端口并启动

```bash
yarn run debug
```

然后VSCode打开调试面板Attach到进程上

直接VSCode Lanch调试的方法见: https://electronjs.org/docs/tutorial/debugging-main-process-vscode

> *VSCode里直接Launch的方式仅在Windows下有效*

**注：VSCode连接成功后，会立刻断点在程序启动处，这时候可以对需要断点的地方打断点，然后直接继续即可。**

打包和发布
======

+ 打包发布所有x64架构

> ```yarn run package```

+ 打包发布所有平台

> ```yarn run package-all```

关于加载和调试
======

本软件中大部分的外部库加载都没有问题，但是由于默认走的是node.js的沙箱机制，所以html内的script标签里某些库不会写出到全局。这时候需要手动加一下，比如：

```javascript
window.jQuery = require(`${__dirname}/lib/jquery/jquery.min.js`);
```

另外，调试模式运行只能调试[Electron](http://electron.atom.io/)进入的代码。
无法调试[Electron](http://electron.atom.io/)中[BrowserWindow](http://electron.atom.io/docs/api/browser-window/)的沙箱里的代码。
所以如果要调试[BrowserWindow](http://electron.atom.io/docs/api/browser-window/)内的代码还是要在[src/setup.js](src/setup.js)中把***debug***选项改为true。

关于NPM下载加速
======

1. 关闭npm的https
> ```npm config set strict-ssl false```

2. 设置npm的软件源
> ```npm config set registry http://registry.npmjs.org/```
> ```npm config set registry https://mirrors.tencent.com/npm/```
> ```npm config set registry https://registry.npm.taobao.org/```
> ```npm install -g cnpm --registry=https://registry.npm.taobao.org```

1. 代理
> + 设置代理： ```npm config set proxy=http://代理服务器ip:代理服务器端口```
> + 取消代理： ```npm config delete http-proxy```
> + 取消代理： ```npm config delete https-proxy```
> + 单独设置代理： ```npm install --save-dev electron-prebuilt --proxy http://代理服务器ip:代理服务器端口```