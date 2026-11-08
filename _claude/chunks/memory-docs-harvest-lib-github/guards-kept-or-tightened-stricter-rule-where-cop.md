<!-- memory-chunk@1 source=_claude/memory/docs/harvest/lib-github.md lines=42-66 tokens=567 -->
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
