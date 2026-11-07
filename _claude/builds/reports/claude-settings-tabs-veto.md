# claude-settings-tabs-veto

Build on Opus, Nov 7 2026. Branch `claude/claude-settings-tabs-veto`.

## Result

- **Done:** views (classic + tabbed), Approvals & veto tab, REST / MCP / CLI, tests, README, contract.
- **Not done:** step s4, axHub's policy API. It is a new cross-app protocol, so it is pinned to Fable.
- **Effect today:** the policy table shows "axHub doesn't have the policy API yet". Nothing about live veto behaviour
  has changed. Brett's "no 90 s veto unless VPS writes" takes effect only after s4 lands and he clicks Apply.

## Why s4 stopped

axHub has no route to change tool policy: only its in-container CLI (`axhub services tool-policy`). The alternatives
were rejected on purpose: shelling into the hub container or writing its store would let a session change the policy
that gates sessions, which skips the owner-only rule. The contract is `framework/spec/AXHUB-POLICY-API.md` (proposed).

## Settings audit (31 settings, 7 groups, 5 tabs)

| Tab | Groups | Settings |
| --- | --- | --- |
| Approvals & veto | No wait, plus the tool policy and longest pass | 6 |
| Builds | Builds (8), Verification (1) | 9 |
| Talking | Talking | 7 |
| Notifications | Notifications | 6 |
| Follow & memory | Follow Amber (1), Memory and notes (2) | 3 |

A group no tab lists shows under Other, so data-only additions and the open PRs' new groups are never lost.
`notify.approvalWaiting` and `builds.fableUpgradeApproval` stay in their own groups.

## Changed

- `claude-settings`: `web/view-core.mjs`, `web/policy-core.mjs`, `web/approvals.tsx`, `registry.json` (`tabs`,
  `policyDefaults`), `core.mjs`, CLI, server, help, README. 0.1.0 → 0.2.0.
- `token-control`: capability method `pass_settings()`, so the tab reaches the longest pass without naming the folder.
- `mcp_server.py`: `claude_view_get`, `claude_view_set`, `claude_policy_get`, `claude_policy_plan_get`. No write tool.
- The seven per-group settings panels became one interface panel, because a panel can't be tabbed.

## Default plan

Hold list: `vps.run`, anything matching an account switch. It never loosens: denied stays denied, including unlisted
shell tools (SSH default-deny). Destructive, explicit-approval and owner-grant tools are left to the hub. Fixed
`vps.build_*` tools stay allowed (axHub decision 110).

**For Brett to decide:** the plan moves `vps.logs` to allow because it is a read, per "reads go without a hold".
axHub's decision 83 put logs behind approval because logs can hold secrets. Redaction runs on the output, but the
plan lists it so he sees it before applying.

## Tests

| Check | Before | After |
| --- | --- | --- |
| `test.mjs` | 47 | 84 |
| `test.py` | 21 | 35 |
| Browser run against mocks (real controls, DOM assertions) | none | all pass |

Theme, controls, chrome, toolbars, lifecycle, help coverage, plugin commands, `tsc` and the console build pass.
The full CI sweep was not run here; the merge queue runs it. Not tested against a real axHub: the policy table in
the shots is mock data, and the write path has only been tested against a fake.

## Known gaps

- The settings search no longer sees individual rows: the panel's own Find a setting replaces it.
- Level filtering (Simple / Basic…) was per panel, so it no longer narrows rows inside the interface.
- Android twin deferred (Android on hold).
- PRs #360, #362, #365 touch this plugin. #365 adds a `GROUP_PANELS` line that this build removes: resolve by dropping
  that line; its registry group appears by itself under Other or a tab.

## Overlap

`approvals-no-window-spam-on-approve-veto-only-for-vps-writes-and-account-switc`: its veto step (s2, duplicate s5-4) is
**not ticked**. The tool is built here but no live policy changed. Its pop-up step and rules step are untouched.
