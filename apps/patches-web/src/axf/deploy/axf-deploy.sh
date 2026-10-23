#!/usr/bin/env bash
# shellcheck disable=SC2016  # axf_update_script writes literal $… text into the script it generates
# AmberX AXF deploy helpers (axf-deploy@1): one copy of the pieces every AXF server app on Brett's VPS repeats.
# Source it from an installer (`set -euo pipefail` safe; defines functions only, runs nothing, sets no options):
#
#   . "$DIR/framework/deploy/axf-deploy.sh"      # or the copy an app ships (the web-fastapi-wall template does)
#
# What it covers (see framework/deploy/README.md for a whole installer):
#   - Coolify: is its Traefik proxy running, which Docker network it is on, stop/remove a container cleanly,
#     the `docker run` pattern on that network (HTTPS router + http→https redirect + service port labels)
#   - axHub's sign-in wall (axHub decision #77): Traefik labels that strip client-sent X-Auth-* headers and forwardAuth
#     every request to the hub (`/auth/verify?user_paths=…`), the saved on/off/auto choice, the "can the hub sign
#     someone in yet" probe, and the shared wall secret file (0600; copy it to the axHub app as AXHUB_WALL_SECRET)
#   - the auto-update script + cron file (pull a branch every 5 minutes, re-run the installer when it changed)
#
# Functions that build `docker run` arguments append to a bash array named by their first argument (nameref), so
# arguments are never word-split. All private locals start with `_axf` so they never shadow the caller's array.
#
# Security notes (kept from the copies this came from: deploy/install-console.sh and Build Pilot's deploy/install.sh):
#   - the strip middleware runs before forwardAuth, so a client can never send its own X-Auth-User/Role/Perms/Via/Sig;
#     the app still trusts those headers only when they carry the hub's signature (X-Auth-Sig, HMAC with the secret)
#   - the wall switches itself on only once the hub really can sign someone in (never locks you out on a fresh hub),
#     and once on it stays on (saved), so a hub outage closes the app instead of opening it
#   - secret and choice files are written 0600 from the start (umask 077), and re-chmodded if they already existed

# Bump when a function's behaviour or signature changes (apps that copy this file can check it).
# shellcheck disable=SC2034  # read by apps that source or copy this file
AXF_DEPLOY_VERSION="1"

# ---------------------------------------------------------------------------------------------------- Coolify

# axf_coolify_proxy_running → 0 when Coolify's Traefik container (coolify-proxy) is running.
axf_coolify_proxy_running() {
  docker ps --format '{{.Names}}' | grep -qx coolify-proxy
}

# axf_coolify_network → prints the Docker network Coolify's proxy is on ("coolify" when it is on that one, else its first).
axf_coolify_network() {
  local _axf_net
  _axf_net="$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | tr ' ' '\n' | grep -x coolify || true)"
  _axf_net="${_axf_net:-$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -n1)}"
  printf '%s\n' "$_axf_net"
}

# axf_stop_container NAME → clean shutdown first (15 s, so the app can tell a stop from a crash), then remove it.
axf_stop_container() {
  docker stop -t 15 "$1" >/dev/null 2>&1 || true
  docker rm -f "$1" >/dev/null 2>&1 || true
}

# axf_https_redirect_labels ARRAY ROUTER DOMAIN → appends the plain-http router that redirects to https.
axf_https_redirect_labels() {
  local -n _axf_out="$1"
  local _axf_r="$2" _axf_domain="$3"
  _axf_out+=(-l "traefik.http.routers.$_axf_r-http.rule=Host(\`$_axf_domain\`)" -l "traefik.http.routers.$_axf_r-http.entrypoints=http"
    -l "traefik.http.routers.$_axf_r-http.middlewares=$_axf_r-https" -l "traefik.http.middlewares.$_axf_r-https.redirectscheme.scheme=https")
}

# axf_router_labels ARRAY ROUTER DOMAIN PORT NETWORK → appends Traefik's labels for https://DOMAIN → container PORT:
# enable + network, the http→https redirect router, the https router (letsencrypt) and the service port.
axf_router_labels() {
  local -n _axf_rl="$1"
  local _axf_r="$2" _axf_domain="$3" _axf_port="$4" _axf_net="$5"
  _axf_rl+=(-l traefik.enable=true -l "traefik.docker.network=$_axf_net")
  axf_https_redirect_labels "$1" "$_axf_r" "$_axf_domain"
  _axf_rl+=(-l "traefik.http.routers.$_axf_r.rule=Host(\`$_axf_domain\`)" -l "traefik.http.routers.$_axf_r.entrypoints=https"
    -l "traefik.http.routers.$_axf_r.tls=true" -l "traefik.http.routers.$_axf_r.tls.certresolver=letsencrypt"
    -l "traefik.http.services.$_axf_r.loadbalancer.server.port=$_axf_port")
}

