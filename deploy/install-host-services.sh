#!/usr/bin/env bash
# Install the console's host services (host-service@1, framework/spec/HOST-SERVICES.md) on the VPS: the parts of the
# console that must keep running while the axf-console container is down, or that touch Docker, disk or git, run here
# as systemd units under a limited account; the console keeps the UI and talks to them over /run/axf-host.
#
#   bash deploy/install-host-services.sh                    install / update every service in deploy/host-services/services
#   bash deploy/install-host-services.sh --only a,b         only these (host-api always comes along)
#   bash deploy/install-host-services.sh --uninstall [--only a,b]
#                                                           stop, disable and remove the units (and the account and the
#                                                           sudoers file when nothing is left); data stays
#   bash deploy/install-host-services.sh --dry-run [...]    print what would run; files go under $AXF_HOST_PREFIX (a temp
#                                                           folder by default) and nothing on this machine changes
#
# What it does:
#   1. checks every manifest and worker (axf-hostd.mjs --check)
#   2. creates the group and the system user axf-host (no shell, no password, no docker group: Docker goes through
#      the sudo whitelist), adds it to systemd-journal (the Logs route) and the shared data folder's group
#   3. writes /etc/axf-host/env (AXF_HOST_TOKEN, the docker bridge address for the loopback listener; root:axf-host
#      0640) and /etc/axf-host/console.env (what the axf-console container needs: AXF_HOST_API, the fallback, the token
#      and the group id; root 0600). deploy/install-console.sh mounts /run/axf-host into the container, adds the group
#      and reads console.env on its next run (every merge to main runs it through the auto-update).
#   4. renders deploy/host-services/axf-host@.service into /etc/systemd/system/axf-<id>.service per service
#   5. writes /etc/sudoers.d/axf-host from the manifests (gen-sudoers.mjs, checked with visudo -c)
#   6. daemon-reload, enable --now (host-api first, then the cut-over order); every service starts in the mode the mode
#      file gives it (container by default: installed and idle until the migration moves it)
# Env: AXF_HOST_STATE (where the units see their state folder, default /var/lib/axf-host/data),
# Env: DIR (checkout, default this repo), AXF_HOST_DATA (shared data folder; default the axhub-projects volume's
#      amberx-axf/_data, else $DIR/_data), AXF_HOST_PREFIX (root for written files, tests), AXF_SYSTEMD_DIR.
set -euo pipefail
DIR="${DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck source=../framework/deploy/axf-deploy.sh
. "$DIR/framework/deploy/axf-deploy.sh"

DRY=""; ONLY=""; UNINSTALL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    --only=*) ONLY="${1#--only=}" ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$ONLY" in *[!a-z0-9,-]*) echo "--only takes service ids (a,b)" >&2; exit 2 ;; esac

say() { echo "[axf-host] $*"; }
if [ -n "$DRY" ]; then
  PREFIX="${AXF_HOST_PREFIX:-$(mktemp -d /tmp/axf-host-dry.XXXXXX)}"
  run() { echo "+ $*"; }
else
  PREFIX="${AXF_HOST_PREFIX:-}"
  run() { "$@"; }
  [ "$(id -u)" = 0 ] || { echo "run as root (sudo bash $0 …)" >&2; exit 1; }
