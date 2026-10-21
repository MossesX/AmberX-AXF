# Deploy helpers — `axf-deploy@1`

One copy of what every AXF server app on the VPS (Hostinger, Coolify, Traefik, axHub) repeats in its installer.
`axf-deploy.sh` defines bash functions only (no options set, nothing runs on source) and is safe under
`set -euo pipefail`. Harvested Oct 21 2026 from `deploy/install-console.sh` and Build Pilot's `deploy/install.sh`.

Used by: `deploy/install-console.sh` (the Dev Console), the `web-fastapi-wall` app template (baked into the app as
`src/axf/deploy/axf-deploy.sh`, sourced by its `deploy/install.sh`). Build Pilot: see "Adopting it" below.

| Function | What it does |
| --- | --- |
| `axf_coolify_proxy_running` | 0 when `coolify-proxy` runs |
| `axf_coolify_network` | the proxy's Docker network (`coolify` when it's on it, else its first) |
| `axf_stop_container NAME` | `docker stop -t 15` (clean shutdown), then `rm -f` |
| `axf_router_labels ARR ROUTER DOMAIN PORT NET` | appends Traefik labels: enable, network, http→https redirect router, https router (letsencrypt), service port |
| `axf_https_redirect_labels ARR ROUTER DOMAIN` | just the http→https router |
| `axf_coolify_run ROUTER DOMAIN PORT NET IMAGE args…` | `docker run args… <router labels> IMAGE` (quiet) |
| `axf_save_choice FILE VALUE` | saves an installer switch (e.g. `AXF_WALL=off`) 0600; empty keeps the saved one |
| `axf_hub_can_sign_in HUB` | 0 when the hub's login page has a form and at least one account |
| `axf_wall_mode FILE HUB` | `off`, `on`, or waiting; saves `on` the first time the hub can sign someone in (then stays on) |
| `axf_wall_secret FILE [VALUE]` | ensures the 0600 shared wall secret (32 random bytes hex); prints `created` when new |
| `axf_wall_plugin_user_paths DIR` | `user_paths` for plugin@1 plugins with `"wallUsers": true` (`_` folders skipped) |
| `axf_wall_join_paths P…` | joins paths with `%2C` (kept out of Traefik's label list syntax) |
| `axf_wall_verify_url HUB [PATHS]` | `HUB/auth/verify[?user_paths=…]` (no paths = admins only, `/` = every signed-in user) |
| `axf_wall_labels ARR ROUTER VERIFY_URL` | strip middleware for all five `X-Auth-*` headers, forwardAuth to the hub, router chain strip → wall |
| `axf_update_script PATH DIR BRANCH LOG CMD [STATUS] [MARKER…]` | root-only (0700) auto-update script: pull, re-run CMD when HEAD moved or a marker exists; optional activity@1 status JSON. `AXF_UPDATE_PRELUDE` / `AXF_UPDATE_FETCH` for private repos |
| `axf_cron_file NAME LINE…` | `/etc/cron.d/NAME` (0644) |

Array functions take the **name** of a bash array and append to it (nameref), so arguments are never word-split.

## Security rules kept from both copies

- The strip middleware runs **before** forwardAuth, so a client can never send its own `X-Auth-*`; the app still trusts
  those headers only with the hub's HMAC signature (`X-Auth-Sig`, 120 s, this host) and `*_TRUST_WALL=1`.
- The wall turns itself on only once the hub can sign someone in, and stays on (saved): a hub outage closes the app.
- Secret and switch files are written 0600 from the start (umask 077). The update script is 0700: it may carry a token.

## A whole installer

```bash
. "$DIR/src/axf/deploy/axf-deploy.sh"           # or framework/deploy/axf-deploy.sh inside this repo
axf_stop_container "$NAME"
COMMON=(-d --name "$NAME" --restart unless-stopped -e APP_TOKEN="$APP_TOKEN" -e PORT="$PORT")
if axf_coolify_proxy_running; then
  NET="$(axf_coolify_network)"; R=myapp; WALL_ARGS=()
  axf_save_choice "$STATE/wall" "${APP_WALL:-}"
  if [ "$(axf_wall_mode "$STATE/wall" "$HUB")" = on ]; then
    axf_wall_secret "$STATE/wall-secret" >/dev/null
    WALL_ARGS=(-e APP_TRUST_WALL=1 -e "APP_WALL_SECRET=$(cat "$STATE/wall-secret")")
    axf_wall_labels WALL_ARGS "$R" "$(axf_wall_verify_url "$HUB")"
  fi
  axf_coolify_run "$R" "$DOMAIN" "$PORT" "$NET" "$NAME:latest" "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}"
fi
axf_update_script "/usr/local/bin/$NAME-update" "$DIR" main "/var/log/$NAME-update.log" "bash \"$DIR/deploy/install.sh\""
axf_cron_file "$NAME" "*/5 * * * * root /usr/local/bin/$NAME-update"
```

The full example is `framework/templates/web-fastapi-wall/deploy/install.sh`.

## Tests

- `bash framework/deploy/test.sh` — self-test (exact labels, wall modes, secret, update script run against a scratch
  git repo); `shellcheck -x framework/deploy/*.sh` (`pip install shellcheck-py`). Both run in CI (android.yml, engine job).
- `sudo bash deploy/dryrun/compare.sh [ref]` — runs `deploy/install-console.sh` at `ref` and as it is now against fake
  docker/git/curl in a private mount namespace (11 scenarios) and diffs every `docker` argument, the output and the
  files under `.axf-console`. Run it before changing the console installer or these helpers.

## Adopting it in Build Pilot (separate repo; steps, not done here)

1. Bake the file: `cp ../amberx-axf/framework/deploy/axf-deploy.sh deploy/axf-deploy.sh` (or extend
   `scripts/bake-contracts.mjs` to copy it and record its hash in `axf-contracts.lock.json`).
2. In `deploy/install.sh` after the clone: `. "$DIR/deploy/axf-deploy.sh"`.
3. Replace lines 92-93 with `axf_stop_container "$NAME"`; 117-119 with `if axf_coolify_proxy_running; then NET="$(axf_coolify_network)"`.
4. Wall (124-161): `axf_save_choice "$WALLF" "${BP_WALL:-}"`, `WALL="$(axf_wall_mode "$WALLF" "$WALL_HUB")"`, keep its
   own "reuse the console's wall secret, never create one" rule, then
   `axf_wall_labels WALL_ARGS "$R" "$(axf_wall_verify_url "$WALL_HUB")"` (admins only: no user_paths).
5. Run (163-170): `axf_coolify_run "$R" "$DOMAIN" "$PORT" "$NET" "$NAME:latest" "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}"`.
6. Update script (179-195): `AXF_UPDATE_PRELUDE` = its two token lines, `AXF_UPDATE_FETCH='git "${H[@]}"'`,
   markers `"$STATE/wall-waiting" "$STATE/data/rebuild-requested"`, then `axf_cron_file build-pilot` with its two lines
   (the 5-minute flock one and the per-minute rebuild one). Note the script becomes 0700 (was 0755).
7. Diff `docker run` arguments before/after with a copy of `deploy/dryrun/` pointed at Build Pilot's installer.
