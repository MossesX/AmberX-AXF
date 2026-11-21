# Fix main CI after Pipeline 2.0 (PR #852)

Run 44539449204 on `main` (a72ce1fa5, the #852 merge) failed in two jobs. Both failures came from #852 not updating generated files and declarations to match what it shipped. Each failed job stopped at its first error, so the steps after it never ran on main. Running those steps here found more #852 leftovers of the same kind, and they are fixed too. Otherwise main would go red again on the next step.

## Cause 1: Build engine sweep: `plugins.mjs --check`

In plain words: the new merge-queue plugin wrote its model as "Opus" with a capital O, and the schema only accepts lowercase.

- `apps/console-web/plugins/merge-queue-view/plugin.json`: `builtWith.model` "Opus" → "opus".
- Sweep: #852 added or changed the plugin.json of build-orchestrator, gate and merge-queue-view, and deleted push-banner's. merge-queue-view was the only one with a capitalised model name. No other plugin.json in the repo has one.

## Cause 2: Web Dev Console: "Alerts + MCP client + axf_server …"

In plain words: #852 deleted the push banner and its merge-queue toolbar on purpose, but the saved list of voice commands still had that toolbar's 7 buttons.

- The real error: `check-page-toolbar-voice.mts`, "the voice inventory matches the toolbar assets". The fixture `framework/spec/fixtures/page-toolbar-voice.json` still listed push-banner's merge-queue buttons (add, up, down, remove, run, ci, red). Merge queue 2.0 is read-only with no actions by design, so the contract changed on purpose. I regenerated the fixture with `--write`: 104 → 97 phrases. No code change.

## Further #852 leftovers in steps that never ran on main

All of these are generated or declared files that #852 did not update. Each is fixed with the generator or rule the check names.

| Check (job / step) | Problem | Fix |
|---|---|---|
| console / same step: token registry | merge-queue-view reads `--fx-space` but declared `tokens.uses: []`; the baseline still exempted the deleted `push-banner` | `token-registry.mjs manifest merge-queue-view --write`; dropped `push-banner` from `token-manifest-baseline.json` |
| console / same step: settings-iface | merge-queue-view provides `settings-tab:merge-queue` but shipped no default settings asset | `settings-iface.mjs defaults --write` → `assets/settings/default-merge-queue-view.json` |
| console / same step: help coverage | 3 new controls had no help (orchestrator "Account", "Show landed"; gate "Land by itself"), so coverage was 99.8% against a 100% ratchet | `help-coverage.mjs --draft console-web` (draft entries, like the 726 already there) |
| engine: `crew-say.mjs check` | `pipeline2.mjs` and `deploy/lander/run.mjs` (both new) posted to the crew chat with a section id held in a variable, which the owner check rejects | pipeline2: the two sections (`dispatcher`, `orchestrator`) written out. Lander: posts through the framework `crewSay('landing', …, { root: repo })`, the same way `deploy/console-nightly.mjs` does. Same section, same checkout, same `AXF_CREW_SAY=off`. |
| engine: `check-plugin-pages.mjs` | the Merge queue page head had no one-sentence description | added one |
| engine: glossary-index | the "Merge queue" term linked to the deleted `plugin:push-banner` | relinked to `plugin:merge-queue-view` |

Not changed, but noticed: pipeline2 posts `orchestrator` / `failed`, and the `orchestrator` section doesn't declare a `failed` event. That one chat line is dropped at runtime. It isn't a CI failure, so I left it alone.

## Local verification

All passing here:

- `node framework/cli/plugins.mjs --check`
- The whole "Alerts + MCP client + axf_server" step, Node and Python
- Every other `run:` step of the engine and console jobs, except those listed below
- The lander tests: 21/21

Environment-only failures on this VPS, each checked to be unrelated to the fix:

- **Node 20.20.2 here, Node 22 in CI:** `node --test '<quoted glob>'` (lander, watchdog), `--experimental-strip-types` (plugin `test.mts` loop) and `node:sqlite` (shipped-features) need Node 22.
- **Headless session env leaking into tests:** `AXF_BRIEF_ONLY_RUN` / `CLAUDE_CODE_DISABLE_CLAUDE_MDS` (meter lean mode) and `AXF_CLAUDE_ACCOUNT` (token-save test). They pass with a clean env.
- **Host data store:** the VPS's axf-data `mode.json` puts the builds store in cutover, so `check-builds-store.mjs` read the live journal. It passes with an empty `AXF_DATA_DIR`.
- **`claude-workers.test.mjs` "and the run ends" and 4 checks in `claude-login.test.mjs`:** they fail identically on the commit before #852, so they are not caused by it.
- **Shared `/tmp`:** a leftover `/tmp/sweep` from Nov 16 (template sweep; it passes in a private dir), and other sessions' `axf-cli-chat-*` folders (ai-assistant "chat folders removed").
- **Local gitignored files:** `.axf-focus.json` and `.brief.md` show as "stale references" in `plugin-lifecycle check`. A fresh checkout is clean.
- **Missing tools and build outputs:** `pip install` is blocked by PEP 668, but the deps were already present, so I ran those steps without it. There is no `shellcheck` and no `python` alias. `dist/`, `src/control/inventory.json` and the `ci-example` plugin are made by earlier CI steps; a placeholder `dist/` was used for the server tests and nothing generated is committed.
- **Not run here:** the Postgres axf-data step, the web app builds and theme swap, and the Android/Gradle jobs. The Android jobs passed on the failing run.
