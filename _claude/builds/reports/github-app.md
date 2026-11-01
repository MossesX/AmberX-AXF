# GitHub App for the whole stack (github-app, Nov 1 2026, Opus)

Personal tokens kept dying (401s, 403s on the banner) and the fine-grained one couldn't create repos. The console now
makes its own private GitHub App and mints its own tokens from the app's key, so access never dies for good.

## What Brett taps (once)
Console → **Settings → Plugins → GitHub**:
1. **Create GitHub App** → GitHub shows the app page → **Create GitHub App** (name taken? add a suffix in the console's
   name field and tap Create again).
2. GitHub opens the install page by itself → **All repositories** → **Install**.
3. Back in the console → **Authorize as Brett** → **Authorize** on GitHub.

The systems check's **GitHub App** item turns green. Within 15 minutes of step 3 the axp-backup finish timer creates
`axp-xchat`, `axp-devstudio` and `axp-demo` (private) with the app's user token and pushes the backups (its own secret
scan runs first, unchanged), then turns the nightly backup on and clears its banner item.

## Where things are stored (paths only)
- App credentials: `/opt/axf/.axf-console/github-app/` on the VPS (`/axf/.axf-console/github-app/` in the console
  container): `app.json` (ids only), `private-key.pem`, `client-secret`, `webhook-secret`, `installation-token.json`,
  `user-token.json`, `pending-state.json`. Folder 0700, files 0600, root-owned, git-ignored, never sent to a browser.
- Old personal token: unchanged in `/opt/axf/.axf-console/secrets.env` (fallback until Brett deletes it).
- VPS helpers: `/usr/local/bin/axf-git-cred` (git), `/usr/local/bin/gh` (wrapper in front of `/usr/bin/gh`); the
  replaced files were kept as `*.pre-github-app`.

## What now uses the app
| Caller | How |
|---|---|
| Every console plugin + subprocess (push banner listing/PRs/merges/auto-merge, activity feed, CI-status reads, main-build status, app CI, build paths, handoff, plugin publishing) | the keeper sets the console's `GITHUB_TOKEN` to the installation token every 5 min (renewed at 50 min); the old token sits in `GITHUB_TOKEN_PAT` and takes over if the app can't mint |
| GitHub route (axf.github@1) | new default `auto`: the local token first while it is the app's, else axHub first (an explicit hub/local choice still wins) |
| Live key check "GitHub token" | now tests the old token (amber a week before it expires; amber, not red, while the app carries GitHub) |
| Push banner health | an installation token can't read `/user`; it now proves the route with `/rate_limit` |
| git on the VPS (console updater, builds, `git push`) | `axf-git-cred`: installation token first, then the old token |
| `gh` on the VPS | the app's user token, else the installation token; an explicit `GH_TOKEN` wins; no app = gh's own login |
| Node tools (`framework/cli/github.mjs` `githubToken()`) | env token, else the app's installation token, else `gh auth token` |
| Repo creation | `axf repo create <name> --private` / `github-token.mjs repo create` with the user token |
| axHub's github connector | **not changed** (follow-up thread): it keeps its own token in the hub vault |

## Health (axf.health@1)
`github-app`: files private · key accepted (`GET /app`) · installed · token mints · rate limit left.
`github-app-user`: user token refreshes (red with "Authorize as Brett again" when a refresh fails). Before setup:
amber, "No GitHub App yet … 3 taps".

## Tests
- `node framework/spec/check-github-app.mjs`: 17 checks against a fake GitHub (manifest, callback exchange + state,
  file modes, JWT, installation discovery + cache + lock, git helper order + fallback, gh wrapper, user exchange +
  refresh + parallel refresh + failure recorded, repo create, health states, no secret in any output). Added to CI.
- `python3 apps/console-web/plugins/github-app/test.py`: 22 checks (keeper swap + fallback, health states, routes).
- Systems check self-test 216/216, lib-github 143/143, theme, controls, plugin pages, lifecycle, console typecheck.

## Screenshots
UI Review → Screenshots, group **GitHub App - Nov 1** (before setup and set-up state, phone + desktop; demo ids and
a throwaway key, no secrets on screen).

## Known gaps
- axHub's github connector still on its own token (follow-up).
- The manifest flow's return lands on `/?ghapp=…`; if the console's wall ever blocks a query string on `/`, step 1
  would need the path form instead.
- `deploy/axp-backup/finish.sh` on branch `claude/axp-backup` lacks the repo-create step; the live copy has it.
