# Plugin removal check, part 10: designers and wizards

Build `emergency-check-can-these-plugins-`, step s10. Report only: nothing was deleted or changed.

Plugins audited: `demonstration-designer`, `molly-guide`, `snapshot-manager`, `project-wizard`
(all under `apps/console-web/plugins/`). Checked against `main` at `f405aa4be`.

## Verdicts

| Plugin | Verdict | What depends on it (file:line) | What to move, and where |
|---|---|---|---|
| `demonstration-designer` | **SAFE** | No import, route call or capability lookup from kept code. The only reader of its capability `service:demonstrations@1` is the glossary catalog, which scans manifests and skips a missing provider: `apps/console-web/plugins/glossary-index/catalog.mjs:295` (glossary-index is itself on the removal list). | Nothing to move. `framework/core/engines/demo-rules.mjs` (demonstration@1) is framework code and stays. Clean up with the removal: see "Lines to clean up". |
| `molly-guide` | **SAFE** (one feature goes with it) | No import and no caller of its `/ask` or `/walkthroughs` routes anywhere in the repo. It is the only thing that shows the walkthrough block Gizmo's skill writes: `apps/console-web/plugins/agent-manager/addons/gizmo/addon.json:86` (skill `gizmo.walkthrough`, referenced at `:66`, `:200`, `:366`) and the old Molly add-on `addons/molly/addon.json:84`, `:364`. | Nothing to move. Retire the `gizmo.walkthrough` / `molly.walkthrough` skills in the same removal build, or Gizmo keeps answering "show me how" with a raw JSON block nobody renders. |
| `snapshot-manager` | **KEEP** | Sole provider of `axf.snapshots@1`. Container access refuses every approved change without it: `apps/console-web/plugins/container-access/server/service.py:460-462` (apply) and `:563-565` (undo). The agent manager refuses to propose container changes: `apps/console-web/plugins/agent-manager/server/containers.py:121-122`; status flags at `containers.py:78` and `container-access/server/__init__.py:51`. Container access's end-to-end test loads the real provider: `container-access/test.py:431-439`. | If the Snapshots settings tab must go, move first: `server/snapshots.py` plus the `plugin_services.provide("axf.snapshots@1", ...)` line (`snapshot-manager/server/__init__.py:23`) into `container-access/server/`, and its data folder with it. Otherwise leave it. |
| `project-wizard` | **MOVE FIRST** (small) | The voice command "create a new project" runs its `/run` route: `apps/console-web/plugins/wake-listener/catalog.mjs:68` (phrasebook entry `project-wizard/run`). Wake listener's self-test asserts that entry against the real registry: `wake-listener/test.mjs:108`, `:117`, `:119`, `:158`, `:172`. Help registry entry: `apps/console-web/src/assets/help/console.json:240` (source `_claude/builds/help-src/console.py:43`). Nothing imports `wizard.mjs`. | Pick one. Cheap: drop the phrasebook entry and those five asserts, and the help entry, and voice project creation goes away. Keep it: move `wizard.mjs` (the engine, on top of `framework/cli/claude-project.mjs`) to `framework/cli/` and re-point the voice entry at it. Also move or delete the stray legacy store, see below. |

## Evidence

### demonstration-designer
- Manifest: provides `view:demonstration-designer`, `settings-tab:demonstration-designer`, `service:demonstrations@1`; optional `axf.speech@1`; 18 commands (MCP `demonstration_designer_*`); data dir `.axf-console/plugins/demonstration-designer`; env `AXF_DEMO_DESIGNER_DIR`, `AXF_FFMPEG`.
- Its own imports reach out only to `framework/core/engines/demo-rules.mjs` (`demos.mjs:29`). Nothing reaches in.
- `plugin_services.get("demonstrations@1")` is called nowhere; the capability is only matched by manifest in the glossary catalog.
- No hits in `deploy/`, `services/`, `framework/cli`, `framework/core`, `framework/python`, the console server, or other apps.
- Live data on the VPS: 4 small files, two saved demos from Nov 12 (`pitch-home-3m`, `pitch-build-orchestrator-5m`). No recordings. No Postgres table.

### molly-guide
- Manifest: provides `tab:molly.walkthrough`, `settings-tab:molly-guide`; data dir `.axf-console/plugins/molly-guide`; `opens: false`.
- Server (`server/__init__.py:108-122`) asks Gizmo through `axf.agents@1` `run_task` and keeps the last 20 walkthroughs. It consumes the agent manager; the agent manager does not consume it.
- The manifest says AmberX's server asks through `/ask`. No such caller exists in this repo any more (no `plugins/molly-guide` string outside the folder, docs aside).
- Mentions in agent notes and a job brief are prose only: `agent-swarm/agents/notes/rhonda.md:1`, `agent-swarm/agents/skills/walkthroughs.md:8`, `framework/assets/job-type/amberx-walkthrough.json:44` (copy at `apps/phone-connect/app/src/main/assets/axf/assets/job-type/amberx-walkthrough.json:44`), `glossary-index/terms.json:19`.
- Live data: one 798-byte `walkthroughs.json` from Nov 12. No Postgres table.

