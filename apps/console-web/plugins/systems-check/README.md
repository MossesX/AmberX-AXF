# Systems check (console plugin)

`ai.amberx.axf.console.systems-check` · built on Opus (Oct 18 2026; moved out of the console core).

Two banners at the top of every view, one dialog, one settings sub-tab (Settings → Plugins → **Systems check**).

## Systems check banner + dialog
Runs when the console loads (and when the token changes). Anything blocking or worth a look shows in the banner;
the dialog has Grid, By service and Guided setup views and **Fix all**. Checks come from three places:
1. **Built-in** (`server/checks.py`): console token, credentials, GitHub, Anthropic, Hostinger, Coolify, axHub, repo
   clone, manifest, shared data, Claude files, and VPS host items from `deploy/console-doctor.sh`.
2. **Declared by the codebase** (`server/derive.py`, no AI): every console plugin (loaded, the services it `requires`,
   its data folder is private, and its own self-checks from `hooks.mjs → checks(ctx)` via
   `node framework/cli/plugin-lifecycle.mjs checks <folder>`), every project manifest, and the root manifest's shared
   data files. New plugins and projects are picked up automatically.
3. **The saved AI routine** (`server/routine.py`, `routine.json`, `check-routine@1`): see below.

Credentials typed in the dialog go to the console core's credential store (`server/credentials.py`,
`.axf-console/secrets.env`, 0600, loaded into the console's environment at start), never back to a browser. They
stay when this plugin is uninstalled.

## Live key + health checks (health@1, Oct 30 2026)
Brett: the console's `GITHUB_TOKEN` went dead (401) and nothing told him — "I need to see that kind of shit." Every key
and connection is now tested against its service with one cheap read-only call (`server/probes.py`), and anything
broken is a **red banner item** saying what broke, what it **breaks** and **since** when, with a Fix:
- **Keys** (Keys banner): GitHub (`GET /user`; classic scopes `repo` + `workflow`, or for a fine-grained token one read
  each of the repo with push, its pull requests and its Actions; the `github-authentication-token-expiration` header
  turns it **amber a week ahead** and red once expired), Anthropic key, Claude sign-in (Claude Code token), Hostinger,
  Coolify, axHub MCP token, OpenAI / ElevenLabs when set. Fix = paste a new one (**tested before it's saved**: a key the
  service refuses isn't saved; "Save anyway" only when the service didn't answer) or **New key** (GitHub's token page
  pre-filled with the permissions).
- **System** (systems check banner): ntfy topic, push path to AmberX, git push credentials on the VPS checkout
  (`git push --dry-run`), CI on main, stuck builds (change-log entries with no heartbeat for 30 min, launches that exited
  within 2 min), hub calls denied or expired, containers in a restart loop, disk over 85%.
- **Schedule:** the monitor (`server/health.py`) runs every 15 minutes, once when the console starts, and on Check now;
  key checks also run live on each banner load. Answers are cached; "couldn't reach it" stays amber for 10 minutes
  before it turns red. Items go green by themselves.
- **Push:** each item that turns red is raised once as a console alert (`system:<id>`), which the AmberX app shows as a
  phone notification; it resolves when green. One push per red episode (state in `health-state.json`).
- **Registry:** any plugin adds a check through `plugin_services.get("axf.health@1").register({id, label, run, severity,
  service, breaks, fix, links, instructions, interval}, owner=<folder>)`; `run()` returns `{status, summary, details?,
  unreachable?, expiresAt?, link?}`. `GET health` lists them; `POST health/run` = Check now. Follow-up (after
  `claude/pr-only-merge`): the push banner's token check moves onto health@1.

