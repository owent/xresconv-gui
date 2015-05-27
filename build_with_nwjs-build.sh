#!/usr/bin/env bash

WORKING_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd -P)";
cd "$WORKING_DIR";

if [ ! -e 'tools/nwjs-build.sh' ] ; then
    wget -c "https://raw.githubusercontent.com/Gisto/nwjs-shell-builder/master/nwjs-build.sh" -O "tools/nwjs-build.sh";
    chmod +x 'tools/nwjs-build.sh'; 
fi

tools/nwjs-build.sh "$@" --clean;

tools/nwjs-build.sh \
    --nw=0.12.2 \
    --src=src \
    --name="xresconv-gui" \
    --win-icon=doc/logo.ico \
    --version="1.0.0" \
    "$@" --build ;

# add dependency files 
