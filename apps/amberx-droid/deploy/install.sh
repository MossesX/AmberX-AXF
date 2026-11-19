#!/usr/bin/env bash
# The AmberX web app on the VPS at https://$DOMAIN behind Coolify's Traefik and axHub's sign-in wall (hub admins only).
# The AmberX Android shell (android/, Capacitor `server.url`) loads this address.
#
#   sudo bash apps/amberx-droid/deploy/install.sh          (from any AmberX-AXF checkout)
#   sudo bash apps/amberx-droid/deploy/install.sh --remove (rollback: container, update script and cron gone)
#
#   The app lives in AmberX-AXF/apps/amberx-droid (no repo of its own): this clones AmberX-AXF into $DIR and
#   builds the app folder. Private repo: GITHUB_TOKEN=… or the Dev Console's saved one; never written to .git/config.
#   DNS: an A record for $DOMAIN pointing at the VPS, under the hub's cookie domain (amberxai.com) so the browser's
#   hub session reaches the app, axHub's feeds and its data server (look, settings).
#
# What it does (safe to re-run):
#   1. clones / updates the repo into $DIR
#   2. builds the image (web app + AmberX's own server, server/: it holds the AI keys and switches providers; built
#      from the repo root so it gets the framework's Python packages) and runs it as $NAME on Coolify's network,
#      with its data folder $DIR/.app/data mounted at /data (0700, files 0600)
#   3. puts it behind axHub's sign-in wall once the hub can sign someone in (APP_WALL=off|on|auto, saved); the server
#      trusts the wall's headers only with the hub's signature (AMBERX_WALL_SECRET = the hub's AXHUB_WALL_SECRET)
#   4. installs a cron that pulls the branch every 5 minutes and re-runs this when it changed
#
# AI keys: paste them in AmberX → Settings → Plugins → AI connection (hub admins), saved on the server only. Or pass
# them once here (kept in $DIR/.app/ai.env, 0600): AMBERX_ANTHROPIC_API_KEY, AMBERX_OPENAI_API_KEY,
# AMBERX_GEMINI_API_KEY, … (AMBERX_<KIND>_API_KEY), AMBERX_CLAUDE_OAUTH_TOKEN [+ AMBERX_CLAUDE_REFRESH_TOKEN].
#   APP_WALL_USERS=on   every signed-in hub user may use the AI (parse / summarize / ask); only admins change it
set -euo pipefail

DOMAIN="${DOMAIN:-amberx.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
SUB="${SUB:-apps/amberx-droid}"
BRANCH="${BRANCH:-main}"
NAME="${NAME:-amberx-web}"
DIR="${DIR:-/opt/amberx-web}"
PORT=8080
AXF_DIR="${AXF_DIR:-/opt/axf}"   # the Dev Console's clone: its GitHub token is reused for the private repo
STATE="$DIR/.app"

say() { echo -e "\033[1;36m[amberx]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  docker stop "$NAME" >/dev/null 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -f "/etc/cron.d/$NAME" "/usr/local/bin/$NAME-update"
  say "Removed $NAME (container, update script, cron). Traefik drops its routes; $DOMAIN no longer answers. AI settings stay in $STATE/data."
  exit 0
fi
command -v docker >/dev/null || { say "Docker is required (Coolify installs it)."; exit 1; }
command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git; }

# ---- 1. repo ----
# The console keeps its GitHub token in its env file or in the credentials it saved from the systems check (secrets.env).
for f in "$AXF_DIR/.axf-console/env" "$AXF_DIR/.axf-console/secrets.env"; do
  if [ -z "${GITHUB_TOKEN:-}" ] && [ -f "$f" ]; then GITHUB_TOKEN="$(sed -n 's/^GITHUB_TOKEN=//p' "$f" | head -n1)"; fi
