<!-- memory-chunk@1 source=_claude/memory/docs/harvest/lib-github.md tokens=511 -->
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
