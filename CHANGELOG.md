更新记录
==========

2.5.2
------

1. 修复 `alert_error` 和 `alert_warning` 接口的模态对话框。
2. 支持解析xresloader的warning日志。
3. 修复log文件的输出被转义的问题。

2.5.1
------

1. 调试选项 `--debug` 改为 `--debug-mode` 以适配冲突。
2. 修复 `--input` 失效的问题。

2.5.0
------

1. 修订多行输出
2. 更新依赖库

> + adm-zip      ^0.5.10  →  ^0.5.16
> + compressing  ^1.10.0  →  ^1.10.1
> + electron     ^29.1.0  →  ^32.0.2
> + gulp          ^4.0.2  →   ^5.0.0
> + minimatch     ^9.0.3  →  ^10.0.1

2.4.2
------

1. 更新依赖包
2. 修正转表清单中只有一个规则切有限定Tag/Class时，默认仍然能选中不满足条件的转表项的问题
3. 候选项不满足自定义转表规则里的任何输出矩阵条目，不再允许选中

2.4.1
------

1. 支持多个 `data_src_dir` 配置
2. 修复多输出的hint提示
3. 修复多次点击重置按钮不会消除老窗口的BUG

2.4.0
------

1. 支持多个 `proto_file` 配置
2. 更新依赖库

  > + @popperjs/core     ^2.11.6  →  ^2.11.8
  > + bootstrap           ^5.2.1  →   ^5.3.0
  > + electron           ^20.1.4  →  ^25.2.0
  > + electron-packager  ^16.0.0  →  ^17.1.1
  > + jquery              ^3.6.1  →   ^3.7.0
  > + jquery.fancytree   ^2.38.2  →  ^2.38.3
  > + log4js              ^6.6.1  →   ^6.9.1
  > + minimatch           ^5.1.0  →   ^9.0.3

2.3.0-rc5
------

1. 修复一些日志输出布局异常
2. 优化高分辨率下的响应式布局
3. 更新依赖库

  > + @popperjs/core -> 2.11.5
  > + jquery.fancytree -> 2.38.1
  > + log4js -> 6.5.2
  > + electron -> 19.0.6
  > + minimatch -> 5.1.0
  > + electron-packer -> 15.5.1

2.3.0-rc4
------

1. 启动日志输出GUI工具的版本号
2. 调整样式，现在更紧凑一些
3. 更新依赖库

  > + electron -> 16.0.7
  > + bootstrap -> 5.1.3
  > + popperjs -> 2.38.0
  > + electron-packer -> 2.11.2

2.3.0-rc3
------

