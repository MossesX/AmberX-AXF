# Fix main CI, red after the s16 + s7 hand lands (fix-main-ci-red-after-s16-s7-hand-)

Built Nov 20 2026 on Fable. Steps s1–s4 each fixed main on their own branch; s5 merged them all into
`claude/fix-main-ci-red-after-s16-s7-hand---s5`, ran the checks and wrote this report.

## What broke
Run 44801650701 on `7f128689` (main) was red in two jobs after fable-full-audit s16 (`2598ea0`) and s7 (`7f12868`) landed on top
of "Archive and retire apps/axhub-web" (`9e617d788`). The axHub web app had folded into the console as six `axhub-*` plugins and
the checks that still described the old shape failed:

- **Build engine sweep (Node)** stopped at `check-plugin-catalog.mjs`: "axHub web plugins don't install into an app in this repo".
  The retirement took `into` off the axhub plugin kind but left the spec expecting an app-install into `apps/axhub-web/src/plugins`.
- **Web Dev Console** stopped at `check-token-registry.mjs`: `axhub-approvals/plugin.json` read 13 `--fx-*` tokens with no `tokens` block.

Both jobs stop at their first failure, so the later checks had not run on main since `6154cac83`. Five more were red underneath:
settings-iface (the six `axhub-*` plugins shipped no locked default settings interface), help coverage (eight new controls
without entries, console-web at 99.5%), no-json-data (the hub-pages relay appended to `hub-pages.jsonl` with a bare file write),
check-plugin-pages (the approval request page head had no one-sentence description) and check-theme (decision numbers written
`#104` / `#105` in `src/hubPages/test.mjs` read as hex colours once the file lived under the console's src).

## What changed
- `framework/spec/check-plugin-catalog.mjs`: asserts that no repo kind installs into an app (axhub and console both refuse
  `appPluginsDir`), and runs app-install / app-list / app-uninstall on a scratch kind with `into` registered for the test only, so
  the engine paths stay covered. 58 checks.
- `apps/console-web/plugins/axhub-approvals/plugin.json`: `tokens` block (token-registry@1) with the 13 tokens the UI reads,
  written with `token-registry.mjs manifest axhub-approvals --write`.
- `apps/console-web/plugins/axhub-{account,approvals,apps,handoff,passes,users}/assets/settings/default-*.json`: locked default
  settings interface for each plugin (settings-iface@1), written with `settings-iface.mjs defaults --write`.
- Help (help@1): entries for the Sign in on axHub button (console pack), the approvals log Pass filter, and the Passes page
  buttons and fields (Ran under a pass, Extend, Its calls, Service, Scope, Tools). Plain entries, not drafts; coverage back at 100%.
- `apps/console-web/server/hub_pages.py`: the relay log goes through `data_store.append_jsonl` (data-store@1 journal) instead
  of a direct `.jsonl` append; `DataStoreError` is swallowed like `OSError` was.
- `apps/console-web/plugins/axhub-approvals/web/ApprovalDetail.tsx`: one-sentence description under the request page title.
- `apps/console-web/src/hubPages/test.mjs`: decision numbers written without `#`.

## How the steps came together
The splitter cut Brett's request one line per step, so s1–s4 each fixed the same failures independently. s4 merged s2 and s3.
s5 merged s4, then s1, which clashed in three files (`axhub-approvals/help.json`, `axhub-passes/help.json`,
`check-plugin-catalog.mjs`): the same hunks, two wordings. The s4 side was kept in all three. s1's own additions (the request page
description, the decision numbers in the hub-pages test) merged cleanly.

## Tests (on the merged branch, the CI commands)
- `check-plugin-catalog.mjs`: 58 passed (was the crash)
- `check-token-registry.mjs`: 326 tokens registered, 300 read, manifests and fixture current (was the second red)
- `check-settings-iface.mjs` 25 ok · `help-coverage.mjs --check` console-web 1773/1773 · `check-help.mts` 285 checks
- `check-json-data-writes.mjs` none new · `check-plugin-pages.mjs` 62 heads ok · `check-theme.mjs` 1445 files ok
- `hubPages/test.mjs` 234/234 (via tsx) · `test_hub_pages.py` 22 · `test_data_store.py` ok · `check-data-store.mjs` 68 ok
- `axf.mjs validate --framework` 599 assets · `tracker.mjs --check` · `plugins.mjs --check` · `check-plugin-settings` ·
  `check-controls` · `check-console-control` · `check-skin-coverage` · `check-component-tokens` · `check-asset-overrides` ·
  `check-plugin-commands` 59: all pass

Not run locally: the console vite build and the full sweep; the lander's PR run covers them.

## Notes
- Pushing the branch queued no CI run (workflows run on PRs and in the merge queue), so the lander's PR run is the green that counts.
- `builds-live.mjs link` first failed in this worktree: its data root `/projects/amberx-axf/_data/builds/worktrees/<worktree>/`
  did not exist (the s1–s4 worktrees had theirs). Created empty like the siblings' and the link went through.
- `tracker.mjs --check` run plainly in this worktree flags one item without a status: the local data-store copy of
  `framework/catalog/status.json` is behind the repo. With `AXF_DATA_DIR=off` (what CI sees) it passes.

## Found underneath (s2): the builds store verify was red on main too
`node framework/cli/builds-store.mjs verify` (Build engine sweep, after the catalog check) failed on main at HEAD with
`✗ all pending windows-terminal step`: step s7 of the archived build `windows-terminal` read "snapping ��� screen edges" in
`_claude/builds/store.json` while the pending export still had the em dash. The replacement characters arrived with the bulk
"Builds live: 1021 build change(s)" publish (`dfa865375`, journal rev 10219, a foreign-write absorb), after `7f128689`; the
store at `7f128689` was clean, so the hand-landed run never saw it. The same kind of damage sits in three fields verify does
not read (two `origin.brief`s, one `removedSteps` text): the writer that produces U+FFFD on the publish path is still open.

Fix: `builds-store.mjs restore windows-terminal 10101` (the last clean journal revision, build rev 32) through the live store;
builds-live published it as `6e87241b9`. `verify` on origin/main in CI's local mode: 39874 checks, everything from the old
files is in the store.

Also seen on this VPS, not in CI: `check-builds-store.mjs` ("history reads the journal home") and `check-agent-slots.mjs`
read the live axf-data store / the session's dispatch token through the environment; both pass with a clean environment.
`check-build-hook.mjs` needs a larger heap under load (`--max-old-space-size=6144`, as the other sessions run it).