# axf_coolify_run ROUTER DOMAIN PORT NETWORK IMAGE [docker run args…]
#   = docker run <args…> <router labels> IMAGE, quietly. Pass the container's own args (-d --name … -e …), then
#   `--network NETWORK`, then any wall labels, in that order. Returns docker's status.
axf_coolify_run() {
  local _axf_r="$1" _axf_domain="$2" _axf_port="$3" _axf_net="$4" _axf_image="$5"
  shift 5
  local -a _axf_args=("$@")
  axf_router_labels _axf_args "$_axf_r" "$_axf_domain" "$_axf_port" "$_axf_net"
  docker run "${_axf_args[@]}" "$_axf_image" >/dev/null
}

# ---------------------------------------------------------------------------------------------------- the wall

# Headers axHub's /auth/verify answers with (and the only ones the app may trust, when signed).
AXF_WALL_HEADERS="X-Auth-User,X-Auth-Role,X-Auth-Perms,X-Auth-Via,X-Auth-Sig"

# axf_save_choice FILE VALUE → saves VALUE (a remembered installer switch such as AXF_WALL=off) 0600; empty = keep.
axf_save_choice() {
  [ -n "${2:-}" ] || return 0
  (umask 077; printf '%s\n' "$2" > "$1")
  chmod 600 "$1"
}

# axf_hub_can_sign_in HUB → 0 when HUB's login page has a form and at least one account (so walling can't lock out).
axf_hub_can_sign_in() {
  local _axf_login
  _axf_login="$(curl -fsS --max-time 10 "$1/auth/login" 2>/dev/null || true)"
  echo "$_axf_login" | grep -q 'action="/auth/login"' && ! echo "$_axf_login" | grep -q 'No accounts yet'
}

# axf_wall_mode FILE HUB → prints the wall mode: "off", "on", or anything else = waiting for the hub.
# Nothing saved = "auto". While not on, probes the hub; the first time it can sign someone in, "on" is saved for good.
axf_wall_mode() {
  local _axf_mode
  _axf_mode="$(cat "$1" 2>/dev/null || echo auto)"
  if [ "$_axf_mode" != "off" ] && [ "$_axf_mode" != "on" ] && axf_hub_can_sign_in "$2"; then
    _axf_mode=on
    axf_save_choice "$1" on
  fi
  printf '%s\n' "$_axf_mode"
}

# axf_wall_secret FILE [VALUE] → makes sure FILE holds the wall secret (0600). VALUE replaces it when given; an empty
# file gets 32 random bytes as hex. Prints "created" when it made a new one (the caller tells Brett to copy it to the
# axHub app as AXHUB_WALL_SECRET). Read it back with: "$(cat FILE)".
axf_wall_secret() {
  if [ -n "${2:-}" ]; then (umask 077; printf '%s' "$2" > "$1"); chmod 600 "$1"; fi
  if [ ! -s "$1" ]; then
    (umask 077; openssl rand -hex 32 2>/dev/null > "$1" || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$1")
    chmod 600 "$1"
    echo created
  fi
}

# axf_wall_join_paths PATH… → the paths joined for the user_paths query (%2C = ",", kept out of Traefik's label lists).
axf_wall_join_paths() {
  local _axf_p _axf_s=""
  for _axf_p in "$@"; do [ -n "$_axf_p" ] && _axf_s="$_axf_s$_axf_p%2C"; done
  printf '%s\n' "${_axf_s%\%2C}"
}

# axf_wall_plugin_user_paths PLUGINS_DIR → user_paths for plugin@1 plugins whose plugin.json says "wallUsers": true
# (open to every signed-in hub user; the plugin limits them): /api/plugins/<folder>/ each. "_" folders never count.
axf_wall_plugin_user_paths() {
  (cd "$1" 2>/dev/null && for f in */plugin.json; do
    d="${f%/plugin.json}"; case "$d" in _*) continue;; esac
    if grep -Eq '"wallUsers"[[:space:]]*:[[:space:]]*true' "$f"; then printf '/api/plugins/%s/%%2C' "$d"; fi; done; true) | sed 's/%2C$//'
}

# axf_wall_verify_url HUB [USER_PATHS] → the forwardAuth address. Without user_paths the hub lets only admins through;
# user_paths=/ lets every signed-in user reach the app (the app then decides per user, default-deny).
axf_wall_verify_url() {
  printf '%s\n' "$1/auth/verify${2:+?user_paths=$2}"
}