done
GIT=(git)
[ -n "${GITHUB_TOKEN:-}" ] && GIT=(git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)")
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"; "${GIT[@]}" -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  say "Cloning into $DIR"
  if ! "${GIT[@]}" clone -q --branch "$BRANCH" "$REPO" "$DIR"; then
    # No token found here: start from the console's checkout, which already reaches GitHub, and keep
    # fetching through it (the console's own 5-minute update keeps its main current).
    say "GitHub refused the clone; using the console's checkout $AXF_DIR instead"
    rm -rf "$DIR"
    git -C "$AXF_DIR" fetch -q origin "$BRANCH:refs/remotes/origin/$BRANCH"
    git clone -q --no-checkout "$AXF_DIR" "$DIR"
    git -C "$DIR" fetch -q origin "refs/remotes/origin/$BRANCH:refs/remotes/origin/$BRANCH"
    git -C "$DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
  fi
fi
mkdir -p "$STATE/data"; chmod 700 "$STATE"
chown 1000:1000 "$STATE/data" && chmod 700 "$STATE/data"   # the container runs as uid 1000
APP="$DIR/$SUB"
[ -f "$APP/Dockerfile" ] || { say "No app at $APP"; exit 1; }
# shellcheck source=../../../framework/deploy/axf-deploy.sh
. "$DIR/framework/deploy/axf-deploy.sh"

# ---- 2. image ----
say "Building the image (first time takes a few minutes)"
docker build -q -t "$NAME:latest" -f "$APP/Dockerfile" "$DIR" >/dev/null
axf_stop_container "$NAME"
# AI keys given to this run are kept for the next ones (0600); nothing is written when none are given.
AIENV="$STATE/ai.env"
(umask 077; touch "$AIENV"); chmod 600 "$AIENV"
while IFS='=' read -r k _; do
  case "$k" in
    AMBERX_*_API_KEY|AMBERX_CLAUDE_OAUTH_TOKEN|AMBERX_CLAUDE_REFRESH_TOKEN)
      v="${!k}"; [ -n "$v" ] || continue
      (umask 077; { grep -v "^$k=" "$AIENV" || true; printf '%s=%s\n' "$k" "$v"; } > "$AIENV.tmp" && mv "$AIENV.tmp" "$AIENV")
      say "Saved $k for the AI server" ;;
  esac
done < <(env)
# The server's own settings (0600): the wall's trust switch + shared secret go here, never on the command line.
SRVENV="$STATE/server.env"
(umask 077; printf 'AMBERX_DATA_DIR=/data\nAMBERX_WALL_HUB=%s\n' "${APP_WALL_HUB:-https://axhub.amberxai.com}" > "$SRVENV"); chmod 600 "$SRVENV"
COMMON=(-d --name "$NAME" --restart unless-stopped -v "$STATE/data":/data --env-file "$SRVENV" --env-file "$AIENV")
# Molly (Oct 28 2026): AmberX's developer commands reach the console's Molly over Coolify's network with the console
# token, copied from the console's env file into this 0600 env file (the container runs as uid 1000 and can't read the
# console's file; the token never goes on a command line). A token reset is picked up on the next install / update run.
CONSOLE_ENV="${APP_CONSOLE_ENV:-$AXF_DIR/.axf-console/env}"
CONSOLE_TOKEN="$(grep -E '^AXF_TOKEN=' "$CONSOLE_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' ")"
if [ -n "$CONSOLE_TOKEN" ]; then
  (umask 077; printf 'AMBERX_CONSOLE_TOKEN=%s\nAMBERX_CONSOLE_URL=%s\n' "$CONSOLE_TOKEN" "${APP_CONSOLE_URL:-http://axf-console:7090}" >> "$SRVENV"); chmod 600 "$SRVENV"
  say "Molly: connected to the console's token"
else
  say "Molly: no console token in $CONSOLE_ENV yet, so developer commands say Molly isn't connected (install the console, then re-run this)"
fi
unset CONSOLE_TOKEN

