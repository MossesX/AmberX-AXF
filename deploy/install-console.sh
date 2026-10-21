#!/usr/bin/env bash
# One-shot VPS setup for the AXF Dev Console: the Python API + the React console + the server panel at
# https://console.amberxai.com (Debian/Ubuntu with Docker; run as root, e.g. from Hostinger's browser terminal).
#
#   curl -fsSL https://raw.githubusercontent.com/MossesX/AmberX-AXF/main/deploy/install-console.sh | bash
#   GITHUB_TOKEN=ghp_… DOMAIN=console.amberxai.com bash install-console.sh      # optional: token for CI artifact downloads
#
# What it does (safe to re-run):
#   1. clones / updates the repo into /opt/axf (the API runs installs and imports against this clone)
#   2. builds the one-container image from apps/console-web/server/Dockerfile (Node 22 + Python 3.12)
#   3. runs it as `axf-console` on Coolify's network behind Traefik (HTTPS via letsencrypt), or on port 7090 without Coolify
#   4. generates AXF_TOKEN (saved in /opt/axf/.axf-console/env) — needed by the panel for server control + terminal
#   5. installs a cron that pulls main every 5 minutes and rebuilds when it changed
#   6. puts the console behind axHub's sign-in wall (Traefik forwardAuth → https://axhub.amberxai.com/auth/verify)
#      once the hub can sign someone in; machines with the console token still reach /api and /mcp.
#      AXF_WALL=off bash install-console.sh   turns it off (saved; use it if the hub is down and you're locked out)
#      AXF_WALL=on  bash install-console.sh   always on (it also saves "on" by itself the first time the hub is ready)
#      AXF_WALL=auto bash install-console.sh  back to waiting for the hub (the default before the first success)
#      AXF_WALL_USERS=off|on bash install-console.sh   hub users (not admins) in the console: off = admins only (saved)
set -euo pipefail

DOMAIN="${DOMAIN:-console.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
BRANCH="${BRANCH:-main}"
NAME="${NAME:-axf-console}"
DIR="${DIR:-/opt/axf}"
PORT="${PORT:-7090}"
ENVF="$DIR/.axf-console/env"

say() { echo -e "\033[1;33m[axf]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
command -v docker >/dev/null || { say "Docker is required (Coolify installs it). Install Docker and re-run."; exit 1; }
command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git; }

# ---- 1. repo ----
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"; git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  say "Cloning into $DIR"; git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
mkdir -p "$DIR/.axf-console"

# ---- 2. secrets ----
# A token passed on the command line (AXF_TOKEN=… bash install-console.sh) replaces the saved one; otherwise the saved
# one (possibly reset from the panel or console settings) is kept.
ARG_AXF_TOKEN="${AXF_TOKEN:-}"
ARG_GITHUB_TOKEN="${GITHUB_TOKEN:-}"
if [ -f "$ENVF" ]; then
  # shellcheck disable=SC1090
  . "$ENVF"
fi
AXF_TOKEN="${ARG_AXF_TOKEN:-${AXF_TOKEN:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)}}"
GITHUB_TOKEN="${ARG_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
cat > "$ENVF" <<ENV
AXF_TOKEN=$AXF_TOKEN
GITHUB_TOKEN=$GITHUB_TOKEN
DOMAIN=$DOMAIN
ENV
chmod 600 "$ENVF"