# axf_wall_labels ARRAY ROUTER VERIFY_URL → appends the wall: a headers middleware ROUTER-strip that blanks every
# X-Auth-* header a client sent, a forwardAuth middleware ROUTER-wall to VERIFY_URL that copies the hub's answer
# headers in, and ROUTER's middleware chain strip → wall (order matters: strip first).
axf_wall_labels() {
  local -n _axf_wl="$1"
  local _axf_r="$2" _axf_addr="$3" _axf_h
  local -a _axf_hs
  IFS=, read -ra _axf_hs <<< "$AXF_WALL_HEADERS"
  for _axf_h in "${_axf_hs[@]}"; do
    _axf_wl+=(-l "traefik.http.middlewares.$_axf_r-strip.headers.customrequestheaders.$_axf_h=")
  done
  _axf_wl+=(-l "traefik.http.middlewares.$_axf_r-wall.forwardauth.address=$_axf_addr"
    -l "traefik.http.middlewares.$_axf_r-wall.forwardauth.authResponseHeaders=$AXF_WALL_HEADERS"
    -l "traefik.http.routers.$_axf_r.middlewares=$_axf_r-strip,$_axf_r-wall")
}

# ---------------------------------------------------------------------------------------------------- auto-update

# axf_update_script PATH DIR BRANCH LOG COMMAND [STATUS_FILE] [RERUN_MARKER…]
# Writes the auto-update script (root only, 0700): pull BRANCH in DIR; when HEAD moved, or any RERUN_MARKER file
# exists (e.g. "the wall is waiting for the hub"), run COMMAND (a shell command line, embedded as given, usually
# `VAR="…" bash "$DIR/deploy/install.sh"`) with its output appended to LOG. With STATUS_FILE it also writes
# activity@1-style progress JSON there ({"state":"building"|"done"|"failed","from","to","startedAt","finishedAt"};
# no secrets). The whole script is one { … } block, so bash has read all of it before COMMAND rewrites the file.
# Optional, read when called: AXF_UPDATE_FETCH = the git command used for the fetch (default `git`; e.g. a private repo:
# `git "${H[@]}"`), AXF_UPDATE_PRELUDE = shell lines run right after `cd DIR` (e.g. building that H array).
# The script is root-only (0700): COMMAND may carry a token the installer passes on to itself.
axf_update_script() {
  local _axf_path="$1" _axf_dir="$2" _axf_branch="$3" _axf_log="$4" _axf_cmd="$5" _axf_st="${6:-}"
  shift 5; [ "$#" -gt 0 ] && shift
  local _axf_cond='[ "$before" = "$(git rev-parse HEAD)" ]' _axf_m
  for _axf_m in "$@"; do _axf_cond="$_axf_cond && [ ! -f \"$_axf_m\" ]"; done
  {
    printf '%s\n' '#!/usr/bin/env bash' \
      '# Written by framework/deploy/axf-deploy.sh (axf_update_script). One block, so bash reads it all before running:' \
      '# the installer rewrites this file while it runs.' \
      '{' 'set -e' "cd \"$_axf_dir\""
    [ -n "${AXF_UPDATE_PRELUDE:-}" ] && printf '%s\n' "$AXF_UPDATE_PRELUDE"
    printf '%s\n' \
      "before=\$(git rev-parse HEAD); ${AXF_UPDATE_FETCH:-git} fetch -q origin $_axf_branch && git reset -q --hard origin/$_axf_branch" \
      "$_axf_cond && exit 0  # unchanged (and no marker asks for a re-run)"
    if [ -n "$_axf_st" ]; then
      printf '%s\n' '# Progress for the app'"'"'s Activity banner (activity@1, source "update"). No secrets in it.' \
        "st=\"$_axf_st\"; after=\$(git rev-parse HEAD); t0=\$(date +%s)" \
        "printf '{\"state\":\"building\",\"from\":\"%s\",\"to\":\"%s\",\"startedAt\":%s}\\n' \"\$before\" \"\$after\" \"\$t0\" > \"\$st.tmp\" && mv -f \"\$st.tmp\" \"\$st\"" \
        'state=done' \
        "$_axf_cmd >> $_axf_log 2>&1 || state=failed" \
        "printf '{\"state\":\"%s\",\"from\":\"%s\",\"to\":\"%s\",\"startedAt\":%s,\"finishedAt\":%s}\\n' \"\$state\" \"\$before\" \"\$after\" \"\$t0\" \"\$(date +%s)\" > \"\$st.tmp\" && mv -f \"\$st.tmp\" \"\$st\"" \
        '[ "$state" = done ]'
    else
      printf '%s\n' "$_axf_cmd >> $_axf_log 2>&1"
    fi
    printf '%s\n' 'exit' '}'
  } > "$_axf_path"
  chmod 700 "$_axf_path"
}

# axf_cron_file NAME LINE… → /etc/cron.d/NAME with one cron line per argument (0644, as cron requires).
# Example: axf_cron_file my-app "*/5 * * * * root /usr/local/bin/my-app-update"
axf_cron_file() {
  local _axf_name="$1"; shift
  printf '%s\n' "$@" > "/etc/cron.d/$_axf_name"
  chmod 644 "/etc/cron.d/$_axf_name"
}
