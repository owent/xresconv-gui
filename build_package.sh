#!/bin/sh

export NWJS_ROOT=/d/lib/nwjs/nwjs-v0.12.1-win-x64

cd src;
zip -r ../package.nw *;
cd ..;
cat $NWJS_ROOT/nw.exe package.nw > xresconv-gui.exe && chmod +x xresconv-gui.exe 
cp -f $NWJS_ROOT/nw.pak ./
cp -f $NWJS_ROOT/icudtl.dat ./
cp -rf $NWJS_ROOT/locales ./

zip xresconv-gui.zip xresconv-gui.exe nw.pak icudtl.dat locales;

rm -r xresconv-gui.exe package.nw nw.pak icudtl.dat locales;