# ---- 3. image ----
say "Building image (first build takes a few minutes: npm ci + pip)"
# Shared data (the root project.manifest.json's data.shared) lives in the hub's projects tree (axhub-projects@1):
#   /projects/amberx-axf/_data/<same path as in the repo>, on axHub's own Docker volume "axhub-projects"
# (Coolify → axHub → Persistent Storage, axHub deploy/coolify.md §5b). The console mounts the same volume.
# Until that volume exists, data stays in the legacy folder $PERSIST_DIR/amberx-axf.
PERSIST_DIR="${PERSIST_DIR:-/opt/axhub/persist}"
HUB_UID="${HUB_UID:-1000}"
# Undo of claude-fs@1 (Oct 18 2026): an install from that version may have moved live data into
# /Claude/projects/<project>/data on this VPS. Move it back, then remove /Claude if nothing else is left in it.
if [ -d /Claude/projects ] && ! mountpoint -q /Claude 2>/dev/null; then
  mkdir -p "$PERSIST_DIR"
  for d in /Claude/projects/*/data; do
    [ -d "$d" ] || continue
    p="$(basename "$(dirname "$d")")"; to="$PERSIST_DIR/$p"
    if [ -e "$to" ] && [ -n "$(ls -A "$to" 2>/dev/null)" ]; then say "kept $to; $d left in place for you to check"; continue; fi
    rmdir "$to" 2>/dev/null || true
    mv "$d" "$to" && say "moved $d back to $to"
  done
  find /Claude -depth -type d -empty -delete 2>/dev/null || true
  [ -d /Claude ] && say "/Claude still has files (left in place): $(find /Claude -type f | head -3 | tr '\n' ' ')" || say "removed the empty /Claude folder"
fi
docker build -q -f "$DIR/apps/console-web/server/Dockerfile" -t "$NAME:latest" "$DIR" >/dev/null

if [ -n "${AXHUB_PROJECTS_VOLUME:-}" ]; then VOL="$AXHUB_PROJECTS_VOLUME"
else
  VOLS="$(docker volume ls -q | grep -E '(^|[-_])axhub-projects$' || true)"
  if [ "$(printf '%s\n' "$VOLS" | grep -c .)" -gt 1 ]; then
    say "Several axhub-projects volumes: $(echo $VOLS). Set AXHUB_PROJECTS_VOLUME to the one axHub uses and re-run; keeping $PERSIST_DIR for now."
    VOL=""
  else VOL="$VOLS"; fi
fi
LEGACY="$PERSIST_DIR/amberx-axf"
if [ -n "$VOL" ]; then
  say "projects volume: $VOL → /projects (main copy of the shared data: /projects/amberx-axf/_data)"
  # The old console must not write the legacy folder while it is copied.
  docker stop -t 15 "$NAME" >/dev/null 2>&1 || true  # let the API shut down cleanly (alerts tell an unclean stop from a crash)
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  HELPER=(docker run --rm -v "$VOL":/projects -v "$DIR":/axf:ro -e AXF_DATA_DIR=/projects/amberx-axf/_data -e HUB_UID="$HUB_UID")
  [ -d "$LEGACY" ] && HELPER+=(-v "$LEGACY":/old:ro)
  # Once, without overwriting: copy the legacy folder in (marker only after a clean copy), seed what's missing from
  # the repo, then share the project's folders with the hub user ($HUB_UID): group $HUB_UID, setgid, group-writable.
  "${HELPER[@]}" --entrypoint sh "$NAME:latest" -c '
      set -e
      for d in _data _claude/memory _claude/instructions _claude/rules _claude/shared; do mkdir -p "/projects/amberx-axf/$d"; done
      mkdir -p /projects/_shared/_claude
      if [ -d /old ] && [ ! -e /projects/amberx-axf/_data/.legacy-copied ]; then
        { cp -a --update=none /old/. /projects/amberx-axf/_data/ 2>/dev/null || cp -a -n /old/. /projects/amberx-axf/_data/; } && touch /projects/amberx-axf/_data/.legacy-copied && echo "copied the legacy data folder in"
      fi
      node /axf/framework/cli/persist.mjs push | sed "s/^/  /"
      chown -R "$HUB_UID:$HUB_UID" /projects/amberx-axf /projects/_shared
      chown "$HUB_UID:$HUB_UID" /projects
      find /projects/amberx-axf /projects/_shared -type d -exec chmod 2775 {} +
      find /projects/amberx-axf /projects/_shared -type f -exec chmod ug+rw {} +
    ' | sed 's/^/[axf] /'
  # Once copied, the legacy folder is renamed so nothing keeps writing a second, diverging copy (kept, not deleted).
  if [ -d "$LEGACY" ] && "${HELPER[@]}" --entrypoint sh "$NAME:latest" -c 'test -e /projects/amberx-axf/_data/.legacy-copied'; then
    mv "$LEGACY" "$LEGACY.moved-to-projects" && say "legacy folder kept as $LEGACY.moved-to-projects"
  fi
  DATA_ARGS=(-v "$VOL":/projects)
else
  [ -n "${AXHUB_PROJECTS_VOLUME:-}${VOLS:-}" ] || say "No axhub-projects volume yet (add it to axHub in Coolify: deploy/coolify.md §5b in the axHub repo); keeping $LEGACY"
  mkdir -p "$PERSIST_DIR"
  AXF_PERSIST_DIR="$PERSIST_DIR" node "$DIR/framework/cli/persist.mjs" push 2>/dev/null | sed 's/^/[axf] /' || say "node not on the host; the console seeds $LEGACY on first read"
  DATA_ARGS=(-v "$PERSIST_DIR":/persist -e AXF_PERSIST_DIR=/persist)
fi

# One-off fixes to the live shared data (idempotent; each only changes what still needs it), run in the console image
# against the same data the console will use.
docker run --rm -v "$DIR":/axf:ro "${DATA_ARGS[@]}" -e AXF_ROOT=/axf --entrypoint node "$NAME:latest" /axf/framework/cli/data-fixes.mjs 2>&1 | sed 's/^/[axf] /' || say "data fixes didn't run (the console still starts)"

# ---- 3c. plugin sidecars ----
# Container access plugin: the locked-down Docker socket proxy (never the raw socket in the console). Explicit, one plugin.
PLUGIN_ARGS=()
CA_HOST="$DIR/apps/console-web/plugins/container-access/deploy/host.sh"  # axf-plugin:container-access
[ -f "$CA_HOST" ] && { mapfile -t PLUGIN_ARGS < <(NAME="$NAME" bash "$CA_HOST" up) || say "Docker socket proxy didn't start"; }  # axf-plugin:container-access
_PA=(); for a in "${PLUGIN_ARGS[@]}"; do [ -n "$a" ] && _PA+=("$a"); done; PLUGIN_ARGS=("${_PA[@]}")  # never pass an empty arg to docker run (it would be read as the image name)
# Sidecars of plugins whose folder is gone (label axf.plugin=<folder>) are removed; nothing is run for them.
for c in $(docker ps -aq --filter label=axf.plugin); do
  f="$(docker inspect -f '{{index .Config.Labels "axf.plugin"}}' "$c")"
  if [ -n "$f" ] && [ ! -d "$DIR/apps/console-web/plugins/$f" ]; then docker rm -f "$c" >/dev/null && say "removed the $f sidecar (plugin uninstalled)"; fi
done
for n in $(docker network ls -q --filter label=axf.plugin); do
  f="$(docker network inspect -f '{{index .Labels "axf.plugin"}}' "$n")"
  if [ -n "$f" ] && [ ! -d "$DIR/apps/console-web/plugins/$f" ]; then docker network rm "$n" >/dev/null 2>&1 || true; fi
done
for d in /etc/axf/plugins/*/; do
  if [ -d "$d" ] && [ ! -d "$DIR/apps/console-web/plugins/$(basename "$d")" ]; then rm -rf "$d"; fi
