# Systems check (console plugin)

`ai.amberx.axf.console.systems-check` · built on Opus (Oct 18 2026; moved out of the console core) · Fable rebuild pending (`systems-check-plugin`).

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
`GET check[?force=1]`, `POST check/{id}`, `POST secret`, `POST secret/clear`, `POST fix/{id}`, `GET ai`,
`PUT settings`, `GET|DELETE routine`, `POST routine/run`, `GET whats-new[?summary=1]` (changes since the shared seen point, `canClear`), `POST whats-new/seen {head}` (admins only: console token or hub admin; clears it for everyone).
Provides `axf.syscheck@1` (`run_all`) for the console's alerts.

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/systems-check/` (`settings.json`, `routine.json`, `whatsnew/`, `whatsnew-seen.json`).
```bash
node apps/console-web/plugins/systems-check/install.mjs
node apps/console-web/plugins/systems-check/uninstall.mjs --all
python3 apps/console-web/plugins/systems-check/test.py
```
