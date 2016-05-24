#!/bin/sh

cd "$(dirname "$0")";

which npm;
if [0 -ne $? ]; then
    echo "[ERROR] npm not found.";
fi

npm install --save-dev electron-prebuilt;
npm install --save-dev electron-packager;
npm install --save-dev gulp;