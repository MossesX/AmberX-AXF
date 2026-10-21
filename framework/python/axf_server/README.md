# axf_server — shared Python server helpers

Stdlib only, typed (`mypy --strict`, pyright clean). Used by the Dev Console's API and plugins; Build Pilot gets it
through its contract bake. Self-test: `python3 framework/python/axf_server/test.py`; cross-language fixtures:
`node framework/spec/check-axf-server.mjs` (CI runs both).

| Module | What | Replaces |
| --- | --- | --- |
| `wall` | axHub sign-in wall: `verify`/`sign` (`v1.<ts>.<hmac>` over `v1\|ts\|user\|role\|perms\|host`, ±120 s, host bound, secret ≥ 32), `Wall(prefix)` (`AXF_` console, `BP_` Build Pilot) → `caller(headers)`, `malformed_session`, `admin(request)`; `Caller`, `same_origin`, `user_may` | console `server/wall.py` (now a shim), Build Pilot `server/main.py` wall block |
| `storage` | `private_dir` (0700), `write_json`/`write_text`/`write_bytes` (unique tmp + O_EXCL + fchmod + fsync + `os.replace`, 0600), `read_json` (deep copy of the default), `append_jsonl` (0600, rotation) | ~15 hand copies in the console and its plugins |
| `http` | `request` (https only, plain http only to loopback / named hosts; `redirects="never"` or `"strip-auth"` with `auth_origins`; size cap; timeout; injectable transport), `get_json`, `post_json`, `target_ok`, `HttpClient` | `_NoRedirect`/`_NoAuthRedirect`/`_target_ok` copies, `main._gh`, systems-check `_http`, hostfix `_rpc` |
| `credentials` | `CredStore`: 0600 env file of `KEY=value`, `set`/`clear`/`load_into_env`, line breaks refused | console `server/credentials.py` store |
| `console_client` | `TokenFile` (the `AXF_TOKEN=` line, mtime cache, atomic rewrite), `ConsoleClient` (`call`, `raw`; never follows a redirect) | console `current_token`/`_write_token`, Build Pilot `console()`/`console_raw()`/`console_token()` |
| `plugin_package` | plugin-package@1 checks = `framework/cli/plugin-catalog.mjs` (same messages and content hash; fixture `spec/fixtures/plugin-package.json`) | Build Pilot `server/plugin_install.py` checks |

## Using it

In the console: `import axf_framework` (server/axf_framework.py puts `framework/python` on `sys.path`; the image also
sets `PYTHONPATH=/axf/framework/python`), then `from axf_server import storage, http`. Plugins may import it
(a framework import keeps plugin-lifecycle@1 clean); they never import each other.

## Extension point: `axf_server.github` (lib-github, next)

Build it on `http.HttpClient`: base `https://api.github.com`, `auth=lambda: f"Bearer {token()}"`,
`headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}`,
`redirects="strip-auth"`, `auth_origins={"https://api.github.com"}` (artifact zips redirect to blob storage without
the token). Paths stay on the base origin (`HttpClient.url` refuses another host). Then switch `app_ci._api`/`_http`,
`app_catalog._api`, `alerts.AlertHub._gh`, `main._gh`/`release_download`, activity `_github_get` and systems-check's
GitHub check to it.
