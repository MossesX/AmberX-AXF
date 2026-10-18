#!/usr/bin/env bash
# Container access — host part (plugin-lifecycle@1). Run by deploy/install-console.sh on the VPS as root:
#   host.sh up       start/refresh the Docker socket proxy; print extra `docker run` args for the console, one per line
#   host.sh attach   connect the running console ($NAME) to the proxy's private network
#   host.sh down     remove the proxy and its network
# The console never gets the raw socket. Everything here is labelled axf.plugin=<this folder>, so install-console.sh
# removes it (and /etc/axf/plugins/<this folder>) by itself once this plugin's folder is gone.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(basename "$(dirname "$HERE")")"
PROXY="axf-docker-proxy"; NETW="axf-docker-proxy"; IMAGE="${AXF_DOCKER_PROXY_IMAGE:-haproxy:2.9-alpine}"
case "${1:-}" in
  up)
    docker network inspect "$NETW" >/dev/null 2>&1 || docker network create --internal -l "axf.plugin=$PLUGIN" "$NETW" >/dev/null
    want="$(sha256sum "$HERE/haproxy.cfg" | cut -c1-16)-$IMAGE"
    have="$(docker inspect -f '{{index .Config.Labels "axf.config"}}' "$PROXY" 2>/dev/null || true)"
    running="$(docker inspect -f '{{.State.Running}}' "$PROXY" 2>/dev/null || echo false)"
    if [ "$want" != "$have" ] || [ "$running" != true ]; then
      docker rm -f "$PROXY" >/dev/null 2>&1 || true
      install -d -m 755 "/etc/axf/plugins/$PLUGIN"
      install -m 644 "$HERE/haproxy.cfg" "/etc/axf/plugins/$PLUGIN/docker-proxy.cfg"
      docker run -d --name "$PROXY" --restart unless-stopped --network "$NETW" --user 0 --read-only --tmpfs /tmp \
        --cap-drop ALL --security-opt no-new-privileges --memory 128m --pids-limit 200 \
        -l "axf.plugin=$PLUGIN" -l "axf.docker-proxy=1" -l "axf.config=$want" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v "/etc/axf/plugins/$PLUGIN/docker-proxy.cfg":/usr/local/etc/haproxy/haproxy.cfg:ro \
        "$IMAGE" >/dev/null
      echo "[axf] Docker socket proxy (re)started: $PROXY" >&2
    fi
    echo "-e"; echo "AXF_DOCKER_PROXY=http://$PROXY:2375"
    echo "-l"; echo "axf.console=1"
    ;;
  attach)
    docker network connect "$NETW" "${NAME:-axf-console}" 2>/dev/null || true
    ;;
  down)
    docker rm -f "$PROXY" >/dev/null 2>&1 || true
    docker network rm "$NETW" >/dev/null 2>&1 || true
    rm -rf "/etc/axf/plugins/$PLUGIN"
    ;;
  *) echo "usage: host.sh up|attach|down" >&2; exit 2 ;;
esac
