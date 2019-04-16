更新记录
==========
2.1.0
------
1. 更新依赖库到当前最新版本release（2018-07-04）
2. 支持xresloader 2.0.0的输出类型
3. 修复未知的输出目标会导致加载失败的问题
4. 增加事件支持 ```<on_before_convert>NODEJS CODE...</on_before_convert>``` 和 ```<on_after_convert>NODEJS CODE...</on_after_convert>```

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
