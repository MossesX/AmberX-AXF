# Remove UI Review as a gate

Build `remove-ui-review-gate-no-screenshots` (Opus, Nov 13 2026).
UI Review stays as optional feedback (items, Screenshots, Choices, approve / reject). Nothing waits on it any more:
no PR is held, no PR is kept as a draft for it, no build is required to submit screenshots.

## Before / after

| | Before (Nov 13, main 305ec2d5e) | After |
|---|---|---|
| `review.mjs state --exit-code` | exit 3 when waiting / changes / rejected | always exit 0; prints the state "(not a gate)" |
| `ui-review@1` capability | `holds()` true unless approved / none | `hold` / `holds` / `isHeld` always not held, reason `UI Review is not a gate (Nov 2026)`; new `gate()` |
| `GET state` | `holds` true when waiting | `holds: false`, `reason` |
| Merge queue (`notReady`) | "its screenshots wait for Brett in UI Review" kept a PR out | UI Review never keeps a PR out |
| Auto-land (`blockReason`) | reason `ui` blocked a landing | no `ui` reason; `land.mjs` never asks `ui-hold` |
| Push banner Merge / batch merge | 409 "held by UI Review"; held PRs skipped | never asks UI Review; `GET ui-hold` answers `{hold: ""}` for old scripts |
| "Wait for UI Review" (`landWaitUi`) | on by default, switch in Settings | retired: always false, switch and help entry gone, old saved values ignored |
| PRs opened by Open PR / auto-land / merge queue | ready (no draft code existed) | ready, now asserted by tests |
| Claude setting *UI Review gate* (`builds.uiReviewGate`) | owner-only, default on | deprecated (new registry field `deprecated`): always false, refused for everyone, `[deprecated]` in `claude-settings.mjs get`, `deprecated` in `claude_settings_get`, greyed in Settings → Plugins → Claude |
| Splitter | rules told builds to add UI Review steps | prompt says never add one; `parseSplit` drops a UI-Review-only step (`uiReviewOnlyStep`) |
| UI rules brief (`rules-briefs.json`) | "UI changes go to UI Review before the PR is called ready" | "UI Review is optional feedback, not a gate … Open the PR ready for review." |
| Store | 3 open UI-Review-only steps in live builds | skipped, note "UI Review no longer a gate", journalled (rev in `_claude/builds/journal/2026-11-p6.jsonl`, action `ui-review-steps`), on main via builds-live |
| Launcher (`claude-headless.sh`) | queued a UI build for look approval (exit 4), refused a rejected look (exit 3) | `ui-predict.mjs gate` always exits 0; verdict logged; predictions still made |
| UI Review page / settings | "Approvals · N waiting", "waits here for your OK", *Wait for my look approval* switch | "Feedback · not a gate", "No PR or build waits on it", read-only *Not a gate* panel reading the gate API |
| Rules | shared RULES "Every UI change goes to UI Review" + options rule hold | "UI Review is optional feedback, not a gate"; options apply only when a build chooses to submit; decision in `memory/decisions.md` |

Kept as they were: review items, Screenshots, groups, Choices, approve / Ask changes / Reject, predicted looks
(still made, now feedback), the options intake (a submission still needs 3 options or `--single-option`; submitting
at all is optional), `check-ui-review.mjs` (schema / fixtures).

## API (Everything comes with an API)

The one new UI piece is the read-only *Not a gate* line in Settings → Plugins → UI Review. Its state, everywhere the same object
`{ $axf: 'ui-review-gate@1', gate: false, since: '2026-11-13', why: 'UI Review is not a gate (Nov 2026)' }`:

- REST: `GET /api/plugins/ui-review/gate`
- MCP: plugin command `ui_review_gate` (plugin-commands@1 id `gate`; also `ui_review_action_gate`)
- CLI: `node apps/console-web/plugins/ui-review/review.mjs gate [--console] [--json]`
- Voice / console action: `ui-review.gate`
- Deep link: `console_show` target `ui-review` (unchanged); the panel lives on the UI Review settings tab.

