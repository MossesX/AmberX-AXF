# Land audit steps s3 to s18 (hand build `land-audit-s3-s18`)

Brett, Nov 21 2026: "We need to land those. Why are we not working on those? Those were all lined up to be merged in a
certain order."

Hand build, launched on the VPS outside the orchestrator, on Fable. One PR: **#880**, branch
`claude/land-audit-s3-s18`. It is merged by this build once CI is green (Brett's instruction for this build); the merge
commit is recorded on the Plan Studio 2.0 item "Land audit steps s3 to s18 (hand build land-audit-s3-s18)" and in the
PR.

## State of every step before the landing

Checked on Nov 21 against `origin/main` at 3106e932d: is the branch tip an ancestor of main, and how many of its commits
does `git cherry` still find missing.

| Step | Branch tip | On main | Commits missing | Note |
| --- | --- | --- | --- | --- |
| s1 | 291665608 | yes | 0 | lander PR #861 |
| s2 | dafb3489d | yes | 0 | lander PR #862 |
| s3 | 1ba879a09 | no | 1 | lander PR #863, open and stalled |
| s4 | 30fd789c1 | no | 1 | |
| s5 | d1701202b | no | 1 | |
| s6 | 7f3d1c274 | no | 6 | local branch also held a merge of main (34126be63), no extra work |
| s7 | 7f1286891 | yes | 0 | landed by hand |
| s8 | 658efb07b | no | 11 | |
| s9 | 4e7facf49 | no | 1 | |
| s10 | d51adb9b3 | no | 1 | |
| s11 | 736b4ef96 | no | 22 | remote tip = local tip 71393760f plus a merge of s8 |
| s12 | 1197eac63 | no | 1 | |
| s13 | 315254d97 | no | 1 | remote tip = local tip a31442355 plus a merge of main |
| s14 | 3a4c40d91 | no | 1 | report only |
| s15 | 81bbbd31c | no | 2 | remote tip = local tip b1490fc9f plus a merge of s4 |
| s16 | 2598ea02b | yes | 0 | landed by hand |
| s17 | b59aeb5b2 | no | 6 | |
| s18 | 2d555dd46 | no | 1 | |

The brief's list was right: s1, s2, s7 and s16 were on main; the other fourteen were not.

## The integration branch

`wip/audit-s4-s18-integration` (8abb2a3c9, never pushed) was sound and was used as the start:

- every step branch tip (local and remote) is an ancestor of it, and `git cherry` finds no step commit missing from it;
- it starts from s18's commit, merges the lander branch of PR #863 first (main of Nov 20 plus s3 and its three "Main
  green" fixes), then s4, s5, s6, s8, s9, s10, s11, s12, s13, s14, s15, s17 in that order, so s3 is already in its
  place;
- four follow-up fixes sit on top: AppShell opens a view at its top without `scrollTo`, check-design-package knows the
  new Amber menu order, the axHub pages join the System section of the side navigation, and the gate token manifest and
  skin-config schemas are regenerated.

It was 73 commits ahead of main and 253 behind. This build merged it onto current main in one merge commit (08841d739).

## Clashes with main

Nine files clashed. Main's pipeline repair work (parts A, B, F, G, emergency slots #868, status styles #877, watchdog
#879) wins where the two met; the audit change went back on top only where it still made sense.

| File | Clash | Settled as |
| --- | --- | --- |
| `framework/cli/build-limit.mjs` | s13 (ghost slots) against emergency slots #868, six places | main's two pools stay as they are; s13's `notABuild` and the "not counted" list (`ignored`) are re-applied on top in the count, the snapshot, `usage` and `status` |
| `apps/console-web/plugins/build-orchestrator/web/StatusTable.tsx` | s8's phone meta row against main's emergency badge | main's badge, inside s8's `st-rowmeta` row |
| `apps/console-web/plugins/plan-studio-2/web/ui.tsx` | one import line: s11 added `VIEW`, main added `sendToEmergency` | both |
| `apps/console-web/server/main.py` | s6 and main each added the device-route exception to the wall's token gate | main's version (same behaviour, main's names) |
| `apps/console-web/plugins/axhub-approvals/help.json` | drafted help on the #863 branch against written help on main | main's |
| `apps/console-web/plugins/axhub-passes/help.json` | same | main's |
| `apps/console-web/plugins/axhub-approvals/web/ApprovalDetail.tsx` | two wordings of one sentence | main's |
| `framework/spec/check-plugin-catalog.mjs` | two fixes of the same test (axhub kind has no app folder) | main's scratch-kind test |
| `framework/spec/PORTING.md` | both sides appended deferred entries | both kept |

Nothing under `deploy/lander/` or `framework/core/pipeline-status.mjs` is changed by this PR.

## Checks

- The console builds from the merged branch (`npm ci && npm run build` after the re-bake).
- CI: the PR run gives the light checks only (merge queue on), so the full workflow was also dispatched on the branch.
- On the VPS itself two checks cannot be judged: `tracker.mjs --check` and `spec/check-builds-store.mjs` read the
  host's live data folder and its cut-over store. `check-builds-store.mjs` fails the same way on untouched main here
  (`AXF_DATA_URL is unset`), and `tracker.mjs --check` passes with the host data off. Both are left to the CI runner.
- Not fixed here, same on main: the committed `tracker.json`, `framework/plan/plan.json`,
  `framework/catalog/libraries.json` and the baked copy `apps/console-web/src/axf/` are older than what the tools
  write today.

## UI Review

Group **"land-audit-s3-s18 - Nov 21 3:45 PM"**, waiting for Brett:

| Item | Steps | Shots |
| --- | --- | --- |
| `r-20261121-ts5kg01` AmberX skin, day and night: Home and Settings | s8, s12, s18 | 8 (desktop and phone) |
| `r-20261121-38qhk01` Amber context menu: quick actions on top, Search anywhere at the bottom | s10 | 2 (desktop and phone) |

Taken from an offline preview of the merged branch (cards that read live data show a 503 line). The session holds no
console token, so the items were written with the UI Review CLI inside the console container.

Steps that still need shots:

- **s9** side navigation: the offline preview shows the menu bar, not the side navigation layout; needs a signed-in
  console.
- **s11** shared toolbar on plugin pages (Builds, Notes, Todos, Plan Studio 2.0, Skins, Demonstration Designer,
  Sessions, Theme editor and the others it moved): needs live plugin data.
- **s17** AI assistant chat and conversation list: needs a signed-in console.
- **s8** per-screen spacing fixes beyond Home and Settings: its own six items already wait in group
  "fable-full-audit-ui-overhaul-conso - Nov 20 11:07 AM".

## After the merge

- Lander PR #863 closed with a note pointing at #880.
- Audit build `fable-full-audit-ui-overhaul-conso` stays archived; its steps are marked in the builds store with the
  PR that landed them.
- Not done on purpose: this hand build has no record in the builds store (it was launched outside the orchestrator),
  so `builds-live link` has nothing to link; Plan Studio 2.0 carries the record instead.
