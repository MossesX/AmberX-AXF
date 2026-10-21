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
| `github` | lib-github (`x.lib.github`): `GitHubClient` on `HttpClient` (token only to the API origin, API calls never follow redirects, `download()` fetches GitHub's redirect without the token — https only, 5 hops —, size caps, scrubbed `GitHubError`), `repo_path`/`api_path` (checked names and parts), `valid_repo`/`parse_repo`, `next_link`, `run_state`, `token_allowed`, `redirect_step`, `git_env` (token to git via `GIT_CONFIG_*` only), `scrub`, `zip_member` (unzipped size cap). Node twin `framework/cli/github.mjs`; fixture `spec/fixtures/github.json` (`node framework/spec/check-github.mjs`) | console `app_ci._http`/`_api`/git header, `app_catalog._api`/`_http`, `main._gh`/`release_download`, `alerts._gh`, activity `_github_get`, systems-check's GitHub check; Node: `claude-project.mjs`, project-wizard `wizard.mjs`, `plugin-lifecycle.mjs` + session-checkin push auth |
| `plugin_package` | plugin-package@1 checks = `framework/cli/plugin-catalog.mjs` (same messages and content hash; fixture `spec/fixtures/plugin-package.json`) | Build Pilot `server/plugin_install.py` checks |

## Using it

In the console: `import axf_framework` (server/axf_framework.py puts `framework/python` on `sys.path`; the image also
sets `PYTHONPATH=/axf/framework/python`), then `from axf_server import storage, http`. Plugins may import it
(a framework import keeps plugin-lifecycle@1 clean); they never import each other.

## lib-github (`axf_server.github`)

Built (Oct 21 2026). Use `GitHubClient(token_provider, user_agent=…)` for every GitHub REST call; never build an
`https://api.github.com/…` request by hand or pass a URL from an API answer to plain `http.request` with the token.
Placeholders: uploads.github.com (release assets), GitHub App installation tokens, GraphQL, ETag caching / rate-limit
backoff, and an Android port (`framework/android/lib-github`, planned in `x.lib.github`).