fi
UNITS="${AXF_SYSTEMD_DIR:-$PREFIX/etc/systemd/system}"
ETC="$PREFIX/etc/axf-host"
SUDOERS="$PREFIX/etc/sudoers.d/axf-host"
HOSTD="$DIR/deploy/host-services/axf-hostd.mjs"
TEMPLATE="$DIR/deploy/host-services/axf-host@.service"
command -v node >/dev/null || { echo "node is required on the host (it runs the lander too)" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || say "warning: Node $(node -v) on the host; shipped-features needs Node 22+ (node:sqlite) and reports itself degraded until it is upgraded"


# ---- 1. manifests
node "$HOSTD" --check >/dev/null || { node "$HOSTD" --check >&2 || true; echo "manifests or workers are broken: nothing installed" >&2; exit 1; }
PLAN="$(node "$HOSTD" --plan "$ONLY")"
ALL="$(node "$HOSTD" --plan)"

# ---- data folder (the console sees the same folder as /projects/amberx-axf/_data)
if [ -z "${AXF_HOST_DATA:-}" ]; then
  VOL="${AXHUB_PROJECTS_VOLUME:-$( (docker volume ls -q 2>/dev/null || true) | grep -E '(^|[-_])axhub-projects$' | head -1)}"
  MP=""; [ -n "$VOL" ] && MP="$(docker volume inspect -f '{{.Mountpoint}}' "$VOL" 2>/dev/null || true)"
  if [ -n "$MP" ] && [ -d "$MP/amberx-axf/_data" ]; then AXF_HOST_DATA="$MP/amberx-axf/_data"; else AXF_HOST_DATA="$DIR/_data"; fi
fi
AXF_HOST_STATE="${AXF_HOST_STATE:-/var/lib/axf-host/data}"
say "checkout $DIR, data $AXF_HOST_DATA${DRY:+ (dry run, files under $PREFIX)}"

# ---- uninstall
if [ -n "$UNINSTALL" ]; then
  # --only removes those services (never host-api while others remain); no --only removes everything.
  while IFS=$'\t' read -r id unit _nnp render _kind; do
    [ -n "$id" ] || continue
    if [ -n "$ONLY" ] && [ "$id" = host-api ]; then continue; fi
    if [ "$render" = adopted ]; then continue; fi  # its own installer owns it: never stopped or removed here
    say "removing $unit"
    run systemctl disable --now "$unit" || true
    [ "$render" = yes ] && { [ -n "$DRY" ] && echo "+ rm -f $UNITS/$unit" || rm -f "$UNITS/$unit"; }
  done <<< "$PLAN"
  if [ -n "$ONLY" ]; then
    KEEP="$(printf '%s\n' "$ALL" | cut -f1 | grep -vxF -f <(printf '%s\n' "${ONLY//,/$'\n'}") | grep -vx host-api | paste -sd, -)"
    mkdir -p "$(dirname "$SUDOERS")"
    node "$DIR/deploy/host-services/gen-sudoers.mjs" --only "$KEEP" --root "$DIR" --out "$SUDOERS"
  else
    [ -n "$DRY" ] && echo "+ rm -f $SUDOERS $ETC/env $ETC/console.env" || rm -f "$SUDOERS" "$ETC/env" "$ETC/console.env"
    run userdel axf-host || true
    run groupdel axf-host || true
    say "data in $AXF_HOST_DATA/host-services is kept (remove it by hand if you mean it)"
  fi
  run systemctl daemon-reload
  say "uninstalled${ONLY:+: $ONLY}"
  exit 0
fi

# ---- 2. account
if ! getent group axf-host >/dev/null 2>&1; then run groupadd --system axf-host; fi
if ! id axf-host >/dev/null 2>&1; then run useradd --system --gid axf-host --home-dir /var/lib/axf-host --no-create-home --shell /usr/sbin/nologin axf-host; fi
getent group systemd-journal >/dev/null 2>&1 && run usermod -aG systemd-journal axf-host
DATA_GID="$(stat -c %g "$AXF_HOST_DATA" 2>/dev/null || echo 0)"
[ "$DATA_GID" != 0 ] && run usermod -aG "$(getent group "$DATA_GID" | cut -d: -f1 || echo "$DATA_GID")" axf-host
run mkdir -p "$AXF_HOST_DATA/host-services"
run chown axf-host:axf-host "$AXF_HOST_DATA/host-services"
run chmod 2775 "$AXF_HOST_DATA/host-services"
# Where the units see that folder (bound by systemd: axf-host cannot walk into a Docker volume by its real path).
run mkdir -p "$AXF_HOST_STATE/host-services"
run chown axf-host:axf-host "$AXF_HOST_STATE"
run chmod 750 "$AXF_HOST_STATE"

# ---- 3. env files (token kept across runs)
mkdir -p "$ETC"
TOKEN="$(sed -n 's/^AXF_HOST_TOKEN=//p' "$ETC/env" 2>/dev/null | head -1 || true)"
[ -n "$TOKEN" ] || TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
BRIDGE="$( (ip -4 addr show docker0 2>/dev/null || true) | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)"
GID="$(getent group axf-host 2>/dev/null | cut -d: -f3 || true)"
PROJ=""; case "$AXF_HOST_DATA" in */amberx-axf/_data) PROJ="${AXF_HOST_DATA%/amberx-axf/_data}" ;; esac
( umask 027; printf 'AXF_HOST_TOKEN=%s\nAXF_HOST_BIND=%s\nAXHUB_PROJECTS_DIR=%s\n' "$TOKEN" "$BRIDGE" "$PROJ" > "$ETC/env" )
( umask 077; printf 'AXF_HOST_API=unix:/run/axf-host/api.sock\nAXF_HOST_API_FALLBACK=http://host.docker.internal:7788\nAXF_HOST_TOKEN=%s\nAXF_HOST_GID=%s\n' "$TOKEN" "${GID:-}" > "$ETC/console.env" )
[ -z "$DRY" ] && chown root:axf-host "$ETC/env"
say "wrote $ETC/env and $ETC/console.env (the console mounts /run/axf-host on its next install run)"

# ---- 4. units
mkdir -p "$UNITS"
ENABLE=()
while IFS=$'\t' read -r id unit nnp render _kind; do
  [ -n "$id" ] || continue
  if [ "$render" = yes ]; then
    sed -e "s|%i|$id|g" -e "s|@DIR@|$DIR|g" -e "s|@DATA@|$AXF_HOST_DATA|g" -e "s|@STATE@|$AXF_HOST_STATE|g" -e "s|@NNP@|$nnp|g" "$TEMPLATE" > "$UNITS/$unit"
    chmod 644 "$UNITS/$unit"
    grep -q '@[A-Z]*@' "$UNITS/$unit" && { echo "$unit: placeholder left" >&2; exit 1; }
    ENABLE+=("$unit")
    say "unit $unit (NoNewPrivileges=$nnp)"
  else
    # an adopted schedule (the lander, the orchestrator tick, the watchdogs, the reaper…): its own installer owns the
    # unit or cron file. Listed and health-checked through the host API, never installed, enabled or stopped here.
    say "$id is adopted ($unit): left to its own installer"
  fi
done <<< "$PLAN"

# ---- 5. sudoers (only the declared commands; visudo -c before it goes live)
mkdir -p "$(dirname "$SUDOERS")"
node "$DIR/deploy/host-services/gen-sudoers.mjs" ${ONLY:+--only "$ONLY"} --root "$DIR" --out "$SUDOERS"

# ---- 6. start
run systemctl daemon-reload
# reset-failed first: a unit that hit its start limit refuses a restart until the limit is cleared
for u in "${ENABLE[@]}"; do run systemctl reset-failed "$u" || true; run systemctl enable --now "$u"; run systemctl restart "$u"; done
[ -z "$DRY" ] && axf_deploy_log "$AXF_HOST_DATA/deploys/deploy-log.jsonl" "host:services" "$(git -C "$DIR" rev-parse HEAD 2>/dev/null || echo 0)" >/dev/null 2>&1 || true
say "installed ${#ENABLE[@]} unit(s): ${ENABLE[*]}"
say "status: node $DIR/framework/cli/host-services.mjs list   (or the console: Settings → Plugins → Host services)"