## Fix it yourself: auto-fix + GitHub through axHub (Oct 30 2026)
Brett: "Why do I have to tell you to fix something when you have the tools to do it?"
- **Auto-fix:** a health@1 check may carry `autoFix: {label, run, mitigated?}` (built-in checks get one with
  `REGISTRY.add_autofix(id, …)`). When it turns red the monitor runs the fix first, in the background, shows the item
  amber ("Auto fix is on it"), checks again, and shows red (and pushes) only if it's still broken. `run()` answers
  `{state: done | started | failed, message, mitigated?, waitS?, jobId?, link?}`: `started` = a veto call or approval
  that runs later (never polled; one re-check once it should have run). `mitigated` = worked around (the item stays
  amber, saying so, while `mitigated()` holds). Per check (Settings → Plugins → Systems check → **Fix it yourself**):
  **On** (default) / **Ask first** (red, with its Auto fix button: `POST health/autofix/{id}`) / **Off**. Every attempt
  is in the history (`GET health` → `history`) and opens a finished fix entry in the axHub change log.
- **Auto-fixes today:** dead console GitHub token → GitHub goes through axHub (worked around until a new local token is
  saved); disk over 85% → Docker clean-up as a veto call (Vinny, else Mosses); stuck builds → marked stalled, **ask first** by default (it closes change-log entries, which is Brett's call).
- **github@1** (`axf.github@1`, `server/githubsvc.py` on the framework lib `axf_server.github_hub`):
  `client(user_agent=…)` is a drop-in `GitHubClient` that sends every read the hub has a tool for to axHub's github
  service with the console's AXHUB_TOKEN (the hub's GitHub token stays in its vault) and falls back to the local
  GITHUB_TOKEN when the hub can't be reached, has no tool for the call (merge, branch delete, check-runs, downloads) or
  its own token is refused; or the other way round (route `local`). `GET github` / `PUT github {route}`; check
  `github-hub` (amber when the hub route is down). CI on main reads through it. Follow-up (build `claude/pr-only-merge`,
  Angel `live-key-checks` s12): the push banner, auto-merge and branch cleanup build their client from `axf.github@1`.

## What's new banner
Changes since this browser last opened the console: commits on the console's clone and plugins added, updated or
removed. **Got it** marks them seen (kept in this browser's localStorage). Can be switched off in the settings tab.

## AI switches
Two switches: **Use AI for the systems check** and **Use AI for What's new**. They need the **AI assistant**
(`axf.llm@1`) and **Mosses** (`axf.agents@1` + the `coder` add-on agent). When either is missing the switches are
greyed out, with what's missing and a link to install or set it up (found by capability in the plugin manifests).
- Systems check: Mosses reads a digest of the codebase (plugins and what they need, deploy scripts, env variables the
  server reads, the Status notes, existing check ids) and proposes extra checks in a fixed declarative format
  (`env`, `file`, `json`, `service`, `plugin`, `https`). They're validated and saved as the routine, which runs on
  every check, **with or without AI**. The routine is refreshed when the code changes (new commit) or on demand.
  Nothing an AI writes is ever run as code.
- What's new: Mosses writes a short plain-English summary of the commits; it's saved per commit range, so it still
  shows when AI is off.

## Routes (`/api/plugins/systems-check/`, console token)
`GET check[?force=1]`, `POST check/{id}`, `POST secret` (tested first), `POST secret/test`, `POST secret/clear`, `GET health`, `POST health/run`, `POST fix/{id}`, `GET ai`,
`PUT settings`, `GET|DELETE routine`, `POST routine/run`, `GET whats-new[?summary=1]` (changes since the shared seen point, `canClear`), `POST whats-new/seen {head}` (admins only: console token or hub admin; clears it for everyone).
Provides `axf.syscheck@1` (`run_all`) for the console's alerts and `axf.health@1` (the health check registry).

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/systems-check/` (`settings.json`, `health-state.json`, `routine.json`, `whatsnew/`, `whatsnew-seen.json`).
```bash
node apps/console-web/plugins/systems-check/install.mjs
node apps/console-web/plugins/systems-check/uninstall.mjs --all
python3 apps/console-web/plugins/systems-check/test.py
```
