# Harvest — lib-github (Oct 21 2026, Opus 5.5)

Branch `harvest/h-lib-github` (from `harvest/h-axf-server`). Plan row 11: GitHub REST helpers → lib-github
(`x.lib.github`), Python + Node. Android/Kotlin not in scope (planned in the plan entry).

## What moved (from → to)

| Item | From (deleted copies) | To |
| --- | --- | --- |
| GitHub API client (Python) | `app_ci._api` + `_http` (followed redirects on every call), `app_catalog._api` + `_http`, `main._gh` (+ `release_download`'s hand-built request), `alerts.AlertHub._gh`, activity `Feed._github_get`, systems-check's GitHub request in `c_github_token` | `axf_server.github.GitHubClient` (on `axf_server.http.HttpClient`): `call/json/get/paginate/download`, `repo/workflow_runs/run_jobs/run_artifacts/dispatch/job_log/check_token` |
| GitHub API client (Node) | `claude-project.mjs` `gh()` + `githubToken()`, project-wizard `wizard.mjs` `gh()` + `token()` | `framework/cli/github.mjs` `createGitHub()` (`call/json/get/paginate`), `githubToken()` (claude-project re-exports it) |
| Repo-name rules | alerts `REPO_RE`, activity `REPO_RE` (allowed `..`), wizard `OWNER_RE`/`REPO_RE`/`parseGithub`, none in claude-project / app_ci / systems-check | `valid_owner/valid_name/valid_repo/parse_repo` = `validOwner/validName/validRepo/parseRepo` (`parseGithub` stays exported by the wizard as a thin wrapper) |
| Run/job status mapping | activity `_gh_state`, app_ci inline mapping, alerts' failure tuple | `run_state` / `runState` (queued · waiting · running · success · failure · cancelled), `FAILURE_CONCLUSIONS` |
| git authentication | app_ci `-c http.https://github.com/.extraheader=…` **on git's argv**, claude-project + wizard global `http.extraHeader` via env, plugin-lifecycle + session-checkin askpass scripts | `git_env` / `gitAuthEnv` (+ pure `git_auth_config`) |
| Error scrubbing | per-copy `.replace(token, '***')` (wizard also the Basic form) | `scrub` (token, its Basic form, anything shaped like a GitHub token) |
| Artifact unzip | app_ci `z.read` (no unzipped cap), main `release_download` `z.read` (no cap) | `zip_member(blob, pick, max_bytes)` (declared + actual unzipped size capped) |

`app_catalog` keeps its own per-file bundle filing (it already capped each APK and checks sha256); only its GitHub
calls moved.

## Who uses it now

- Console core: `app_ci.py`, `app_catalog.py`, `main.py` (`/api/releases`, `/api/releases/download/…`), `alerts.py` (CI/deploy source).
- Plugins: activity (GitHub Actions source + run details), systems-check (GitHub key check), project-wizard (`wizard.mjs`), session-checkin (`install.mjs` push auth). All still pass `plugin-lifecycle.mjs check`.
- Framework CLI: `claude-project.mjs`, `plugin-lifecycle.mjs` (`publishToSource`, used by uninstall `--publish` and catalog installs).
- Image: `apps/console-web/server/Dockerfile` import check now includes `axf_server.github`.

## Contract / fixture

`framework/spec/fixtures/github.json` (hand-picked golden cases): `validRepo` 26, `parseRepo` 16, `repoPath` 13,
`apiPath` 4, `nextLink` 10, `runState` 17, `tokenAllowed` 14, `redirectStep` 11, `gitAuthConfig` 7, `gitEnv` 5,
`scrub` 6. Replayed by `framework/spec/check-github.mjs` (Node, + client guards against a fake fetch) and
`framework/python/axf_server/test.py` section 6 (+ client guards against a fake transport + real `git config` checks).
CI: engine job and console job (`.github/workflows/android.yml`). Change both ports and the fixture together.

Catalog: `w.github` → partial (module `axf_server.github`); plan `x.lib.github` → partial (python built, Node twin noted,
Android planned). Build-queue step `x.lib.github` stays open (Android port + demo app). **Not added to
`libraries.json`**: that index lists *app-installable* libraries — `axf install github` would add a Gradle dependency on a
module that doesn't exist, and Build Pilot / the console wizards would offer it for apps. It gets an entry when the
Android port exists.

## Guards kept or tightened (stricter rule where copies differed)

- **Token only to the API origin.** Before: `app_ci.apk` and `app_catalog.sync` sent the token to whatever
  `archive_download_url` the API answered, and `main.releases` to whatever `artifacts_url` said. Now any absolute URL
  must be on the API origin or the call is refused before anything is sent (both ports).
- **Redirects.** API calls never follow a redirect (alerts/activity/main/systems-check/Node already didn't — Node
  `fetch` used to follow by default; app_ci followed on every call). Downloads (artifact zip, job log) follow GitHub's
  redirect **without any credential**, https only (plain http refused even on loopback; before, `strip-auth` allowed
  loopback http hops), at most 5 hops. Side effect: a renamed repo's 301 on a JSON call is now an error instead of
  being followed.
- **git.** The token is never on git's command line (app_ci had it in argv, visible in `ps`) and never in a URL; the
  header is scoped to `https://github.com/` (Node copies sent it to every host) and `http.followRedirects=false`
  stops git carrying it through a redirect. Existing `GIT_CONFIG_COUNT` entries in the environment are kept (appended
  after them). Askpass scripts (temp file + token in env for the whole git process) are gone.
- **Names.** Owner `[A-Za-z0-9][A-Za-z0-9-]{0,38}`, repo `[A-Za-z0-9_][A-Za-z0-9._-]{0,99}` with no `..` (the wizard's
  rule, the strictest). Activity's pattern allowed `../..`; alerts allowed `a..b`; claude-project checked nothing
  (flags/manifest owner and repo and the `full_name` GitHub answers now all pass the check before reaching a URL/git).
  Path parts are checked segment by segment (`repo_path`), query values encoded.
- **Size caps.** JSON 8 MB default (activity 4 MB, systems check 4 KB kept), downloads explicit (APK 200 MB, release
  500 MB), unzipped size capped (new), Node reads are capped too (none before).
- **Errors** carry GitHub's `message` (≤ 200 chars) scrubbed; network errors scrubbed.
- Base URL: `GITHUB_API_URL` is honoured where it was before (alerts, claude-project, wizard — tests use a loopback
  fake); it must be https or loopback http. app_ci, app_catalog, main, activity, systems-check stay pinned to
  api.github.com.

## Tests before → after

| Test | Before | After |
| --- | --- | --- |
| `framework/python/axf_server/test.py` | 200 | 363 (fixture replay + client guards + git env) |
| `node framework/spec/check-github.mjs` | — | 143 |
| `node framework/spec/check-axf-server.mjs` | 90 | 90 |
| `server/test_app_ci.py` | 35 | 39 (fake API now a transport; artifact + job-log redirects fetched without the token; bad repo; artifact URL off api.github.com refused; token not on git's argv, scoped header + no redirects in env; the old `_http` redirect test moved into the library tests) |
| `server/test_app_catalog.py` | 15 | 15 (bundle now arrives through GitHub's redirect, asserted token-free) |
| `server/test_alerts.py`, `test_plugin_catalog.py` (19) | pass | pass |
| `server/test_wall_users.py` | needs a built dist (fails without, as before) | same |
| plugin `test.py` ×13 | all pass | all pass, same counts (ai-assistant failed once on its timing-sensitive CLI check, passed on rerun; it also passes on the base commit — not touched here) |
| `project-wizard/test.mjs`, `session-checkin/test.mjs`, `check-plugin-catalog.mjs` (27) | pass | pass |
| `framework/python/axf_libs/mcp/test.py` | 210 | 210 |
| validate --framework, tracker --check, plugins --check, project validate --all, check-theme, project fixtures (16), gen-fixtures (no diff), plugin-lifecycle check ×all | pass | pass |
| `mypy --strict -p axf_server` | 9 pre-existing errors in test.py | same 9 (github.py clean; pyright clean) |

No GUI changed (server/CLI only), so no screenshots. No web code changed, so no tsc/vite run.

## Left for later

- Android port (`framework/android/lib-github`, Kotlin on axf-network) + the `x.lib.github` demo app, then a
  `libraries.json` entry.
- Placeholders in the module docs: uploads.github.com (release assets), GitHub App installation tokens, GraphQL,
  ETag caching / rate-limit backoff.
- `deploy/*.sh` scripts that talk to GitHub (none call the REST API with a token) were left alone.

## Build Pilot adoption (separate repo; not edited here)

Build Pilot makes no GitHub calls of its own today (APK builds go through the console's `app-ci@1`), so nothing to
switch. When it needs GitHub, bake the module rather than writing a copy:

1. `scripts/bake-contracts.mjs` → add to `FILES` (with the axf-server entries from the axf-server report):
   ```js
   'framework/python/axf_server/github.py': 'server/axf_server/github.py',
   'framework/spec/fixtures/github.json': 'src/axf/spec/fixtures/github.json',
   ```
   then `node scripts/bake-contracts.mjs --from ../amberx-axf` after this branch is on main and commit the lock.
2. Use `from axf_server import github; gh = github.GitHubClient(lambda: os.environ.get("BP_GITHUB_TOKEN", ""), user_agent="build-pilot")`.
3. Add a replay of `src/axf/spec/fixtures/github.json` to `server/test_server.py` (copy the section-6 loops from
   `framework/python/axf_server/test.py`).
