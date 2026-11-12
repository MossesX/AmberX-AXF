# Full API + CLI control of everything, offline registry, AI only as fallback — Nov 10-12 2026

Brett (Nov 10 2026): "I need extensive API and CLI control over every single page, app, plugin, tool, behavior, display,
and setting with every single option or possibility for a parameter. Need to be able to completely run the console,
Molly, axHub, Hostinger, Coolify, VPS, Moshi app, AmberX app. I need a powerful complete index and registry for offline
management and internal logic. Anything that can possibly be done without AI needs to be, with AI only as a fallback by
default unless you have made Claude available to the console in Claude settings."

Build `full-api-cli-control-of-everything-plus-an-offli`, branch `claude/full-api-cli-control-of-everything-plus-an-offli`,
PR #468. Phase 1 (Fable, s1-s3): contract, engine, collectors, offline index, dispatcher, AI gate. Phase 2 (Opus, s4-s17,
one headless session): the surfaces, every app and provider, the Registry page, the coverage check, tests.

## The registry today

1548 entries, 1947 actions, 8 owners: Dev Console 1408, AmberX 66, Molly 31, axHub 21, VPS 7, Hostinger 6, Coolify 6,
Moshi 3. By type: tool 1169, page 165, plugin 83, display 73, setting 49, app 7, behavior 2. Reached on REST 1442,
MCP 1442, CLI 1462, voice 828, deep link 315. Needs AI: 0. Every gap is in `_claude/builds/registry/gaps.md` with its
reason. Offline index: `_claude/builds/registry/index.json` (rebuilt by `node apps/console-web/lib/registry/index.mjs build --write`).

## How everything is reached (the same call on every surface)

| Surface | Way in |
|---|---|
| Deep link | the entry's `open.deepLink`: console `?axf-view=<id>`, `?axf-settings=<tab>&anchor=…`, `?axf-dialog=<id>&axf-arg=…`, navigation-only `?axf-action=<id>` (opened by Console commands on load, s13); Molly `https://molly.amberxai.com/#/<app>/<route>`; axHub `https://axhub.amberxai.com/#/<route>`; AmberX launcher / share intents; Moshi `moshi://tmux?…`, `moshi://herdr?…` |
| REST | `GET /api/registry` (owner, type, tag, surface, plugin, q, needsAI, limit, offset), `GET /api/registry/<id>`, `/search`, `/export`, `/stats`, `/owners`, `/gaps`, `/providers/check`; `GET /api/control/<id>/state`; `POST /api/control/<id>/<action>` (params validated; `confirm`, `reason`, `dry`); `POST /api/control/resolve` (`input`, `run`) |
| MCP | `registry_list`, `registry_get`, `registry_search`, `control_state`, `control_invoke`, `control_resolve`; `registry_get` returns the console tool for the entry (`console_open` / `console_dialog` / `console_settings` / `console_action` with args, `console_show kind:target`) |
| CLI | `axf ctl list \| get \| search \| state \| set \| do \| open \| resolve \| export \| completion` (also `bin/axf-ctl.mjs`); through the console when `AXF_TOKEN` is set, offline from the index otherwise; bash completion `completions/axf-ctl.bash` |
| Voice | every phrase goes through the same resolver: `control_resolve` / `POST /api/control/resolve` / `axf ctl resolve "…"`; declared phrases plus generated unique `<verb> <label>` phrases (828 entries) |

What runs where: console refs become **control@1 commands** (`console.screens/dialogs/settings/actions`, `plugins.commands/reads`,
tokens, AmberX items, planner), so control@1's permissions, confirm tokens and write audit apply; `provider:<connection>/<op>`
is **one axHub call** with the console's hub token (`server/registry_providers.py`); URLs and intents come back as a
**handoff** the caller opens; in-window actions of Molly and AmberX plugins answer `not_implemented` with the reason.

## AI only as fallback

Deterministic first, always: exact ids, aliases, synonyms, declared phrases, allowed values. Claude is asked only when
nothing matched (or the action needs a model) **and** Claude settings → "Make Claude available to the console"
(`console.claudeAvailable`, owner-only, default off) is on. The console's model (`axf.llm@1`, found by capability)
gets the brief (the phrase, the closest entries, their actions and allowed values) and must answer `{id, action, params}`;
that answer is resolved again by the registry, so anything outside the allowed values is refused. Offline (`axf ctl`
without the console) there is no model. Fixed on the way: the gate read the setting from the wrong field of the
Claude settings CLI's answer and always reported it missing.

## Per app (steps)

