#!/bin/bash
# Build the Linux AppImage inside node:22-bookworm from a `git archive` of the
# release commit, so no Windows node_modules or binaries leak into it.
#
#   git archive --format=tar -o <io>/src.tar HEAD
#   docker run --rm -v "<io>:/io" node:22-bookworm bash /io/build-linux-appimage.sh
#
# Leaves the AppImage (named by electron-builder, with a space) and
# latest-linux.yml in <io>/linux-out/.
set -euo pipefail
mkdir -p /build /io/linux-out && cd /build
tar -xf /io/src.tar
npm ci --no-audit --no-fund
npm run fetch:bin
npm run build:desktop
npx electron-builder --linux AppImage --x64 --publish never
cp release/*.AppImage release/latest-linux.yml /io/linux-out/
echo LINUX_BUILD_OK
