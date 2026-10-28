# AmberX voice command center + Molly (Oct 28 2026)

## voice-command@1 (`apps/amberx-droid/src/plugins/commands/web/core.ts`)
- **Category** = a tab: `notes`, `tasks`, `developer`, `snippets`, each with trigger words ("note", "task", "dev", "ask"…). A sentence starting with a trigger only matches that tab; otherwise every tab is tried and the page on screen breaks ties (+3), a trigger +5, each literal word +10.
- **Command** = `{id, category, kind: action|chain|wizard, group, label, description, phrases[], steps[], slots?, optional?, settings?, defaultOff?, needsAi?, developer?}`. Phrases are patterns: words + `{slot}`.
- **Steps:** `action` (runtime spec), `intent` (notes core intent), `op` (ops.ts), `say`, `ask` (slot, question, kind, optional, choices), `confirm` (no stops), `wait`, `run` (another command), `ai` (prompt, `into` keeps the answer in a slot), `molly` (developer task). `cleanSteps` checks every step from settings or imports.
- **Overrides** (what a person changed, per command id): on, phrases, recordings (said twice, matched by `recordingsMatch`), settings (confirm, speak, reply, onlyOnPage), steps, label. Their own commands: `mine.*` (`parseCustom`).
- `checkLibrary`: unique ids, clean steps, every slot filled by every phrase / asked / optional, wizards ask, chains have 2+ steps, `run` targets exist. test.mjs runs it on the whole library.

## Runner (`runner.ts`)
Confirm setting first; asks out loud for wizard slots (cancel / back / repeat / skip); a step that uses a skipped slot is skipped; op/intent failures stop the chain and say why; `run` nests up to 4 deep. Developer commands need Molly reachable, AI commands need the AI on and answering.

## Molly
- Agent add-on `apps/console-web/plugins/agent-manager/addons/molly/addon.json` (agent-addon@1): persona + skills (codebase, app help, walkthrough, builds, GitHub, VPS, containers, console, DNS); tools axhub_call (dangerous, approvals on axHub), repo_*, container_* (write batch approved + snapshotted). Installed once on console start and added to Safety → dangerous agents (`_offer_molly`); an uninstall is respected.
- AmberX → `POST /api/ai/molly` (admins) → console `POST /api/plugins/molly-guide/ask` → `axf.agents@1.run_task("molly", …)`. Token: the AmberX installer copies `AXF_TOKEN` from `/opt/axf/.axf-console/env` into its 0600 server env (`AMBERX_CONSOLE_TOKEN`, URL `http://axf-console:7090`).

## walkthrough@1 (`apps/console-web/plugins/molly-guide`)
Molly answers "show me how" with one ```walkthrough``` JSON block: `{$axf, id, title, app, steps: [{say, do, target}]}`, 1–20 steps. `do` is a console action spec (no scripts, no links), `target` a data-axf-id / view id / CSS selector (no markup). Cleaned the same way in Python (`server/__init__.py`) and TS (`web/walkthrough.ts`). Kept in the plugin's data folder (last 20, with a sequence); the console window polls `/walkthroughs?after=<seq>` and opens new ones: each step runs its action, highlights its target and is read aloud; Next / Previous / Repeat / Close, arrow keys.