`apps/console-web/plugins/ui-review/test.py` checks all four return the same object. The retired setting is read
through `claude_settings_get` / `claude-settings.mjs get` (reported deprecated).

## Checks run (s12)

ui-review test.py 234 ok, test.mts 30 ok · push-banner test.py 179, land.test 98, merge-queue.test 18 ·
build-orchestrator pipeline.test 48, test.mjs 35, test.py 41 · claude-settings test.mjs 50, test.py 21 ·
check-ui-predict 12 · check-headless-context 38 · check-ui-review 68 · check-build-steps 44 · check-builds-store 40 ·
builds-store verify ok · tracker --check ok · check-theme, check-controls, check-toolbars, check-chrome-assets ok ·
plugin-commands check ok · console `tsc --noEmit` clean · plugin-lifecycle: no new stale references (the remaining
ones are older copies under `apps/*/_claude/shared/` and untracked session files).

## Notes

- No draft-PR code existed: the "draft until UI Review" practice lived only in the rules and session habits; s4 added
  tests that every PR the console opens is ready.
- `claude-sync sync` ran: this fresh worktree has no sync base, so 115 `_claude` files are held "new on both sides"
  for amberx-axf. The hub's copies of `shared/rules/RULES.md` (Nov 6) and `memory/decisions.md` (Nov 3) are older and
  have none of the UI Review rules, so nothing was forced; the repo copies land with this PR.
- Screenshots: none taken; UI Review is not a gate and the change is wording plus one read-only panel.

## Inventory (s1): every place UI Review acted as a gate

Line numbers are from `main` at 305ec2d5e, before this build.

### UI Review plugin (the gate's source)
- `apps/console-web/plugins/ui-review/review.mjs:17,32,238` — `state --exit-code` exits 3 when the branch / PR is held.
- `apps/console-web/plugins/ui-review/web/review-core.mjs:195-204` — `stateOf()` sets `holds: state !== 'none' && state !== 'approved'`.
- `apps/console-web/plugins/ui-review/server/__init__.py:12,19,231` — `GET state` returns `holds`.
- `apps/console-web/plugins/ui-review/server/__init__.py:324-388` — capability `ui-review@1` `holds(branch, pr)` (read by the push banner).
- `apps/console-web/plugins/ui-review/web/review-core.d.mts:19` — `ReviewState.holds` type.
- `apps/console-web/plugins/ui-review/test.mts:148,181-184` — tests asserting exit 3 / "waiting (holds the merge)".
- `apps/console-web/plugins/ui-review/test.py:147-148` — test asserting `svc.holds("claude/t") is True`.
- `apps/console-web/plugins/ui-review/README.md:160-167` — "State for other plugins" and "Merges wait for UI Review".
- `apps/console-web/plugins/ui-review/plugin.json:9` — description "comes here for Brett's approval".

### Merge queue / auto-land / push banner (the hold)
- `apps/console-web/plugins/push-banner/land/merge-queue-core.mjs:54,58,68` — `notReady()` returns "its screenshots wait for Brett in UI Review" / "UI Review holds it" when `waitUi && pr.ui`.
- `apps/console-web/plugins/push-banner/land/merge-queue.mjs:15,51,185,187` — `waitUi` config and the `ui-hold` fetch per PR.
- `apps/console-web/plugins/push-banner/land/land-core.mjs:9,11,18,157,171-173` — `LAND_DEFAULTS.landWaitUi`, the `ui` reason.
- `apps/console-web/plugins/push-banner/land/land.mjs:9,33,151,321,354,372,405` — `landWaitUi`, `ui-hold` fetch, PR body "UI Review doesn't hold it".
- `apps/console-web/plugins/push-banner/server/__init__.py:49,56-60,115-116,224-225,237,254,377` — `landWaitUi` setting and docs.
- `apps/console-web/plugins/push-banner/server/__init__.py:801-812` — `ui_hold()` (asks `ui-review@1`; an error counts as held).
- `apps/console-web/plugins/push-banner/server/__init__.py:814,837-839` — Merge refuses 409 "held by UI Review".
- `apps/console-web/plugins/push-banner/server/__init__.py:909-934,967` — batch merge skips held PRs.
- `apps/console-web/plugins/push-banner/server/__init__.py:1457-1460` — `GET /api/plugins/push-banner/ui-hold`.
- `apps/console-web/plugins/push-banner/web/ui.tsx:476,486,493-494` — "Wait for UI Review" switch.
- `apps/console-web/plugins/push-banner/help.json:101-103` — help for "Wait for UI Review".
- `apps/console-web/plugins/push-banner/test.py:647` and `land/*.test.mjs` — fake `ui-review@1` and hold cases.

