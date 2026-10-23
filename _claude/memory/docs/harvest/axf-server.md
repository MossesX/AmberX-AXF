# Harvest — axf-server (Oct 20 2026, Opus 5.5)

Branch `harvest/h-axf-server`. Brett's decision: shared Python server helpers go in a new package
`framework/python/axf_server/` (not `axf_libs`). Stdlib only, typed (`mypy --strict` and pyright clean), tested.

## What moved (from → to)

| Item | From | To |
| --- | --- | --- |
| Wall signature, Caller, same-origin, user rules | `apps/console-web/server/wall.py` (+ Build Pilot `server/main.py` 93-147, hand copy) | `axf_server.wall` (`verify`, `sign`, `Wall(prefix)`, `Caller`, `same_origin`, `user_may`, `ui_role`) |
| Private dirs + atomic JSON + safe reads | ~15 copies: `alerts._write_private/_read_json` + VAPID key, `app_ci._save` + APK cache, `app_catalog._write_index` + APK files, `main._save_state/_load_state`, plugins container-access, snapshot-manager, console-terminal (settings, Claude token, session log), systems-check, theme-manager, claude-badge, feature-assist (log), agent-manager (store + memory), ai-assistant (store), activity (config + reports), `axf_libs.mcp.FileRegistry.save` (mcp-client) | `axf_server.storage` (`write_json/text/bytes`, `read_json/read_text`, `append_jsonl`, `private_dir`) |
| Outbound HTTP | `app_ci._NoAuthRedirect/_http`, `alerts._NoRedirect/_OPENER/_target_ok` (ntfy, GitHub, web push), `main._gh` + `release_download`, systems-check `checks._http` + `hostfix._NoRedirect/_rpc`, activity `_NoRedirect/_github_get`, `app_catalog._http` | `axf_server.http` (`request`, `get_json`, `post_json`, `target_ok`, `HttpClient`) |
| Credential store | `apps/console-web/server/credentials.py` `CredStore` | `axf_server.credentials.CredStore` (the console keeps a 4-line subclass for its header + the `CREDENTIALS` table) |
| Console token file + console client | console `main.current_token/_write_token/_token_cache`, Build Pilot `console()/console_raw()/console_token()` | `axf_server.console_client` (`TokenFile`, `read_token_text`, `ConsoleClient`) |
| Plugin package checks | Build Pilot `server/plugin_install.py` (hand copy of `plugin-catalog.mjs`) | `axf_server.plugin_package` (`verify_package`, `path_problem`, `content_hash`, `decode_files`, open `KINDS` registry) |

New in the console: `server/axf_framework.py` (puts `framework/python` on `sys.path`; works in Docker, on the VPS
mount and in tests). `server/wall.py` is now a thin shim (`Wall("AXF_")` + the names main.py and plugins import).

## Who uses it now

- Console core: `main.py` (token file, state, GitHub reads, artifact download), `wall.py`, `credentials.py`, `alerts.py`,
  `app_ci.py`, `app_catalog.py`.
- Plugins (framework import via `import axf_framework`; no cross-plugin imports): activity, agent-manager, ai-assistant,
  claude-badge, console-terminal, container-access, feature-assist, snapshot-manager, systems-check, theme-manager;
  mcp-client through `axf_libs.mcp` (which now uses `axf_server.storage`). Every plugin still passes
  `plugin-lifecycle.mjs check` (project-wizard and session-checkin predate plugin-lifecycle@1 and failed before too).

## Deleted

Every hand-written `_NoRedirect`/`_NoAuthRedirect` opener, `_target_ok`, `_LOOPBACK`, all `tmp + chmod + replace`
writers and `try: json.loads … except: default` readers listed above, the console's own HMAC check and token cache.
Net: 29 files changed, −506/+295 lines outside the new package.

## Contracts / fixtures added