1. 修复 [\#12](https://github.com/xresloader/xresconv-gui/issues/12)

2.3.0-rc2
------

1. 增加 `--log-configure` 选项，用于指定log4js日志配置。增加默认的本地文件日志。
2. 修复配置文件过大被拆分的BUG
3. 更新依赖库

  > + electron -> 14.0.0
  > + bootstrap -> 5.1.0
  > + jquery.fancytree -> 2.38.0
  > + electron-packer -> 15.3.0

2.3.0-rc1
------

1. 更新依赖库

  > + electron -> 11.1.1
  > + bootstrap -> 5.0.0-beta1
  > + jquery.fancytree -> 2.37.0
  > + electron-packer -> 15.2.0
  > + popper.js 替换为 @popperjs/core

2. 增加命令行选项 ```--custom-selector/--custom-button <json文件名>``` 用于增加自定义选择器
3. 允许事件可勾选是否执行
4. 转表前事件和转表后事件增加允许在面板中设置开启货关闭，新属性如下:
   
   > + ```name``` : 显示名称
   > + ```checked``` : 默认选中/启用
   > + ```mutable``` : 是否可以修改选中/启用状态

2.2.4
------

1. Fix icon loading error for darwin platform.

2.2.3
------

1. 优化错误提示
2. 修复子进程事件错误导致可能捕获不到子进程退出的BUG
3. 换一种reload的实现，原先的 ```BrowserWindow.reload()``` 未知原因会导致子进程退出事件丢失
4. 增加 ```on_before_convert``` 和 ```on_after_convert``` 事件的```selected_items```传入数据，包含 ```{id, file, scheme, name, cat, options: [], desc, scheme_data: {}}``` 用于指示选中的节点信息
5. 修复自定义事件 ```reject``` 之后没有显示成错误的BUG。

2.2.2
------

1. 修复一处自定义option传参错误
2. 修复重置按钮某些情况下会失效的BUG
3. 更新依赖库

  > electron -> 9.0.0
  > jquery -> 3.5.1
  > bootstrap -> 4.5.0

2.2.1
------

1. 更新依赖库
2. 切换到```Github Action```
3. 更换图标
4. 构建工具切换为```yarn```

2.2.0
------

1. 支持多个 ```<output_type></output_type>``` 参数，支持给每个 output_type 单独设置 rename 规则
2. set_name 事件增加 alert_warning(text)/alert_error(text)/log_info(text)/log_error(text) 函数
3. set_name 事件增加 work_dir 变量和 configure_file 变量
4. on_before_convert/on_after_convert 事件增加 configure_file 变量
5. 采用Promise重构建立节点树的的流程
6. 更新依赖库

  > electron -> 6.0.7
  > electron-packager -> 14.0.5
  > gulp -> 4.0.2

2.1.1
------

1. 修复重命名模板的转义问题

2.1.0
------

1. 更新依赖库到当前最新版本release（2019-04-18）
2. 支持xresloader 2.0.0的输出类型
3. 修复未知的输出目标会导致加载失败的问题
4. 增加事件支持 ```<on_before_convert>NODEJS CODE...</on_before_convert>``` 和 ```<on_after_convert>NODEJS CODE...</on_after_convert>```
5. 采用Promise模型重构执行任务链
6. 增加CI的自动发布流程
7. ```<set_name></set_name>``` 事件改为直接运行，不再需要返回一个function并且在沙箱环境中运行
8. 增加启动参数 ```--input <文件名>``` 用以支持设置初始加载的转表清单配置

1.4.2
------

1. 增加java环境检测脚本
2. 升级electron到2.0.4
3. 更新依赖库到当前最新版本release（2018-07-04）


1.4.1
------

1. 更新依赖库到当前最新版本release（2018-03-08）
2. 移除jQuery UI
3. 移除electron-prebuilt，使用electron来执行打包盒开发环境启动
4. 升级jQuery到3.3.1
5. 升级bootstrap到4.0.0
6. 升级electron到1.8.3
7. 升级jquery.fancytree到2.28.0
8. 升级popper.js到1.13.0
9. 升级electron-packager到11.1.0
10. 界面同步优化成bootstrap4
11. 优化打包方式
  + 使用标准的node_modules路径并排除开发工具依赖（解决electron会重置模块搜索目录的问题）
  + 使用asar打包资源文件


1.4.0
------

1. 更新依赖库到当前最新版本release（2017-11-02）
2. 支持设置数据版本号(需要xresloader版本1.4.0或以上)

1.3.1
------

1. 修复使用boostrap 4之后漏打包tether的问题
2. 修复插件脚本崩溃会导致功能不正常，并且没有报错的问题

1.3.0
------

1. 支持预置scheme参数
2. 更新electron到1.4.12
3. 更新npm维护的库-20161211

1.2.2
------

1. 支持设置java选项
2. 更新electron到1.4.10
3. jquery/bootstrap/jquery.fancytree 采用npm维护版本
4. jquery-ui升级到1.12.0
5. 完全使用gulp复制依赖项

1.2.1
------

1. 支持新版本xresloader对web工具输出shell颜色代码
2. 更新[Electron](http://electron.atom.io)到1.2.5
3. 更新[Electron-Packager](https://github.com/electron-userland/electron-packager)到7.1.0

1.2.0
------

1. 使用[Electron](http://electron.atom.io)重新构建，不再使用[nw.js](http://nwjs.io/)。后者的官方打包脚本问题比较多。
2. 循环加载的xml文件判定改为使用绝对路径而不是之前的文件名判定
3. 版本号规则使用node.js的package的三段式

1.1.4.0
------

1. 增加javascript的导出支持
2. 更新nwjs到0.13.3

1.1.3.0
------

1. 接入新的返回码定义
2. 更新bootstrap到3.3.6
3. 更新jquery到2.2.0
4. 更新fancytree到2.15.0
5. 修正转表完成后日志滚动条没有自动滚到最下方的问题
6. 增加控制台提示性边框

1.1.2.1
------

1. 修复Windows下的一些乱码问题

1.1.2.0
------

1. 跟进支持xresloader的多表转换功能，拥有更快的转换速度并消耗更低的资源
2. 修复加载不同转表文件时载入错误的问题
3. 增加重置按钮（刷新页面）

1.1.1.1
------

1. 修复转表结束提示错误

1.1.1.0
------

1. 增加并行转表的功能
