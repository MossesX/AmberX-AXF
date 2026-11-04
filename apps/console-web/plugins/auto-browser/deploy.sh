#!/bin/sh
# Start (or update) the Automated Browser host: builds the axf-browser image from host/ and runs it on the console's
# Docker network, never published on a host port. Profiles and downloads live in the axf-browser-data volume. The
# bearer token is generated once into the console's plugin data folder (0600), where the plugin's server reads it.
#   sh apps/console-web/plugins/auto-browser/deploy.sh        (on the VPS; AXF_HOST_DIR defaults to /opt/axf)
set -eu
ROOT="${AXF_HOST_DIR:-/opt/axf}"
HERE="${AXF_BROWSER_SRC:-$ROOT/apps/console-web/plugins/auto-browser}"   # where host/ is (a build checkout before merge)
DATA="$ROOT/.axf-console/plugins/auto-browser"
NET="${AXF_BROWSER_NETWORK:-coolify}"
NAME="${AXF_BROWSER_CONTAINER:-axf-browser}"
MEM="${AXF_BROWSER_MEMORY:-2g}"

mkdir -p "$DATA" && chmod 700 "$DATA"
if [ ! -s "$DATA/host-token" ]; then
  (umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DATA/host-token")
fi
# the console container reads it as its own user; keep it private to that user's group
chmod 640 "$DATA/host-token" 2>/dev/null || true

docker build -q -t axf-browser:latest "$HERE/host"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  --network "$NET" \
  --memory "$MEM" --shm-size 512m \
  -e AXF_BROWSER_TOKEN="$(cat "$DATA/host-token")" \
  -e AXF_BROWSER_MAX="${AXF_BROWSER_MAX:-3}" \
  -v axf-browser-data:/data \
  axf-browser:latest >/dev/null
echo "axf-browser running on network $NET (http://$NAME:7095, memory cap $MEM)"
