#!/usr/bin/env bash
# Self-test for framework/deploy/axf-deploy.sh (CI: bash framework/deploy/test.sh). No root, Docker or network:
# docker, curl and openssl are shell functions here. Checks the exact labels (byte for byte against the strings the
# console's installer used before it switched to these helpers), the wall modes, the secret file, the generated
# update script and that everything works under `set -euo pipefail`.
# shellcheck disable=SC2015,SC2016,SC2054,SC2317  # test idioms: `cond && ok || fail`, literal $… / commas in expected text, fakes called indirectly
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=framework/deploy/axf-deploy.sh
. "$HERE/axf-deploy.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0
ok() { pass=$((pass + 1)); }
fail() { echo "FAIL: $*" >&2; exit 1; }
eq() { [ "$1" = "$2" ] || fail "$3: got [$1] want [$2]"; ok; }

# ---- fakes
HUB_PAGE=ready
curl() { case "$HUB_PAGE" in ready) echo '<form action="/auth/login">';; empty) echo '<form action="/auth/login">No accounts yet';; *) return 7;; esac; }
docker() {
  printf '%s\n' "$@" > "$T/docker.args"
  case "$1" in
    ps) echo other; echo coolify-proxy;;
    inspect) case "$*" in *'{{$k}} {{end}}'*) echo "bridge coolify ";; *) printf 'bridge\ncoolify\n';; esac;;
  esac
}
openssl() { echo "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; }

# ---- Coolify
axf_coolify_proxy_running && ok || fail "proxy detection"
eq "$(axf_coolify_network)" coolify "network: picks coolify"
docker() { case "$*" in *'{{$k}} {{end}}'*) echo "net-a net-b ";; *) printf 'net-a\nnet-b\n';; esac; }
eq "$(axf_coolify_network)" net-a "network: falls back to the first"
docker() { printf '%s\n' "$@" > "$T/docker.args"; }

# ---- router labels (exact strings from install-console.sh before Oct 21 2026)
A=(-d --name app)
axf_router_labels A rr app.example.com 7000 coolify
want=(-d --name app -l traefik.enable=true -l traefik.docker.network=coolify
  -l 'traefik.http.routers.rr-http.rule=Host(`app.example.com`)' -l traefik.http.routers.rr-http.entrypoints=http
  -l traefik.http.routers.rr-http.middlewares=rr-https -l traefik.http.middlewares.rr-https.redirectscheme.scheme=https
  -l 'traefik.http.routers.rr.rule=Host(`app.example.com`)' -l traefik.http.routers.rr.entrypoints=https
  -l traefik.http.routers.rr.tls=true -l traefik.http.routers.rr.tls.certresolver=letsencrypt
  -l traefik.http.services.rr.loadbalancer.server.port=7000)
eq "$(printf '%s\n' "${A[@]}")" "$(printf '%s\n' "${want[@]}")" "router labels"

# ---- wall labels: strip all five headers first, then forwardAuth, chain strip → wall
W=(-e X=1)
axf_wall_labels W rr "$(axf_wall_verify_url https://hub.example "$(axf_wall_join_paths /api/plugins/a/ /api/plugins/b/)")"
wantw=(-e X=1
  -l traefik.http.middlewares.rr-strip.headers.customrequestheaders.X-Auth-User=
  -l traefik.http.middlewares.rr-strip.headers.customrequestheaders.X-Auth-Role=
  -l traefik.http.middlewares.rr-strip.headers.customrequestheaders.X-Auth-Perms=
  -l traefik.http.middlewares.rr-strip.headers.customrequestheaders.X-Auth-Via=
  -l traefik.http.middlewares.rr-strip.headers.customrequestheaders.X-Auth-Sig=
  -l 'traefik.http.middlewares.rr-wall.forwardauth.address=https://hub.example/auth/verify?user_paths=/api/plugins/a/%2C/api/plugins/b/'
  -l traefik.http.middlewares.rr-wall.forwardauth.authResponseHeaders=X-Auth-User,X-Auth-Role,X-Auth-Perms,X-Auth-Via,X-Auth-Sig
  -l traefik.http.routers.rr.middlewares=rr-strip,rr-wall)
eq "$(printf '%s\n' "${W[@]}")" "$(printf '%s\n' "${wantw[@]}")" "wall labels"
eq "$(axf_wall_verify_url https://hub.example)" "https://hub.example/auth/verify" "admins only: no user_paths"
eq "$(axf_wall_verify_url https://hub.example /)" "https://hub.example/auth/verify?user_paths=/" "every user"
eq "$(axf_wall_join_paths)" "" "no paths"

# ---- plugins that say wallUsers: true ("_" folders never count)
mkdir -p "$T/p/open" "$T/p/closed" "$T/p/_tpl" "$T/p/also"
echo '{"wallUsers" : true}' > "$T/p/open/plugin.json"; echo '{"wallUsers": false}' > "$T/p/closed/plugin.json"
echo '{"wallUsers": true}' > "$T/p/_tpl/plugin.json"; echo '{"wallUsers":true}' > "$T/p/also/plugin.json"
eq "$(axf_wall_plugin_user_paths "$T/p")" "/api/plugins/also/%2C/api/plugins/open/" "wallUsers plugins"
eq "$(axf_wall_plugin_user_paths "$T/missing")" "" "no plugins folder"

