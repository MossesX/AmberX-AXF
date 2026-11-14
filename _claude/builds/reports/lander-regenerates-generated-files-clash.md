# Lander regenerates generated files on a clash

Build `lander-regenerates-generated-files-clash`. Brett (Nov 13 2026): "the voice control still isn't done; land what's completed"

## Phase 1 (s1, Fable): merged as PR #661
- `framework/spec/generated-files.json` (`generated-files@1`) lists every generated or additive file with its merge rule (`regen`, `union-json`, `union-lines`, `main`), its generator and the tests that run after it.
- Auto-land, the merge queue (`push-banner/land/`) and `vps.build_land` (`framework/cli/land-resolve.py`, which `/opt/axf-batch/resolve.py` hands over to) all take main's side for a generated file, run its generator on the merged tree, union catalog/help/PORTING.md, and stop only on a real source clash.
- `land.mjs merge-main <build>` re-lands one build on demand.
- Re-lands from s1: #648 and #647 have since merged. #621, #620, #638 and #653 were merged with main and are waiting in the queue. #579, #617 and #626 have real code clashes and their resolve builds carry them.

## Phase 2 (s2): voice control
Full voice control was still not on main. #645 had been superseded by #655, and #655 was red: its light check failed in console tsc (`VetoHost.overlay` / `overlayCommand` were missing from the main it was based on). It was also 707 commits behind main.

This branch now holds #655 merged with current main:
- The clashes were additive only: the voice engine's phrase header (`framework/core/engines/console-control-voice.mjs` and its baked console copy) and the phrase list in `framework/spec/gen-fixtures.mts`. On both sides: field typing, screen read-back and decisions from the voice build, and axHub skin lock/override from main. Both sides were kept.
- `framework/spec/fixtures/console-control-voice.json` regenerated (main's side + gen-fixtures). A second regeneration showed no drift.
- Main now carries `VetoHost.overlay`, so the tsc error is gone.

## Tests
- `node framework/cli/ci-scope.mjs light --run` (the PR light check, including console-web rebake + `tsc --noEmit`, theme / controls / toolbars checks): pass.
- `apps/console-web/server/tests/test_console_control.py`: 11/11 (REST, guards, plugins, voice, MCP, New project form, owner-only decisions).
- `check-console-control`: pass. `land.test.mjs`: pass.
- Spot check: "Lock the console to the axHub skin", "type My New App into the project name field", "approve" and "what can I say" all parse to the right intents in the merged engine.

## API
No UI changed. Voice control is reached as #627/#645 describe: REST `/api/console-control` (`/screen`, `/fields`, `/fill`, `/do`, `/audit`), MCP `console_control_*`, CLI `axf console read | fill | press | type | audit`, AmberX voice.

## Open
- This PR supersedes #655, #645 and #627. Those can be closed once it lands.
- The Kotlin twin of the voice engine is still deferred (PORTING.md).
