# Remove Molly completely (console): report

Built together with `remove-old-molly-app-project-keep-axf` (branch `claude/remove-old-molly-app-project-keep-axf`,
PR #760): steps s1–s8 and s10 were done there; see `_claude/builds/reports/remove-old-molly-app-project-keep-axf.md` for
what was removed, what was kept (`axf-molly`, the gate's later backend) and the API surfaces that went away. This branch
is that branch plus main plus step s9. No UI was added, only removed.

## s9: guard and CI sweep (Nov 16 2026)

Guard: `framework/spec/check-no-molly.mjs`, run in CI (`android.yml`, after CI scope). It fails if any of these come back
in `apps/console-web`: the `plugins/molly-guide` folder, the `agent-manager/addons/molly` bundle, `_offer_molly`,
`mollyOffered`, `molly-guide` / `mollyGuide` mentions, or a file named after Molly. Allowed: `axf-molly`, the add-on
retirement on start (`RETIRED_ADDONS`) and its test, the systems check items that clean the old app's VPS leftovers, and
the build-breaker's generated ask history. It self-tests each way back on a scratch tree.

`plugin-lifecycle.mjs`: removal guards (`framework/spec/check-no-*.mjs`) and the dispatcher's local `.axf-*` session
files no longer count as stale references (the guard names the removed plugin on purpose).

Merged main into the branch: main had a newer systems-check test fix the old branch reverted (237/237 pass now), and a
new file under the removed `apps/molly` (dropped). `src/control/inventory.json` regenerated.

| Check | Result |
|---|---|
| check-no-molly | pass (3) |
| plugin-lifecycle check molly-guide --after-uninstall | clean |
| plugin-lifecycle check, every lifecycle plugin | clean |
| check-theme / check-controls / check-toolbars / check-chrome-assets | pass |
| glossary catalog --check | complete, 3697 entries, ratchet 388 |
| notify-control test.py | 133 pass |
| tracker --check | pass |
| agent-manager test.py | 178 pass |
| systems-check test.py | 237 pass |
| console server tests (test_console_control.py) | 8 pass |
| ci-scope | 10 pass |
| console typecheck + vite build | pass |
