#!/bin/bash
# Start the built AppImage in debian:trixie as a non-root user and check that
# the packaged renderer answers on 127.0.0.1:5174.
#
#   docker run --rm -v "<io>:/io" debian:trixie bash /io/smoke-linux-appimage.sh
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq xvfb xauth curl libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libxtst6 libatspi2.0-0t64 libsecret-1-0 >/dev/null 2>&1 || echo "apt had errors"
useradd -m tester
cp /io/linux-out/*.AppImage /home/tester/wh.AppImage
chown tester /home/tester/wh.AppImage && chmod +x /home/tester/wh.AppImage
su tester -c 'cd ~ && ./wh.AppImage --appimage-extract >/dev/null && (xvfb-run -a ./squashfs-root/AppRun --no-sandbox > run.log 2>&1 &) ; for i in $(seq 1 60); do if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/ | grep -q 200; then echo RENDERER_UP_after_${i}s; break; fi; sleep 1; done; curl -s http://127.0.0.1:5174/ | grep -o "<title>[^<]*</title>"; sleep 5; cat ~/.config/*/origin-migration.json 2>/dev/null'