# ---- coolify run: the container's args, then the router labels, then the image
axf_coolify_run rr app.example.com 7000 coolify img:latest -d --name app --network coolify "${W[@]:0:2}"
eq "$(head -n 8 "$T/docker.args" | tr "\n" " ")" "run -d --name app --network coolify -e X=1 " "run: args first"
eq "$(tail -n 1 "$T/docker.args")" "img:latest" "run: image last"
grep -qx 'traefik.http.services.rr.loadbalancer.server.port=7000' "$T/docker.args" && ok || fail "run: router labels"

# ---- wall mode + saved choices
F="$T/wall"
HUB_PAGE=empty; eq "$(axf_wall_mode "$F" https://hub)" auto "hub without accounts: waits"
[ ! -e "$F" ] && ok || fail "nothing saved while waiting"
HUB_PAGE=ready; eq "$(axf_wall_mode "$F" https://hub)" on "hub ready: on"
eq "$(cat "$F")" on "on is saved"; eq "$(stat -c %a "$F")" 600 "choice file 0600"
HUB_PAGE=down; eq "$(axf_wall_mode "$F" https://hub)" on "stays on when the hub is down"
axf_save_choice "$F" off; HUB_PAGE=ready; eq "$(axf_wall_mode "$F" https://hub)" off "off wins over a ready hub"
axf_save_choice "$F" ""; eq "$(cat "$F")" off "empty value keeps the saved choice"

# ---- wall secret
S="$T/secret"
eq "$(axf_wall_secret "$S")" created "new secret"
eq "$(cat "$S")" 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef "secret content"
eq "$(stat -c %a "$S")" 600 "secret 0600"
eq "$(axf_wall_secret "$S")" "" "kept when present"
axf_wall_secret "$S" given >/dev/null; eq "$(cat "$S")" given "replaced by a given value"
openssl() { return 1; }; rm -f "$S"; axf_wall_secret "$S" >/dev/null
[ "$(wc -c < "$S")" -eq 64 ] && ok || fail "fallback secret is 64 hex chars"
eq "$(stat -c %a "$S")" 600 "fallback secret 0600"

# ---- update script
U="$T/update"
axf_update_script "$U" /opt/app main /var/log/app.log 'DOMAIN="x" bash "/opt/app/deploy/install.sh"' /opt/app/.state/update.json /opt/app/.state/wall-waiting /opt/app/.state/rebuild
bash -n "$U" && ok || fail "update script syntax"
eq "$(stat -c %a "$U")" 700 "update script root-only"
grep -qF '[ "$before" = "$(git rev-parse HEAD)" ] && [ ! -f "/opt/app/.state/wall-waiting" ] && [ ! -f "/opt/app/.state/rebuild" ] && exit 0' "$U" && ok || fail "re-run markers"
grep -qF 'DOMAIN="x" bash "/opt/app/deploy/install.sh" >> /var/log/app.log 2>&1 || state=failed' "$U" && ok || fail "command + status"
[ "$(head -n 4 "$U" | tail -n 1)" = "{" ] && [ "$(tail -n 1 "$U")" = "}" ] && ok || fail "one block"
AXF_UPDATE_PRELUDE='H=(-c x)' AXF_UPDATE_FETCH='git "${H[@]}"' axf_update_script "$U" /opt/app main /var/log/app.log 'bash x'
bash -n "$U" && ok || fail "plain update script syntax"
grep -qF 'git "${H[@]}" fetch -q origin main' "$U" && grep -qxF 'H=(-c x)' "$U" && ok || fail "prelude + fetch command"
! grep -q state= "$U" && ok || fail "no status lines without a status file"

# ---- runs the generated script for real against a scratch git repo (unchanged → exits without running the command)
if command -v git >/dev/null; then
  unset -f docker curl openssl
  R="$T/repo"; git init -q -b main "$R"; git -C "$R" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
  git clone -q "$R" "$T/clone"
  axf_update_script "$U" "$T/clone" main "$T/log" "touch $T/ran" "$T/st.json"
  bash "$U"; [ ! -e "$T/ran" ] && ok || fail "unchanged: command not run"
  git -C "$R" -c user.email=t@t -c user.name=t commit -q --allow-empty -m two
  bash "$U"; [ -e "$T/ran" ] && grep -q '"state":"done"' "$T/st.json" && ok || fail "changed: command run, status done"
  git -C "$R" -c user.email=t@t -c user.name=t commit -q --allow-empty -m three
  axf_update_script "$U" "$T/clone" main "$T/log" "false" "$T/st.json"
  ! bash "$U" && grep -q '"state":"failed"' "$T/st.json" && ok || fail "failed command: status failed, non-zero exit"
fi

echo "axf-deploy self-test: $pass checks passed"
