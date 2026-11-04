# Build report: app-voice-commands (Current profile)

**Agent:** Reel Rhonda (no Polo card on the roster) · **Model:** one Fable session (s1 the contract on Fable; the Opus-pinned steps ran in the same session, no model switch, no upgrade phase) · **Branch:** `claude/app-voice-commands` · **PR:** [#323](https://github.com/MossesX/AmberX-AXF/pull/323) · **Date:** Nov 4 2026

## What Brett said (verbatim, Nov 4 2026, voice)
> "It's voice control too - like I can control it with my voice, right?" ... "Anytime I build a new app or port an app like that, it needs to be noted whether it's for the framework development itself, and if so, it needs to build in voice commands for the API and MCP and CLI automatically, so they can be added to Molly and controlled by voice."

## Short version
Every app now says in its project manifest whether it is for the framework's own development (`framework.forFramework`). A forFramework app's every API / MCP / CLI command and web action has voice phrases in one `voice-command@1` asset, generated from what the app already declares and checked in CI. The Dev Console's new `voice-commands` plugin matches what you say, asks when something is missing or the command deletes, runs it and answers; Molly's new `voice-control` plugin puts a mic and a text box on every screen and talks to that console frame. "What can I say in Expenses?" lists the phrases. Expenses PR #307 landed first.

## Steps
| Step | What | Where |
|---|---|---|
| s0 Land Expenses #307 | Red CI was the plugin-lifecycle check seeing Expenses' own `src/plugins/plugin-manager` as a stale reference to the console plugin; the scan now treats a bare `plugins/<folder>` inside another app's tree as that app's own plugin system. The grid's whole-list save now merges by entry id (`known` ids from the tab; entries added by the API, CLI, MCP or voice survive; `replace: true` for snapshot loads). 7 new checks (`scripts/expenses-grid.test.mts`). Merged 15:14 UTC; the Expenses VPS updater deploys it. | `framework/cli/plugin-lifecycle.mjs`, `apps/expenses/app/api/expenses/route.ts`, `apps/expenses/src/modules/expenses/store.ts` |
| s1 Contract (Fable) | `voice-command@1`: rules file shared by both validators, the generator, the matcher and the help. Data: `{ app, forFramework?, source, generatedFrom?, wake?, commands: [{ id, title, effect, confirm, run { api?, mcp?, cli?, action? }, slots { name: { type, required?, options?, say?, default? } }, phrases, say?, help?, source? }] }`. Confirm floors: read / navigate never, write asks only for a missing slot, destructive always; a command may ask more, never less. Registered in `types.ts`, `validate.ts`, the build engine and `asset-types.json` (optional, never rolled, not shared); JSON Schema; fixture + `spec/check-voice-command.mts` (60 checks); PORTING.md (Kotlin twin deferred). Project rules `for-framework` (boolean) and `for-framework-noted` (warn while unset on an app); the Kotlin validator reads the same rules file. | `framework/core/engines/voice-command-rules.mjs` (+ `.d.mts`), `framework/schemas/asset-types.json`, `framework/schemas/project-rules.json`, `framework/spec/fixtures/voice-command.json` |
| s2 Automatic | `framework/cli/voice-commands.mjs`: `surface` (axf.commands.json + the app's plugins as MCP tool / REST / CLI + control@1 tools for the console + its own web actions), `generate --write` (authored commands kept), `check` (CI: a forFramework app's every command has phrases, names the command and the fix), `registry`, `help`, `say`, `fill`, `bake`; `axf voice …`. `axf init --for-framework` (default true inside this repo, false elsewhere; a forFramework app gets its asset at init), every template manifest carries the field, `deploy/claude-headless.sh` adds the rule to every brief, `BRIEF-TEMPLATE.md` says it. | `framework/cli/voice-commands.mjs`, `framework/cli/axf.mjs`, `framework/cli/build-engine.mjs`, `framework/templates/*/project.manifest.json`, `.github/workflows/android.yml` |
| s3 Molly | Console plugin `voice-commands`: `GET /registry`, `GET /help`, `POST /match`, `POST /run`, `GET /recent` → MCP `voice_commands_*` + CLI through plugin-commands@1; the flow (`say()`): match → pending question (missing slot: the answer fills it through `fill`; destructive: yes / no) → run (plugin commands and reads via plugin-commands@1, control@1 tools, console actions via console-commands@1, any console MCP tool such as `expenses_add` via the console's own `/mcp`) → answer (`say` template, result summary); audit `runs.jsonl`; capability `voice-commands@1`; page, dialog, mic (speech recognition), spoken answers, settings tab (mic, speak, language, allowed host origins), voice-bridge@1 postMessage bridge. `test.py`: 24 checks. Molly plugin `voice-control`: toolbar mic button, Molly menu entry, dialog (mic, text box, Yes / No, "what can I say in <app>?" chips), sends to the Console frame over voice-bridge@1 (opens it when needed, pings first), speaks answers, takes `utterance` messages a framed listener posts; capability `axf.voice@1`. | `apps/console-web/plugins/voice-commands/`, `apps/molly/plugins/voice-control/`, `apps/molly/src/assets/toolbar/molly.json` |
| s4 Apply | forFramework **true**: the framework (root), console, Molly, axHub web, AmberX, Walkthrough Studio, Expenses. **false**: the demo (untouched `axf init` output on an older baked framework) and the Android apps axhub-android, console (Android), Voice Vault (Android on hold; flip them when their command surface exists). Generated: console 899 (872 plugin commands, 7 control tools, 20 actions), AmberX 44, Molly 17 (its plugins' actions included), axHub web 8, Walkthrough Studio 5, Expenses 7 (from `apps/expenses/axf.commands.json`: add, edit, list, get, accounts, totals, export, with the MCP tools' parameters and the category vocabulary). | `apps/*/project.manifest.json`, `apps/*/src/assets/voice-command/<app>.json` |
| s5 Tests, PR, report | Checks below; PR #323; rule in `_claude/rules/RULES.md`; this report. | |

## What you can say (examples that match today)
- "expenses add dunkin 4.25 dining" → `expenses_add` {merchant dunkin, amount 4.25, category dining, date today}, runs at once.
- "expenses add 5 bucks at the packie dining yesterday" → merchant packie, amount 5, category dining, date yesterday.
- "add an expense" → asks "What is the merchant?", then "What is the amount in dollars?", then runs.
- "list expenses from yesterday", "totals by category", "show expense exp_12", "edit expense exp_12 amount 9.50", "export expenses json", "expenses accounts".
- "delete …" anywhere → "… Yes or no?" first.
- "what can I say in expenses?" → the list.

## Checks
| Check | Result |
|---|---|
| `npx -y tsx framework/spec/check-voice-command.mts` | 60 checks pass (6 asset files) |
| `node framework/cli/voice-commands.mjs check` | 6/6 forFramework apps covered |
| `python3 apps/console-web/plugins/voice-commands/test.py` | 24 checks |
| `apps/expenses`: `expenses-api.test.mts` + `expenses-grid.test.mts` | 17 + 7 |
| Molly `tsc --noEmit` + `vite build` | clean |
| Console `tsc --noEmit` (framework re-baked) + `vite build` | clean (pre-existing baked `plan/` errors aside) |
| `check-theme`, `check-controls`, `check-toolbars`, `help-coverage --check` (100%), `menu-reach` | pass |
| plugin-lifecycle loop, plugin-commands check, project fixtures, appearance / widgets / scale / hubstatus / model-policy / plugin-catalog | pass |

## Known gaps and notes
- **Gizmo:** there is no Gizmo app folder yet (build `gizmo-companion` is pending); Molly accepts a `voice-bridge@1` `utterance` from any framed app, so AmberX's listener / Gizmo can hand Molly what it heard once they post it. Molly's own mic uses the browser's speech recognition (Chrome / Android WebView); the text box is always there.
- **Matching is deterministic, not an LLM:** phrases come from command titles and ids plus "name value" tails; a free-text slot takes what is between the literals ("add 12 dollars groceries at market basket" makes the merchant "groceries at market basket"). Hand-tune an app's phrases by marking commands `"source": "authored"` in its asset; regeneration keeps them.
- **The console's asset is 400 KB** (899 commands) and ships in the console bundle like every `src/assets` file. If that weighs on phones, the next step is loading voice-command assets lazily (they are never slots).
- **Android apps and the demo** are noted `forFramework: false`; the rule warns an app manifest without the field, errors on a non-boolean.
- **Commands that only have a CLI line** (no MCP tool, console route or action) match but cannot run from the console; the answer says to declare one in `axf.commands.json`.
- **UI Review:** Molly's Say a command dialog is item r-20261104-1b7bca5f (group `app-voice-commands - Nov 4 10:54 AM`, waiting for Brett); the console Voice commands page follows in the same group.
