# GitHub (github-app@1)

One GitHub App for the whole stack, so GitHub access stops depending on personal tokens that die (Brett, Nov 1 2026).

## Setup: three taps (Settings → Plugins → GitHub)
1. **Create GitHub App**: the server builds a manifest (`POST manifest`), the browser posts it to
   `https://github.com/settings/apps/new` (personal account MossesX). GitHub returns to `/?ghapp=created&code&state`;
   the web part catches that on load (`register`), opens this tab and calls `POST convert`, which stores the app and
   sends the browser to `https://github.com/apps/<slug>/installations/new`.
2. **Install** on All repositories. GitHub returns to `/?ghapp=installed&installation_id=…` → `POST installation`
   finds it (`GET /app/installations` with the app JWT) and the keeper mints the first token.
3. **Authorize as Brett** (`POST authorize` → GitHub → `/?ghapp=authorized&code&state` → `POST authorized`): a user
   access token from the same app (8 h, refresh token 6 months, rolled on every refresh). Installation tokens can't
   create repos on a personal account; this one can (`axf repo create <name> --private`).

Permissions asked: Administration, Contents, Pull requests, Actions, Workflows, Issues (read and write), Checks and
Commit statuses (read), Metadata (read). Private app, webhook off.

## What uses it
- **Keeper** (server, every 5 min, `AXF_GITHUB_APP_KEEPER=off` stops it): `GITHUB_TOKEN` in the console's environment
  = the installation token (renewed at 50 min), so every plugin (push banner, activity feed, CI reads, build paths,
  main-build status, app CI) and every subprocess uses the app. The old personal token is kept in `GITHUB_TOKEN_PAT`
  and takes over again whenever the app can't mint. `AXF_GITHUB_TOKEN_SOURCE` = app | legacy | none.
- **Systems check**: the GitHub route defaults to `auto` (the local token first while it is the app's, else axHub);
  the "GitHub token" item tests the old token (amber a week before it expires, amber not red while the app works).
- **VPS**: `framework/deploy/axf-git-cred` (git: installation token, then the old token) and `framework/deploy/gh-app`
  (`gh`: the user token, else the installation token), installed by `framework/deploy/install-github-helpers.sh`.
- **Node tools**: `framework/cli/github.mjs` `githubToken()` = env token, else the app's installation token, else `gh`.

## Health (axf.health@1)
- `github-app`: credential files private, app key accepted (`GET /app`), installed, token mints, rate limit left.
- `github-app-user`: the user token still refreshes (red with "Authorize as Brett again" when a refresh fails).

## Files
Credentials (framework broker, not plugin data): `<console>/.axf-console/github-app/` — `app.json` (ids only),
`private-key.pem`, `client-secret`, `webhook-secret`, `installation-token.json`, `user-token.json`,
`pending-state.json`; folder 0700, files 0600, git-ignored, never sent to a browser. Kept when the plugin is
uninstalled (git and gh use them); `node framework/cli/github-token.mjs forget --all` removes them.

```bash
node framework/spec/check-github-app.mjs                 # broker against a fake GitHub
python3 apps/console-web/plugins/github-app/test.py      # keeper, health states, routes
node framework/cli/github-token.mjs status --live        # health from the shell (never a secret)
```