- `framework/spec/fixtures/wall-signature.json` — 19 signature cases (valid, host case-folding, empty perms, 120 s edge,
  stale, future, wrong host, tampered perms/role/user, wrong secret, bad version/timestamp/length, upper-case hex,
  extra part, empty, secret < 32) + 10 header → caller cases. Replayed by `framework/spec/check-axf-server.mjs` (Node,
  reference signer = axHub's scheme) and `framework/python/axf_server/test.py`.
- `framework/spec/fixtures/plugin-package.json` — 42 package cases + 16 path cases generated from
  `framework/cli/plugin-catalog.mjs` itself (`--write`), replayed against the .mjs (so it can't drift) and the Python port
  (identical messages and content hash, incl. UTF-16 path ordering).
- Catalog: feature `f.pyserver` (Foundations → observability/security/build), status built, module `axf_server`.

## Guards kept or tightened (where copies disagreed, the stricter rule won)

- **Atomic writes:** some copies wrote `tmp` then chmod (briefly 0644 under the console's umask 002), some used a fixed
  `x.tmp` name (two writers clobber each other), none fsynced. Now: unique tmp, `O_EXCL|O_NOFOLLOW`, final mode at
  creation + `fchmod`, fsync, `os.replace`, tmp removed on failure, value serialised before any file is touched.
- **Privacy:** agent-manager collections/runs, ai-assistant conversations/usage, agent memory and `state.json` were
  0644 (inside 0700 folders); all are 0600 now. The token file, credential file, VAPID key, ntfy/GitHub/web push
  secrets unchanged (0600). Shared hub files (app catalog: 0664, setgid folder) keep their group bits explicitly.
- **HTTP:** every request is https-only (plain http only to loopback or a named Docker host). Before, systems-check's
  key checks used plain `urlopen` — **followed redirects carrying GitHub/Anthropic/Hostinger/Coolify/axHub tokens** and
  accepted an `http://` Coolify URL. Now no redirects, and a non-https Coolify URL is refused with a clear message
  before the token is sent. `app_ci`'s redirect handler stripped only `Authorization`; it now also drops Cookie,
  Proxy-Authorization and X-Api-Key, re-checks each hop's target (no redirect to plain http) and caps redirects at 5.
  `main._gh`/`release_download` (plain urlopen, followed redirects with the token, no size cap) now never send the token
  off api.github.com and cap downloads at 500 MB. `target_ok` also refuses user:password URLs and bad ports.
- **Wall:** same scheme, same 120 s window, same names; added: secret < 32 never verifies (was only checked in
  `trusted()`), timestamp ≤ 12 digits, header values must be strings. Build Pilot's copy accepted 1-char-longer names
  (`{0,63}`) and only admins; the console's stricter `NAME_RE` (`{1,31}`) is the framework's.
- **Token file:** once a token was read it stays in force if the file loses its line (before: fell back to the
  container's stale `AXF_TOKEN` env, i.e. a reset token could revert). The console refuses a bare-token file
  (`allow_bare=False`); Build Pilot's one-line copy is supported (`allow_bare=True`, its default).
- **Credentials:** a value with a line break is refused (it could inject a second key).
- **Plugin packages:** Python patterns use `\Z` (Python's `$` accepts a trailing newline; JS's doesn't — Build Pilot's
  copy would have accepted `web/x.ts\n`); `NaN`/`Infinity` in plugin.json refused like `JSON.parse`.
- Pre-existing bug fixed on the way: systems-check `checks.py` raised `HTTPException` without importing it.

## Tests before → after

| Test | Before | After |
| --- | --- | --- |
| `framework/python/axf_server/test.py` | — | 200 |
| `node framework/spec/check-axf-server.mjs` | — | 90 |
| `server/test_app_ci.py` | 32 | 35 (redirect test now on axf_server.http: token kept on api.github.com, dropped off it, plain http refused) |
| `server/test_alerts.py`, `test_app_catalog.py` (15), `test_plugin_catalog.py` (19) | pass | pass |
| `server/test_wall_users.py` (needs a built dist) | 56 (with a dist) | 56 |
| `framework/python/axf_libs/mcp/test.py` | 210 | 210 |
| plugin `test.py` ×13 (activity 57, agent-manager 116, ai-assistant 137, claude-badge 17, console-terminal 28, container-access 102, fable-rebuilds 12, feature-assist 29, mcp-client 24, plugin-manager 62, snapshot-manager 49, systems-check 79, theme-manager 34) | all pass | all pass, same counts |
| validate --framework, tracker --check, plugins --check, project validate --all, check-theme, check-plugin-catalog (27), project fixtures (16), gen-fixtures (no diff), console tsc + vite build | pass | pass |

No GUI changed (server-only), so no screenshots.

## Docker / CI

- `apps/console-web/server/Dockerfile`: `ENV PYTHONPATH=/axf/framework/python` and an import check of every module at
  build time. `deploy/install-console.sh` needs no change: the image copies the whole repo and the host clone mounted
  over `/axf` contains `framework/python`; `server/axf_framework.py` covers bare runs and tests. (No Docker daemon in the
  build sandbox: verified by booting `main` in the image's layout — repo at a scratch `/axf`, `PYTHONPATH`, server
  folder as cwd — 18 plugins loaded, no errors.)
- `.github/workflows/android.yml`: engine job runs `check-axf-server.mjs`; console job runs it plus
  `python framework/python/axf_server/test.py`.

## Left for later

- **`axf_server.github` (lib-github, next group):** build on `http.HttpClient` (README in the package has the exact
  settings) and switch `app_ci._api`, `app_catalog._api`, `alerts._gh`, `main._gh/release_download`, activity
  `_github_get`, systems-check's GitHub check to it.
- `ai-assistant/server/sessions.py` and `session-checkin` pricing still write their own tmp files (live-session file is
  already 0600; pricing is a non-secret repo file) — switch when those plugins are next touched.
- The AI providers / agent LLM HTTP (`ai-assistant/providers.py`, `agent-manager/llm.py`) and container-access's Coolify
  call keep their own urllib (custom SSL context, streaming); move them once `http` grows a streaming call.

## Build Pilot adoption (separate repo; not edited here)

1. In `scripts/bake-contracts.mjs`, add to `FILES` (framework path → repo path):
   ```js
   'framework/python/axf_server/__init__.py': 'server/axf_server/__init__.py',
   'framework/python/axf_server/wall.py': 'server/axf_server/wall.py',
   'framework/python/axf_server/storage.py': 'server/axf_server/storage.py',
   'framework/python/axf_server/http.py': 'server/axf_server/http.py',
   'framework/python/axf_server/console_client.py': 'server/axf_server/console_client.py',
   'framework/python/axf_server/plugin_package.py': 'server/axf_server/plugin_package.py',
   'framework/python/axf_server/credentials.py': 'server/axf_server/credentials.py',
   'framework/spec/fixtures/wall-signature.json': 'src/axf/spec/fixtures/wall-signature.json',
   'framework/spec/fixtures/plugin-package.json': 'src/axf/spec/fixtures/plugin-package.json',
   ```
   Run `node scripts/bake-contracts.mjs --from ../amberx-axf` after this branch is on main; commit the files and
   `axf-contracts.lock.json` (`--check` then guards them). `server/` is the uvicorn cwd, so `import axf_server` works
   with no path code; the Dockerfile already copies `server/` and `src/axf/spec`.
2. `server/main.py`:
   - wall: `from axf_server.wall import Wall, same_origin`; `WALL = Wall("BP_")`; `wall_trusted = WALL.trusted`;
     `wall_admin(request)` → `c = WALL.admin(request); return c.name if c else None` (admin only + same origin, as now).
     Delete `WALL_MAX_AGE_S`, `_wall_secret`, `wall_signature_ok`.
   - storage: `_write(path, data)` → `storage.write_json(path, data, dir_mode=None)`; `_read` → `storage.read_json`.
   - console: `TOKEN = TokenFile(os.environ.get("BP_CONSOLE_TOKEN_FILE") or None, fallback="")`;
     `console_token = lambda: os.environ.get("BP_CONSOLE_TOKEN", "").strip() or TOKEN()`;
     `CONSOLE = ConsoleClient(CONSOLE_URL, console_token, timeout=TIMEOUT, token_hint="BP_CONSOLE_TOKEN")`;
     `console(method, path, body, timeout)` → `CONSOLE.call(...)`, `console_raw(path, limit)` → `CONSOLE.raw(...)`;
     `ConsoleError = console_client.ConsoleError`. Plain http to `http://axf-console:7090` (deploy/install.sh) is
     allowed because the client allows exactly its own host.
3. `server/plugin_install.py`: replace `PACKAGE_SCHEMA … verify()` with
   `pkg = plugin_package.verify_package(raw, expect_sha, kind="pilot", folder=folder)` and
   `files = plugin_package.decode_files(pkg)`; map `plugin_package.PackageError` to its `PackageError`. Keep
   `installed/unpack/remove/bundled_plugins` (install side, Build Pilot specific). Messages change to the catalog's
   wording (same as the console shows).
4. Tests: add to `server/test_server.py` a replay of `src/axf/spec/fixtures/wall-signature.json` through
   `Wall("BP_")` and of `plugin-package.json` through `verify_package` (copy the loops from
   `framework/python/axf_server/test.py`), and run the baked `axf_server` self-test if wanted
   (`python server/axf_server/test.py` needs `test.py` baked too — optional).