### snapshot-manager
- Manifest: provides `settings-tab:snapshots`, `service:axf.snapshots@1`; requires `service:axf.containers@1`; data dir `.axf-console/plugins/snapshot-manager`; env `AXF_SNAPSHOT_MANAGER_DIR`.
- Three plugins declare the capability as optional: `container-access/plugin.json:12`, `agent-manager/plugin.json:22`, `feature-assist/plugin.json:12`. Optional in the manifest, but hard in behaviour: container-access raises `PermissionError` and writes nothing.
- `feature-assist` only reports whether it is present (`feature-assist/server/__init__.py:91`), and is on the removal list anyway.
- Live data: zero snapshots stored on the VPS. The guard has never been exercised live, but removing the provider still switches off every approved container change.
- Nothing in `deploy/` or `services/axf-data` uses it. The planned `snapshots` Postgres table is only a line in `framework/spec/DATA-INVENTORY.md:160`; it does not exist yet.
- Its manifest lists `CLAUDE.md` under `lifecycle.mentions`, but `CLAUDE.md` no longer names it (stale mention, harmless).

### project-wizard
- Manifest: provides `view:project-wizard`, `settings-tab:project-wizard`; scopes `ROUTES`, `FILES`, `NETWORK`; data dir `.axf-console/plugins/project-wizard`; env `AXF_WIZARD_STORE`, `AXF_WIZARD_WORKSPACE`, `AXF_WIZARD_ROOTS`.
- The server runs `wizard.mjs --json` as a subprocess (`server/__init__.py:28,46`); `wizard.mjs` imports `framework/cli/github.mjs` (`wizard.mjs:32`). Both framework files stay.
- Wake listener degrades by design ("an id whose plugin is not installed yields no entry", `wake-listener/catalog.mjs:14`), so the console keeps running without it. Its `test.mjs` is not in CI, but it would fail locally at `:108`. `wake-listener/test.py` uses a fixture and is unaffected.
- Stray data: the live store is still the legacy file `/opt/axf/.axf-console/project-wizard.json` (1 project record, Oct 21), outside the plugin's data dir. The plugin only moves it on its next save (`wizard.mjs:86-88`), so the uninstaller will not remove it. Delete it by hand or let the wizard save once first. `framework/spec/DATA-INVENTORY.md:124` lists the same file.
- Plan notes that mention reusing the wizard are plans only, nothing built: `apps/console-web/src/axf/plan/pending.json:472`, `:547`, `build-queue.json:811`.
- No Postgres table. Nothing in `deploy/` or `services/`.

## Lines to clean up when any of these is removed

The lifecycle check passes for all four today (`node framework/cli/plugin-lifecycle.mjs check <folder>`: clean). `uninstall --all` removes the folder and the marked lines. These need a hand or a regenerate:

| File | Lines | Plugins | Note |
|---|---|---|---|
| `framework/spec/token-manifest-baseline.json` | 8, 9, 11 | all four | CI fails if an exempt folder is no longer a plugin (`framework/cli/token-registry.mjs:260`). Drop the entry. |
| `framework/spec/fixtures/page-toolbar-voice.json` | 30 entries from `:386` | `demonstration-designer` | Regenerate: `npx -y tsx framework/spec/check-page-toolbar-voice.mts --write` (checked in CI, `.github/workflows/android.yml:329`). |
| `.github/workflows/android.yml` | 223-224, 237-238 | `project-wizard`, `demonstration-designer` | Marked `# axf-plugin:<folder>`; the uninstaller removes them. |
| `framework/spec/json-data-writes.baseline.json` | 29, 30, 40, 48, 55 | all four | Ratchet counts; a leftover line is harmless (`framework/cli/plugin-lifecycle.mjs:53-55`). |
| `apps/console-web/plugins/README.md` | 15-17, 23, 78 | `project-wizard`, `snapshot-manager`, `demonstration-designer` | Doc lines. |
| `_claude/memory/STATUS.md` | 10, 50, 73 | `demonstration-designer`, `project-wizard`, `snapshot-manager` | Doc lines. |
| `framework/spec/DESIGN-LANGUAGE.md` | 149-150 | `project-wizard`, `snapshot-manager` | Prose list. |
| `framework/spec/PORTING.md` | 339-343 | `molly-guide` | Web-only note; mark retired. |

Plugin Python tests, toolbar tests and `test.mts` files are found by glob in CI (`.github/workflows/android.yml:460-474`), so removing a folder does not break those jobs.

## Not checked

- No tests were run and no removal was dry-run; this is a read of the code and a grep of the repo.
- History files (`changes/`, `sessions/archive/`, `_claude/builds/shipped/`, `_claude/handoff/`, `_claude/THREADS.md`) name all four plugins. They are records and were not treated as dependencies.
- Whether the AmberX phone app, which lives outside this repo, still calls `molly-guide`'s `/ask` route was not verifiable from here.