### Draft PRs for UI Review
- No code opens a PR as a draft for UI Review or un-drafts on approve: the PR creators
  (`push-banner/server/__init__.py:792`, `land/merge-queue.mjs:322`, `land/land.mjs:354`, `framework/cli/rebake.mjs:130`)
  all open ready PRs. Drafts are only skipped by the queue (`server/__init__.py:609,614,835,917`), which stays (a draft
  made by hand is still not ready). The "draft until approved" practice lived only in the rules (below).

### Claude setting "UI Review gate"
- `apps/console-web/plugins/claude-settings/registry.json:49-50` — `builds.uiReviewGate` (owner-only, default true).
- `apps/console-web/plugins/claude-settings/test.mjs:28` — listed among owner-only keys.
- `apps/console-web/server/mcp_server.py:660` — `claude_settings_set` doc names "UI Review gate" as owner-only.
- `CLAUDE.md:10` and the claude-settings rule in `_claude/shared/rules/RULES.md` — list it as owner-only.
- No code reads `builds.uiReviewGate` to change behaviour (its only effect was the rule text).

### Launcher / look gate (a UI build held before it starts)
- `deploy/claude-headless.sh:242-256` — `ui-predict.mjs gate`: exit 4 queues the build until Brett approves its predicted look, exit 5 (rejected look) refuses to start it.
- `framework/cli/ui-predict.mjs:15,189-201,229-232` — the gate verdict (go / wait / held).
- `apps/console-web/plugins/ui-review/web/look-settings.tsx:8` — "Wait for my look approval before UI builds start" setting.

### Splitter, briefs and rules that add UI Review steps
- `apps/console-web/plugins/build-orchestrator/pipeline-core.mjs:362-376` — `splitPrompt()`: no UI Review wording itself; the step comes from the rules the splitter and builds follow.
- `apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs:273` — brief line on non-approval screenshots (kept: Screenshots stay).
- `framework/schemas/rules-briefs.json:13` (+ app copies under `apps/*/src/axf/schemas/rules-briefs.json`) — "UI changes go to UI Review before the PR is called ready … Say in the PR that it is waiting there."
- `_claude/shared/rules/RULES.md:25` — "Every UI change goes to UI Review" (hold via `ui-review@1` / `--exit-code`), plus the options rule ("the build waits like any UI Review hold", "Intakes refuse a build's submission with neither").
- `framework/core/build-pipeline.mjs:12,161` — "stopped on purpose: UI Review wait" in the status docs.
- `framework/spec/check-headless-context.mjs:68-72` — fixture text uses the rule title (test data only).
- `_claude/builds/store.json` — 103 open steps across builds mention UI Review or screenshots (s8 skips the ones whose only job is submission).

### Checks that require screenshots
- `framework/spec/check-build-steps.mjs` — no UI Review rule (nothing to change).
- `.github/workflows/*.yml` — no `review.mjs state` step; `android.yml:115` runs `check-ui-review.mjs` (schema / fixtures only, not a gate). `rebuild-shots.yml` is manual (workflow_dispatch).
- `framework/cli/rebuild-shots.mjs:105-119` — `--submit` is opt-in; it only fails when asked to submit.
- `framework/schemas/build-defaults.json` — no UI Review requirement.
