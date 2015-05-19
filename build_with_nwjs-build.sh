#!/bin/sh

if [ -e tools/TMP ]; then
    rm -rf tools/TMP;
fi

chmod +x tools/nwjs-build.sh;

tools/nwjs-build.sh \
    --nw=0.12.1 \
    --src=src \
    --name="xresconv-gui" \
    --win-icon=doc/logo.ico \
    --target="3" \
    --version="1.0.0" \
    --build
