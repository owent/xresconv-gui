#!/bin/sh
# xresconv-gui Linux 预检引导器（P5-05，PK05）。
#
# 约束（docs/plan/05-packaging-release.md §Linux）：
# - 引导器自身不依赖 GTK/WebKit（纯 POSIX shell + ldconfig 探测），
#   不先启动 Tauri 动态链接程序；
# - 缺运行时时给出按发行版的可行动安装指引；--install（或交互确认）才调用
#   系统包管理器；不永久改源、不关签名校验；
# - 已满足时不安装/不降级（幂等）。
#
# 用法：preflight.sh [--install] [--quiet] [-- <app-bin> [app args…]]
# 退出码：0=运行时就绪（-- 时已 exec 应用）；2=缺依赖（已给指引）；
#         3=不支持的发行版；4=安装尝试失败；5=用法错误。
#
# 本脚本随 bootstrap/offline 两变体一同分发（offline 变体自含运行时，
# 探测通过即启动）。

set -u

APP_NAME="xresconv-gui"
# 应用运行所需共享库（soname 级探测；WebKitGTK 4.1 / GTK3 / libsoup3 / JSC）。
REQUIRED_LIBS="libwebkit2gtk-4.1.so.0 libjavascriptcoregtk-4.1.so.0 libgtk-3.so.0 libsoup-3.0.so.0"

DO_INSTALL=0
QUIET=0
APP_BIN=""
APP_ARGS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --install) DO_INSTALL=1 ;;
    --quiet) QUIET=1 ;;
    --) shift; APP_BIN="${1:-}"; shift; APP_ARGS="$@"; break ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "preflight: unknown argument: $1 (usage: $0 [--install] [--quiet] [-- <app-bin> [args…]])" >&2; exit 5 ;;
  esac
  shift
done

log() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }
die() { printf 'preflight: %s\n' "$*" >&2; exit "$2"; }

# --- 1. 发行版识别（/etc/os-release；ID/ID_LIKE 词表） ------------------------
distro_family=""
package_manager=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  ids="${ID:-} ${ID_LIKE:-}"
  case "$ids" in
    *debian*|*ubuntu*)
      distro_family="debian"
      package_manager="apt"
      ;;
    *fedora*|*rhel*|*centos*)
      distro_family="fedora"
      package_manager="dnf"
      ;;
  esac
fi
[ -n "$distro_family" ] || die "不支持的发行版（/etc/os-release ID=${ID:-?}）；支持范围见 packaging/targets.json（Ubuntu 22.04/24.04、Debian 12/13、Fedora 最近两个正式版本）" 3

# --- 2. 运行时探测（ldconfig；不加载库、不执行任何 GUI 代码） ------------------
LDCONFIG="$(command -v ldconfig || echo /sbin/ldconfig)"
missing=""
for lib in $REQUIRED_LIBS; do
  if ! "$LDCONFIG" -p 2>/dev/null | grep -q "$lib"; then
    missing="$missing $lib"
  fi
done

if [ -z "$missing" ]; then
  log "preflight: WebKitGTK/GTK 运行时就绪（${PRETTY_NAME:-Linux}）"
  if [ -n "$APP_BIN" ]; then
    exec "$APP_BIN" $APP_ARGS
    die "无法启动 $APP_BIN" 4
  fi
  exit 0
fi

# --- 3. 缺依赖：按发行版给出可行动指引（PK05：先诊断，不先启 GUI） -------------
log "preflight: 缺少运行时库：$missing"
case "$distro_family" in
  debian)
    PKGS="libwebkit2gtk-4.1-0 libgtk-3-0"
    INSTALL_CMD="sudo apt-get update && sudo apt-get install -y $PKGS"
    ;;
  fedora)
    PKGS="webkit2gtk4.1 gtk3"
    INSTALL_CMD="sudo dnf install -y $PKGS"
    ;;
esac
log "请安装系统依赖后重试：$INSTALL_CMD"

if [ "$DO_INSTALL" != "1" ]; then
  if [ -t 0 ] && [ "$QUIET" != "1" ]; then
    printf '现在安装？[y/N] '
    read -r answer
    case "$answer" in
      y|Y|yes|YES) DO_INSTALL=1 ;;
    esac
  fi
fi

if [ "$DO_INSTALL" = "1" ]; then
  log "preflight: 调用系统包管理器安装（不改源、不关签名校验）…"
  # shellcheck disable=SC2086
  if $INSTALL_CMD; then
    # 复检（安装后必须再次验证，不把安装器退出码当成功）。
    still=""
    for lib in $REQUIRED_LIBS; do
      "$LDCONFIG" -p 2>/dev/null | grep -q "$lib" || still="$still $lib"
    done
    if [ -n "$still" ]; then
      die "安装后仍缺：$still（请查看包管理器输出；可能需要重启或补充发行版仓库）" 4
    fi
    log "preflight: 安装完成，运行时就绪"
    if [ -n "$APP_BIN" ]; then
      exec "$APP_BIN" $APP_ARGS
      die "无法启动 $APP_BIN" 4
    fi
    exit 0
  fi
  die "包管理器安装失败（见上方输出；常见原因：无网络/无 sudo 权限/包锁）" 4
fi

exit 2