if axf_coolify_proxy_running; then
  NET="$(axf_coolify_network)"
  # Its own router name: "amberxweb" (from amberx-web) is also used by the older amberx-app's web container, and
  # Traefik drops a router defined twice with different settings, so neither site was reachable (Oct 26 2026).
  R="${ROUTER:-amberxdroid}"
  # ---- 3. the wall (axHub sign-in): hub admins by default (APP_WALL_USERS=on: every signed-in hub user) ----
  WALLF="$STATE/wall"
  axf_save_choice "$WALLF" "${APP_WALL:-}"
  WALL_HUB="${APP_WALL_HUB:-https://axhub.amberxai.com}"
  # On the hub's host: only the app's page paths, above the hub's catch-all router; signed-in hub users get the page.
  if [ "https://$DOMAIN" = "$WALL_HUB" ]; then
    export AXF_ROUTER_PATHS="${APP_PATHS:-Path(\`/\`) || Path(\`/index.html\`) || PathPrefix(\`/assets/\`)}"
    export AXF_ROUTER_PRIORITY="${APP_PRIORITY:-1000}"
    USER_PATHS="${APP_USER_PATHS-/}"
  else
    axf_save_choice "$STATE/wall-users" "${APP_WALL_USERS:-}"
    [ "$(cat "$STATE/wall-users" 2>/dev/null || echo off)" = "on" ] && USER_PATHS="/" || USER_PATHS="${APP_USER_PATHS:-}"
  fi
  WALL="$(axf_wall_mode "$WALLF" "$WALL_HUB")"
  WALL_ARGS=()
  if [ "$WALL" = "off" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall OFF (APP_WALL=on bash $APP/deploy/install.sh turns it back on). The pages still need a hub session to show anything."
  elif [ "$WALL" = "on" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall ON (${USER_PATHS:+signed-in hub users}${USER_PATHS:-hub admins only}). Rollback: bash $APP/deploy/install.sh --remove"
    # One wall secret per hub (AXHUB_WALL_SECRET on the axHub app): reuse the Dev Console's when it has one.
    WSECF="${APP_WALL_SECRET_FILE:-$AXF_DIR/.axf-console/wall-secret}"
    [ -s "$WSECF" ] || WSECF="$STATE/wall-secret"
    [ "$(axf_wall_secret "$WSECF" "${APP_WALL_SECRET:-}")" = created ] && say "  made a wall secret: put it on the axHub app in Coolify as AXHUB_WALL_SECRET (view it with: cat $WSECF)"
    (umask 077; printf 'AMBERX_TRUST_WALL=1\nAMBERX_WALL_SECRET=%s\n' "$(cat "$WSECF")" >> "$SRVENV"); chmod 600 "$SRVENV"
    axf_wall_labels WALL_ARGS "$R" "$(axf_wall_verify_url "$WALL_HUB" "$USER_PATHS")"
  else
    touch "$STATE/wall-waiting"
    say "Sign-in wall waiting: $WALL_HUB can't sign anyone in yet; the 5-minute update turns it on"
  fi
  axf_coolify_run "$R" "$DOMAIN" "$PORT" "$NET" "$NAME:latest" "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}"
  URL="https://$DOMAIN"
else
  say "No Coolify proxy — exposing port 7491 on localhost only (put HTTPS in front before using it remotely; the API answers no one until the wall is on)"
  docker run "${COMMON[@]}" -p "127.0.0.1:7491:$PORT" "$NAME:latest" >/dev/null
  URL="http://127.0.0.1:7491"
fi

# ---- 4. auto-update ----
# shellcheck disable=SC2016  # the fetch command is written into the update script as is
AXF_UPDATE_PRELUDE="T=\$(sed -n 's/^GITHUB_TOKEN=//p' \"$AXF_DIR/.axf-console/env\" \"$AXF_DIR/.axf-console/secrets.env\" 2>/dev/null | head -n1)
H=(); [ -n \"\$T\" ] && H=(-c \"http.https://github.com/.extraheader=AUTHORIZATION: basic \$(printf 'x-access-token:%s' \"\$T\" | base64 -w0)\")" \
AXF_UPDATE_FETCH='git "${H[@]}"' \
  axf_update_script "/usr/local/bin/$NAME-update" "$DIR" "$BRANCH" "/var/log/$NAME-update.log" \
  "DOMAIN=\"$DOMAIN\" NAME=\"$NAME\" DIR=\"$DIR\" SUB=\"$SUB\" AXF_DIR=\"$AXF_DIR\" bash \"$APP/deploy/install.sh\"" \
  "$STATE/update-status.json" "$STATE/wall-waiting"
axf_cron_file "$NAME" "*/5 * * * * root flock -n /run/$NAME-update.lock /usr/local/bin/$NAME-update"

say "AmberX web app:  $URL"
