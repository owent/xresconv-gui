#!/usr/bin/env bash

WORKING_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd -P)";
cd "$WORKING_DIR";

if [ ! -e 'tools' ] ; then
    mkdir -p tools;
fi

if [ ! -e 'tools/nwjs-build.sh' ] ; then
	which curl;
	if [ 0 == $? ]; then
		curl --insecure -L "https://github.com/Gisto/nwjs-shell-builder/raw/master/nwjs-build.sh" -o "tools/nwjs-build.sh";
	else
		wget --no-check-certificate -c "https://github.com/Gisto/nwjs-shell-builder/raw/master/nwjs-build.sh" -O "tools/nwjs-build.sh";
	fi
    
    chmod +x 'tools/nwjs-build.sh'; 
fi

cd tools;
./nwjs-build.sh "$@" --clean;

./nwjs-build.sh \
    --nw=0.12.3 \
    --src=../src \
    --name="xresconv-gui" \
    --win-icon=../doc/logo.ico \
    --version="1.1.3.0" \
    "$@" --build ;

# add dependency files 