done

# ---- 4. container ----
docker stop -t 15 "$NAME" >/dev/null 2>&1 || true  # clean shutdown first (alerts: no false "unclean restart")
docker rm -f "$NAME" >/dev/null 2>&1 || true
COMMON=(-d --name "$NAME" --restart unless-stopped -v "$DIR":/axf "${DATA_ARGS[@]}" -e AXF_ROOT=/axf -e AXF_STATE=/axf/.axf-console/state.json -e AXF_TOKEN="$AXF_TOKEN" -e GITHUB_TOKEN="$GITHUB_TOKEN" -e PORT="$PORT" -e AXF_GITHUB_REPO=MossesX/AmberX-AXF "${PLUGIN_ARGS[@]}")
if docker ps --format '{{.Names}}' | grep -qx coolify-proxy; then
  say "Coolify proxy detected — publishing https://$DOMAIN behind Traefik"
  NET="$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | tr ' ' '\n' | grep -x coolify || true)"
  NET="${NET:-$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -n1)}"
  R="axfconsole"
  # ---- 6. the wall (axHub sign-in, decision #77 in axHub) ----
  WALLF="$DIR/.axf-console/wall"
  [ -n "${AXF_WALL:-}" ] && { echo "$AXF_WALL" > "$WALLF"; chmod 600 "$WALLF"; }
  # "off" = no wall; "on" = always walled (written after the first time the hub could sign someone in, so a hub
  # outage blocks the console instead of opening it); nothing saved yet = wait until the hub is ready.
  WALL="$(cat "$WALLF" 2>/dev/null || echo auto)"
  WALL_HUB="${AXF_WALL_HUB:-https://axhub.amberxai.com}"
  WALL_ARGS=()
  if [ "$WALL" = "off" ]; then
    rm -f "$DIR/.axf-console/wall-waiting"
    say "Sign-in wall OFF (AXF_WALL=on bash install-console.sh turns it back on); the console uses its local settings, not the hub's look, until then"
  else
    if [ "$WALL" != "on" ]; then
      # Switch it on only when the hub really can sign someone in, so a hub without accounts never locks you out.
      LOGIN="$(curl -fsS --max-time 10 "$WALL_HUB/auth/login" 2>/dev/null || true)"
      if echo "$LOGIN" | grep -q 'action="/auth/login"' && ! echo "$LOGIN" | grep -q 'No accounts yet'; then
        WALL=on; echo on > "$WALLF"; chmod 600 "$WALLF"
      fi
    fi
    if [ "$WALL" = "on" ]; then
      rm -f "$DIR/.axf-console/wall-waiting"
      say "Sign-in wall ON: browsers sign in at $WALL_HUB first (admins, plus users for what an admin granted them); the console token still works on /api and /mcp"
      say "  locked out because the hub is down? AXF_WALL=off bash $DIR/deploy/install-console.sh"
      # Plugins whose plugin.json says "wallUsers": true are open to every signed-in hub user (the plugin limits them);
      # everything else on the console needs a hub admin. The console trusts the wall's headers only with AXF_TRUST_WALL=1.
      USER_PATHS="$(cd "$DIR/apps/console-web/plugins" 2>/dev/null && for f in */plugin.json; do
        d="${f%/plugin.json}"; case "$d" in _*) continue;; esac
        if grep -Eq '"wallUsers"[[:space:]]*:[[:space:]]*true' "$f"; then printf '/api/plugins/%s/%%2C' "$d"; fi; done; true)"  # %2C = "," (kept out of the label's own list syntax)
      USER_PATHS="${USER_PATHS%\%2C}"
      # Signed-in hub *users* (not just admins) may open the whole console; the console itself decides what each
      # one may do (server/wall.py: page + read-only data + plugins an admin granted). AXF_WALL_USERS=off = admins only.
      [ -n "${AXF_WALL_USERS:-}" ] && { echo "$AXF_WALL_USERS" > "$DIR/.axf-console/wall-users"; chmod 600 "$DIR/.axf-console/wall-users"; }
      [ "$(cat "$DIR/.axf-console/wall-users" 2>/dev/null || echo on)" = "off" ] || USER_PATHS="/"
      WALL_ADDR="$WALL_HUB/auth/verify${USER_PATHS:+?user_paths=$USER_PATHS}"
      # The hub signs who is signed in (X-Auth-Sig) with a secret both sides share, so nothing that reaches the console
      # without the proxy can claim to be signed in. Generated once here; copy it to the axHub app as AXHUB_WALL_SECRET.
      WSECF="$DIR/.axf-console/wall-secret"
      [ -n "${AXF_WALL_SECRET:-}" ] && { printf '%s' "$AXF_WALL_SECRET" > "$WSECF"; chmod 600 "$WSECF"; }
      if [ ! -s "$WSECF" ]; then
        (umask 077; openssl rand -hex 32 2>/dev/null > "$WSECF" || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$WSECF")
        say "  made a wall secret: put it on the axHub app in Coolify as AXHUB_WALL_SECRET (view it with: cat $WSECF)"
      fi
      say "  until AXHUB_WALL_SECRET on the hub matches $WSECF, signed-in browsers still need the console token and hub users can't chat"
      WALL_ARGS=(-e AXF_TRUST_WALL=1 -e "AXF_WALL_SECRET=$(cat "$WSECF")" -e "AXF_WALL_HUB=$WALL_HUB" \
        -l "traefik.http.middlewares.$R-strip.headers.customrequestheaders.X-Auth-User=" \
        -l "traefik.http.middlewares.$R-strip.headers.customrequestheaders.X-Auth-Role=" \
        -l "traefik.http.middlewares.$R-strip.headers.customrequestheaders.X-Auth-Perms=" \
        -l "traefik.http.middlewares.$R-strip.headers.customrequestheaders.X-Auth-Via=" \
        -l "traefik.http.middlewares.$R-strip.headers.customrequestheaders.X-Auth-Sig=" \
        -l "traefik.http.middlewares.$R-wall.forwardauth.address=$WALL_ADDR" \
        -l "traefik.http.middlewares.$R-wall.forwardauth.authResponseHeaders=X-Auth-User,X-Auth-Role,X-Auth-Perms,X-Auth-Via,X-Auth-Sig" \
        -l "traefik.http.routers.$R.middlewares=$R-strip,$R-wall")
      [ -n "$USER_PATHS" ] && say "  hub users (not only admins) may use: $USER_PATHS"
    else
      touch "$DIR/.axf-console/wall-waiting"
      say "Sign-in wall waiting: $WALL_HUB has no sign-in yet (redeploy axHub and set AXHUB_ADMIN_PASSWORD); the 5-minute update turns it on"
    fi
  fi
  docker run "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}" \
    -l traefik.enable=true -l "traefik.docker.network=$NET" \
    -l "traefik.http.routers.$R-http.rule=Host(\`$DOMAIN\`)" -l "traefik.http.routers.$R-http.entrypoints=http" \
    -l "traefik.http.routers.$R-http.middlewares=$R-https" -l "traefik.http.middlewares.$R-https.redirectscheme.scheme=https" \
    -l "traefik.http.routers.$R.rule=Host(\`$DOMAIN\`)" -l "traefik.http.routers.$R.entrypoints=https" \
    -l "traefik.http.routers.$R.tls=true" -l "traefik.http.routers.$R.tls.certresolver=letsencrypt" \
    -l "traefik.http.services.$R.loadbalancer.server.port=$PORT" \
    "$NAME:latest" >/dev/null
  URL="https://$DOMAIN"
else
  say "No Coolify proxy — exposing port $PORT directly (put a reverse proxy with HTTPS in front before using the terminal remotely)"
  docker run "${COMMON[@]}" -p "$PORT:$PORT" "$NAME:latest" >/dev/null
  URL="http://$(curl -fsS -4 --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):$PORT"
fi

[ -f "$CA_HOST" ] && NAME="$NAME" bash "$CA_HOST" attach  # axf-plugin:container-access

# ---- 5. auto-update ----
cat > /usr/local/bin/axf-console-update <<UPD
#!/usr/bin/env bash
# One block, so bash reads it all before running: install-console.sh rewrites this file while it runs.
{
set -e
cd "$DIR"
before=\$(git rev-parse HEAD); git fetch -q origin $BRANCH && git reset -q --hard origin/$BRANCH
[ "\$before" = "\$(git rev-parse HEAD)" ] && [ ! -f "$DIR/.axf-console/wall-waiting" ] && exit 0  # also re-run while the sign-in wall waits for the hub
# The console's Activity banner reads this while the update runs (activity@1, source "update"). No secrets in it.
st="$DIR/.axf-console/update-status.json"; after=\$(git rev-parse HEAD); t0=\$(date +%s)
printf '{"state":"building","from":"%s","to":"%s","startedAt":%s}\n' "\$before" "\$after" "\$t0" > "\$st.tmp" && mv -f "\$st.tmp" "\$st"
state=done
GITHUB_TOKEN="$GITHUB_TOKEN" DOMAIN="$DOMAIN" NAME="$NAME" DIR="$DIR" PORT="$PORT" bash "$DIR/deploy/install-console.sh" >> /var/log/axf-console-update.log 2>&1 || state=failed
printf '{"state":"%s","from":"%s","to":"%s","startedAt":%s,"finishedAt":%s}\n' "\$state" "\$before" "\$after" "\$t0" "\$(date +%s)" > "\$st.tmp" && mv -f "\$st.tmp" "\$st"
[ "\$state" = done ]
exit
}
UPD
chmod +x /usr/local/bin/axf-console-update
echo "*/5 * * * * root /usr/local/bin/axf-console-update" > /etc/cron.d/axf-console
chmod 644 /etc/cron.d/axf-console
# Host report for the console's systems check (mosh, Claude Code, cron, Docker…): every 15 minutes, report only.
echo "*/15 * * * * root DIR=$DIR NAME=$NAME bash $DIR/deploy/console-doctor.sh --report >/dev/null 2>&1" > /etc/cron.d/axf-doctor
chmod 644 /etc/cron.d/axf-doctor
DIR="$DIR" NAME="$NAME" bash "$DIR/deploy/console-doctor.sh" --report </dev/null || true

sleep 3
docker ps --filter "name=^$NAME$" --format '{{.Names}} is {{.Status}}' | sed 's/^/[axf] /'
SERVER_IP="$(curl -fsS -4 --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DNS_IP="$(getent hosts "$DOMAIN" | awk '{print $1}' | tail -n1 || true)"
[ "$DNS_IP" = "$SERVER_IP" ] || say "DNS: point an A record for $DOMAIN at $SERVER_IP (currently '${DNS_IP:-unset}'); HTTPS starts working once it resolves."
say "Dev Console:   $URL"
say "Server panel:  $URL/panel"
say "Setup check:   bash $DIR/deploy/console-doctor.sh   (fixes host issues the console banner lists)"
say "AXF_TOKEN:     $AXF_TOKEN   (paste it into the panel's Connection → Token; saved in $ENVF)"
[ -n "$GITHUB_TOKEN" ] || say "Tip: re-run with GITHUB_TOKEN=ghp_… for one-click APK / Maven downloads from CI (with Contents: write it also lets Settings → Session check-in install for every clone)."