| Step | What | Files |
|---|---|---|
| s4 REST | routes above; `regid` path convertor keeps control@1's `/api/control/<target>/…` untouched; HTTP 202 for `confirmation_required` / `held` | `apps/console-web/server/registry_api.py`, `lib/registry/rpc.mjs`, `lib/registry/execute.mjs` |
| s5 MCP | six tools; tokens and planner items are control@1 entries; console targets = deep links (`consoleSyncProblems` = 0) | `server/mcp_server.py` |
| s6 CLI | `axf ctl`, offline runner, completion from the registry, value checks before sending | `lib/registry/cli.mjs`, `bin/axf-ctl.mjs`, `completions/axf-ctl.bash`, `framework/cli/axf.mjs` |
| s7 Console | 46 settings from settings registries (`value:` refs through the plugin's settings routes), every swappable asset type with every asset id, packages, spacing, help mode, assets; parameter-name conventions (param gaps 1093 → 23) | `lib/registry/console-entries.mjs` |
| s8 Molly | app, four framed apps (URL handoff), navigation look via control@1 `tokens.nav`; plugins and in-window actions collected with the gap "no remote command channel yet" | `apps/molly/registry.json` |
| s9 axHub | app, pages, connections (`catalog`, `call`), look, hub sync; unbuilt hub areas as gaps with the hub's reason; the provider bridge | `apps/axhub-web/registry.json`, `server/registry_providers.py` |
| s10 Hostinger | domains, DNS (records, validate, update, delete, snapshots, restore, reset), VPS (list, details, metrics, start, stop, restart), backups, billing | `apps/axhub-web/providers/hostinger/registry.json` |
| s11 Coolify | projects, applications (logs, start, stop, restart, deploy/redeploy), env vars, services, deployments | `apps/axhub-web/providers/coolify/registry.json` |
| s12 VPS | health, systemd, processes, logs, containers, maintenance: allow-listed command templates, values validated and shell-quoted, `vps.run` held for Brett | `apps/axhub-web/providers/vps/registry.json` |
| s13 AmberX | app + intents from its manifest, phone tools via axHub (`open_url`, recorder), items via control@1; console deep links now open | `apps/amberx-droid/registry.json`, `plugins/console-commands/web/index.tsx`, `framework/spec/PORTING.md` |
| s14 Moshi | only what Moshi publishes (getmoshi.app/docs/notifications): launcher, `moshi://tmux`, `moshi://herdr`; the rest as gaps | `apps/amberx-droid/registry/moshi.json`, `docs/integrations/moshi.md` |
| s15 Registry page | plugin `control-registry`, view `registry` | `apps/console-web/plugins/control-registry/` |
| s16 Coverage | parity and coverage check in CI, baseline, gap report | `scripts/check-registry-coverage.mjs`, `lib/registry/coverage.mjs`, `_claude/builds/registry/coverage-baseline.json`, `gaps.md` |
| s17 Tests | `lib/registry/test.mjs` (71 checks), `server/test_registry_api.py` (36 checks), both in CI | |

## Safety

- Destructive actions: control@1's own confirm tokens for console refs; the registry's confirm token (bound to the exact
  entry, action and parameters, valid that UTC day) for provider calls, intents and URLs; plus Brett's approval on
  axHub for every change sent there (sent once with `reason {title, description}`, never polled, never approved here).
- The VPS entries are the allow-list: fixed command templates; every value is checked (patterns, ranges, enums) and
  shell-quoted. Injection attempts fail validation (tested).
- No secrets in the console for Hostinger, Coolify or the VPS: the hub holds them.
- Deep links only navigate: `?axf-action` runs an action only when it opens something and isn't person-only.

## Known gaps and what needs Brett

- **Hub tool names.** The Hostinger and Coolify op names follow their connectors' own tool naming; they are not in
  this repo. With the console running, `GET /api/registry/providers/check` (or MCP `control_invoke
  axhub-web/tool/connections catalog`) lists any declared op the live hub does not have; fix the name in the
  provider's `registry.json`.
- **UI Review.** Desktop and phone shots of the Registry page were taken (rebuild-shots, appearance hub off), but this
  headless session had no `AXF_TOKEN` / `AXF_CONSOLE_URL`, so `review.mjs submit --console` could not reach Brett's
  console. Submit them from a session with the console token.
- **Molly and AmberX in-window actions** need a command channel (console-commands@1 client); AmberX voice fallback and
  screen deep links are deferred twins (no new Android work): `framework/spec/PORTING.md`.
- **147 coverage findings held** (124 voice phrases on tools whose labels collide or say too little, 23 parameters
  with no natural allowed values): listed in `gaps.md`; new ones fail CI.
- The scratch console used for screenshots only opened the page via `window.AXF.dispatch('nav:registry')` after the
  lazy loader's idle load; `?axf-view=registry` relies on Console commands being on (it is by default).
