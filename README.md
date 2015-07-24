xresconv-gui
==========

这是一个符合 [xresconv-conf](https://github.com/xresloader/xresconv-conf) 规范的GUI转表工具，并且使用 [xresloader](https://github.com/xresloader/xresloader) 作为数据导出工具后端。

本项目基于 [NW.js](https://github.com/nwjs/nw.js) 项目，所以支持nw.js支持得所有平台（Linux、Mac OS和Windows）

打包和发布
======

打包发布使用了[nwjs-build.sh](https://github.com/Gisto/nwjs-shell-builder)脚本，所以需要Shell或Bash执行环境

Windows环境准备
------

1. Windows 下请先安装 [Cygwin](http://www.cygwin.org/)或[Msys](http://www.mingw.org/wiki/msys)或[Msys2](https://msys2.github.io/)或其他类型的Shell环境
2. 安装wget、curl、tar、zip和unzip组件

> Cygwin下直接GUI里安装即可
> 
> Msys2: pacman -S wget curl tar zip unzip

Linux环境准备
------
1. 安装wget、curl、tar、zip和unzip组件

> CentOS、Fedora、Redhat： yum install -y wget curl tar zip unzip
> 
> Ubuntu、Debian: apt-get install wget curl tar zip unzip
> 
> 其他Linux环境类似

OSX环境准备
------
1. 安装[homebrew](http://brew.sh/)
2. 安装wget、curl、tar组件

> brew install wget curl gnu-tar


开始打包
------
1. 执行构建脚本 ./build_with_nwjs-build.sh --target="打包目标平台" [其他nwjs-build.sh 参数]

> 目标平台:
>> 1. linux-32位: 0
>> 2. linux-64位: 1
>> 3. windows-32位: 2
>> 4. windows-64位: 3
>> 5. osx-32位: 4
>> 6. osx-64位: 5
> 比如要打包linux-64位和windows-64位，执行 ./build_with_nwjs-build.sh --target="1 3"
>
> 其他参数参见: ./build_with_nwjs-build.sh --help

一般情况下，打好的包会被放在 ***tools/TMP/output*** 目录 

**注意：** build_with_nwjs-build.sh下载与编译包失败的情况下，下次打包需要删除 *tools/nwjs_download_cache*下对应失败的包，否则它会尝试使用缓存然后认为解包失败

发布
------
nw.js运行需要 icudtl.dat、 nw.pak和locales目录。但是打包脚本并没有把这几个文件和目录打包。

所以需要**手动把这些文件和目录放到压缩包内**


开发使用说明
======

使用方式有以下三种，任选一种即可

1. 使用[NW.js](https://github.com/nwjs/nw.js)  参数传入src目录即可。
2. build_package.sh 用于打包版本，使用前请先修改***NWJS_ROOT***和**nw**可执行文件名*（Unix like系统没有.exe后缀）*
3. 使用 build_with_nwjs-build.sh 打包版本，方法见[打包和发布](#打包和发布)

示例截图
------
![示例截图-1](doc/snapshoot-1.png)

![示例截图-2](doc/snapshoot-2.png)

![示例截图-3](doc/snapshoot-3.png)