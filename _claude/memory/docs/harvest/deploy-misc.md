# Harvest Oct 20 2026 — group `deploy-misc` (Opus)

Branch `harvest/h-deploy-misc`. Plan rows #15 (deploy helpers + boilerplate) and #16 (`uac-policy/hub-accounts`),
plus the Build Pilot rebuild's docs/CI recommendations and the Build Pilot nav cleanup steps.

## What moved

| Item | From | To |
| --- | --- | --- |
| Coolify network detection, clean stop, `docker run` on the Coolify network with Traefik router + http→https labels | `deploy/install-console.sh` §4 (≈ Build Pilot `deploy/install.sh` 92-93, 117-119, 163-170) | `framework/deploy/axf-deploy.sh`: `axf_coolify_proxy_running`, `axf_coolify_network`, `axf_stop_container`, `axf_router_labels`, `axf_https_redirect_labels`, `axf_coolify_run` |
| axHub wall: saved on/off/auto, "hub can sign someone in" probe, user_paths from `wallUsers` plugins, verify URL, strip + forwardAuth labels | install-console.sh §6 (≈ BP 124-161) | `axf_save_choice`, `axf_hub_can_sign_in`, `axf_wall_mode`, `axf_wall_plugin_user_paths`, `axf_wall_join_paths`, `axf_wall_verify_url`, `axf_wall_labels` |
| Wall secret creation (0600) | install-console.sh §6 | `axf_wall_secret` |
| 5-minute auto-update script + cron | install-console.sh §5 (≈ BP 179-195) | `axf_update_script` (status JSON + re-run markers; `AXF_UPDATE_PRELUDE`/`AXF_UPDATE_FETCH` for private repos), `axf_cron_file` |
| "Web app + FastAPI behind the wall" starting point | the console + Build Pilot server/deploy patterns | new app template `framework/templates/web-fastapi-wall` |
| Hub-account access policy | `apps/console-web/src/assets/uac-policy/console-access.json` | starter `framework/assets/uac-policy/hub-accounts.json` (generalized) |

Template vs boilerplate: a boilerplate@1 only adds screens/modules/libraries on top of a template (Android-oriented
in practice), and a server + Dockerfile + installer is a different app shape, so this is a **template**
(`axf init <dir> --template web-fastapi-wall`). Swept in CI's engine job like every template.

## Who uses it now

- `deploy/install-console.sh` sources `framework/deploy/axf-deploy.sh` (from the clone it just updated).
- `web-fastapi-wall` bakes `framework/deploy` into the app (`src/axf/deploy`, hashed in `axf.lock.json`); its
  `deploy/install.sh` sources it.
- Build Pilot: not switched (read-only here). Steps in `framework/deploy/README.md` → "Adopting it in Build Pilot".

Nothing deleted: the console installer's inline copies were replaced by calls; Build Pilot keeps its own until adopted.

## Proof the console installer does the same thing on the VPS

`sudo bash deploy/dryrun/compare.sh HEAD` (committed) runs the installer as it was at the base commit and as it is now
against fake docker/git/curl/openssl/node in a private mount namespace (overlays on /etc, /usr/local/bin, /var/log;
nothing on the machine changes), and diffs every `docker` call argument by argument, the installer's output, every
file under `.axf-console` (content + mode) and the cron/update files. Scenarios: default (hub ready, wall turns on),
`AXF_WALL=off`, saved off, hub without accounts (waiting), hub down with wall saved on + existing secret,
`AXF_WALL_USERS=off`, saved users-off, `AXF_WALL_SECRET` given, axhub-projects volume present, no Coolify, new
tokens/domain on the command line. Also checked by hand: two `wallUsers` plugins (+ a `_` folder) → same
`user_paths=/api/plugins/a/%2C/api/plugins/b/`.

Result in **all 11 scenarios: docker calls identical, output identical, `.axf-console` files identical.** The only
difference is `/usr/local/bin/axf-console-update`:

```diff
-### /usr/local/bin/axf-console-update mode 755
+### /usr/local/bin/axf-console-update mode 700
 #!/usr/bin/env bash
-# One block, so bash reads it all before running: install-console.sh rewrites this file while it runs.
+# Written by framework/deploy/axf-deploy.sh (axf_update_script). One block, so bash reads it all before running:
+# the installer rewrites this file while it runs.
 {
 ...
-[ "$before" = "$(git rev-parse HEAD)" ] && [ ! -f ".../.axf-console/wall-waiting" ] && exit 0  # also re-run while the sign-in wall waits for the hub
-# The console's Activity banner reads this while the update runs (activity@1, source "update"). No secrets in it.
+[ "$before" = "$(git rev-parse HEAD)" ] && [ ! -f ".../.axf-console/wall-waiting" ] && exit 0  # unchanged (and no marker asks for a re-run)
+# Progress for the app's Activity banner (activity@1, source "update"). No secrets in it.
```

Explained: comment text only, plus mode 755 → **700** (tightened on purpose: the script embeds `GITHUB_TOKEN` for the
re-run and only root's cron runs it; `console-doctor.sh` checks the cron file, not this script's mode; `forensics.sh`
only reads it as root). Every command line is byte-identical. Same labels, env names (`AXF_TRUST_WALL`,
`AXF_WALL_SECRET`, `AXF_WALL_HUB`), markers and files (`wall`, `wall-users`, `wall-secret`, `wall-waiting`,
`update-status.json`, `env`).

## Guards kept or tightened

- Strip middleware for all five `X-Auth-*` headers before forwardAuth (both copies had all five).
- Wall turns on only when the hub can sign someone in, then stays on (both copies).
- Choice files 0600. **Stricter where the copies differed:** the console wrote `wall`/`wall-users` with `echo` then
  `chmod 600` (briefly world-readable under a 022 umask); `axf_save_choice` writes them under umask 077. Same final mode.
- Wall secret: written under umask 077 (both), now also re-`chmod 600` when replaced from `AXF_WALL_SECRET` (same as before).
- Update script 0700 (was 0755 in both copies).
- Build Pilot's "never create a wall secret, reuse the console's" rule is a caller choice; the template follows it
  (reuses the console's file when present, else makes its own).
- Template server: same signature rules as the console's `server/wall.py` (HMAC-SHA256, 120 s, host-bound, name/perm
  patterns, admin ⇒ `*`), malformed session ⇒ 403 never anonymous, bearer-via-hub must be the real token,
  same-origin browser writes, default-deny for hub users, static-file path guard.

## Contracts, fixtures, assets

- New starter `uac-policy/hub-accounts` (roles admin `*`, themes `assets.swap`+`assets.import`, user none; defaultRole
  user, gating disable, `roll: false`). Permission names are the framework's standard six (no console-only names);
  the hub permission that maps to `themes` is per app (`<app>.themes`, e.g. `console.themes`) and lives in the server,
  not the asset. `framework/defaults.json` unchanged (`standard`), so every existing app looks and behaves the same.
- `spec/fixtures/uac.json` gained the `hub-accounts` case only (generated; existing cases byte-identical). Kotlin
  `ConformanceTest` replays it from `framework/assets` (no Kotlin change; CI runs it).
- The console keeps `console-access` (identical roles + permission set, console wording): no behaviour change.
  Note in `apps/console-web/src/account.tsx` points at the starter.
- Engine: `copyTemplate` now substitutes `{{TOKENS}}` in `.sh`, `.py`, `.yml/.yaml` and `Dockerfile` and maps
  `_dockerignore` → `.dockerignore`. No existing template has such files, so their output is unchanged.

## Docs / CI

- `framework/spec/ASSISTANT.md`: Build Pilot host → **built** (own engine on the baked contract, routes `/api/assistant/*`).
- `framework/spec/check-addons.mts`: every `*.addon.json` and `addons/<id>/addon.json` in the repo passes
  `validateAddon` + `validateAgentItem` (shape), no duplicate ids, risks printed. Today: the agent manager's 3 bundled
  add-ons pass; Build Pilot's `pilot-assembler.addon.json` 2.1.0 also passes when copied in.
- android.yml engine job: `setup-python`; `bash -n` for `framework/deploy/*.sh`, the console installer and the
  template installer; `shellcheck -x framework/deploy/*.sh` (`shellcheck-py==0.10.0.1`); `bash framework/deploy/test.sh`;
  the add-on check; the template sweep now inits `web-fastapi-wall`, builds it, runs its server self-test and
  `bash -n` + shellcheck on its installer.
- Docs: `framework/deploy/README.md`, template README, root README + `_claude/memory/docs/axf-architecture.md`
  (defaults/starter lines, templates, deploy folder), CLAUDE.md Status + layout.

## Tests before → after

| Check | Before | After |
| --- | --- | --- |
| `axf validate --framework` | 48 assets valid | 49 assets valid |
| tracker / plugins / project validate --all / check-theme | ok / ok / 4 projects ok / 206 files | ok / ok / 4 projects ok / 213 files |
| check-project-fixtures, check-plugin-catalog | 16 / 27 | 16 / 27 |
| gen-fixtures | — | only `uac.json` + `hub-accounts` case |
| check-widgets / check-alerts / check-plugin-inventory | pass | pass (93 / pass / pass) |
| plugin-lifecycle check (mcp-client, systems-check, ai-assistant, agent-manager) | clean | clean |
| `framework/deploy/test.sh` | — | 39 checks |
| shellcheck `framework/deploy/*.sh` | — | clean (all severities) |
| shellcheck `deploy/install-console.sh` | 6 findings | same 6 (pre-existing, untouched lines) |
| install-console dry-run diff | — | docker/output/.axf-console identical in 11 scenarios |
| `check-addons.mts` | — | 3 add-ons valid; a bad one is caught (exit 1) |
| web-fastapi-wall: init + `npm run build` + server self-test + live uvicorn + sandboxed installer | — | ok, 29 checks, ok, ok |
| console `tsc --noEmit` + `vite build`; `test_wall_users.py` | ok; fails without dist (same at base) | ok; 56 checks with the built dist |
| framework libs typecheck | ok | ok |

## Build Pilot: nav asset rename steps (cleanup; not done here)

Build Pilot edited three framework starters in place: `src/assets/nav-menu/{icon-rail,pill-tabs,sidebar-list}.json`
keep the starter ids/names but carry Pilot's items (home, designer, plugins, assistant, agents, assets, account,
settings; sidebar header "Workspace"). A re-bake or `axf` asset sync would overwrite them, and another app picking
`sidebar-list` expects the starter. Steps in the Build Pilot repo:

1. Copy `src/assets/nav-menu/sidebar-list.json` to `src/assets/nav-menu/pilot-nav.json`; set `"id": "pilot-nav"`,
   `"name": "Pilot navigation"`, `"author": "Build Pilot"`, keep `data` as is (style list, header Workspace).
2. If the rail/pill layouts are wanted as choices, do the same for `pilot-nav-rail` (from icon-rail, style rail) and
   `pilot-nav-pills` (from pill-tabs, style pills); otherwise drop them.
3. Restore the three starters byte-for-byte from AmberX-AXF `framework/assets/nav-menu/` (or re-bake assets).
4. `axf.manifest.json` → `defaults["nav-menu"]: "pilot-nav"`.
5. Anything that picks or rolls nav assets by id (none found by grep outside the assets folder) → the new ids.
6. `node ../amberx-axf/framework/cli/axf.mjs validate .`, `npm run typecheck && npm test`, and
   `node ../amberx-axf/framework/cli/check-theme.mjs src plugins`; screenshot before/after (`scripts/rebuild-shots.mjs`).

No other nav renames in this repo for this group (axhub `blank-nav` → `axhub-nav` belongs to another group).

## Left for later

- Build Pilot adopts `axf-deploy.sh` (steps in `framework/deploy/README.md`; run a copy of `deploy/dryrun/` on its installer).
- Template server's `wall.py` duplicates the console's rules; switch it to `framework/python/axf_server/wall` once the
  axf-server group lands it (noted in the file).
- The console could bind to `hub-accounts` directly (drop `console-access`) — deliberately not done (no behaviour change).
- Pre-existing shellcheck findings in `install-console.sh` (SC2097/SC2098 on the doctor line, SC2086/SC2116 in the
  volume message) left untouched to keep the diff empty; CI shellchecks only `framework/deploy`.
