# Build report: approvals-page-auto-approve-toggle-1-h-2-h-until

Branch `claude/approvals-page-auto-approve-toggle-1-h-2-h-until` · Opus · Nov 9 2026.

## Brett said (verbatim)

> Add a slot and approve everything automatically. Add one hour, two hours, and until I turn it off, and it needs to be able to be turned off on that same container. And um, it also we need collapsible campaigns on the approval page. The w rating page.

> Yeah, I don't want to have to tap approve every time. ... I want to be able to change 90 seconds to like zero seconds.

## What shipped

### Console (approvals banner)
- **Approve everything automatically** container on the approvals banner: **1 hour**, **2 hours**, **Until I turn it off**. It shows the time left (or "On until you turn it off"), and **Turn off** sits in the same container. While it is on, every call axHub holds runs at once instead of waiting on the 90 s countdown, and every console command skips the veto.
- It is the console's existing `all` veto pass (control-pass@1). **Until I turn it off** is an `all` pass granted with `until_off: true`. Each read of the pass store renews it to the longest allowed pass (240 min by default) once less than half is left, until it is revoked. axHub reads `GET …/pass` before every held call, so it renews while anything is using it.
- **Irreversible deletes** still ask unless "Irreversible deletes too" is switched on. The control says so.
- When nothing is waiting, the banner hides. The Pass banner chip then reads "Auto-approve: until you turn it off" with **Turn off**.
- Cross-plugin without folder names: approvals-banner renders `<Slot name="approvals.auto" />` and token-control fills it.
- **Collapsible groups:** when the banner is opened, waiting calls are grouped in collapsible containers, one per build or session that asked, otherwise one per service (`vps.run` → vps). With only one group, they show as plain rows.

### axHub web (Approvals page)
- The same container: 1 hour / 2 hours / Until I turn it off. Each one is a hub pass on every service and tool (`service: "*"`, `tools: ["*"]`). **Until off** uses the longest pass the hub allows and is extended while it is on. **Turn off** (revoke) is in the same container. The console's Auto-approve (feed pass) shows there too.
- "Destructive tools are never passed: they still ask you." is shown on the control. The hub's own rule is that passes never cover destructive tools.
- The hub's 5 / 10 / 30 min window (decision #94) stays as a secondary row.
- Waiting requests in the grid are split into collapsible sub-groups (per build/session, else per service). Every group can collapse.

## API: every way to reach it

| | Turn on | Turn off | Read |
|---|---|---|---|
| REST | `POST /api/plugins/token-control/pass/auto {for: 1h\|2h\|until-off, include_irreversible?}`, or `pass/grant {until_off: true}` | `POST …/pass/auto/off` | `GET …/pass/auto` |
| MCP | `auto_approve_on {duration}` | `auto_approve_off` | `auto_approve_status` |
| CLI | `axf pass auto 1h \| 2h \| until-off [--include-irreversible]` | `axf pass auto off` | `axf pass auto status` |
| Console action / voice (AmberX) | `token-control.auto-approve:<1h\|2h\|until-off>` | `token-control.auto-approve:off` | `pass_status` / `auto_approve_status` |
| control@1 | `act pass.scopes all grant {until_off: true}` | `act pass.scopes all revoke` | `get pass.scopes all` |

A grant from an agent, MCP or a token is only a **request**. Brett approves it once, and the container shows Approve / Deny for it. A grant from his own console session is on at once.

## Tests
- `node apps/console-web/plugins/token-control/test.mjs`: 21 pass (new: until-off renew, presets, switch, revoke, agent request, CLI parsing).
- `node --experimental-strip-types apps/console-web/plugins/approvals-banner/test.mts` (node 22): 24 pass (new: grouping).
- `python3 apps/console-web/server/test_mcp_tools.py`: 218 checks (new: auto_approve_* tools).
- `npx tsx apps/axhub-web/test.mjs` (node 22): 266/266 (new: presets, hub limit, auto pass detection, until-off extend, grouping).
- `tsc --noEmit` for console-web and axhub-web: clean. check-theme, check-controls, check-toolbars, check-chrome-assets: pass. plugin-lifecycle token-control: clean. The approvals-banner findings are stale references in other files from before this build.

## Open / not verified
- **The hub's acceptance of `service: "*"` passes is not verified.** The axHub source isn't in this checkout; `/root/axHub` is from Oct 20. If the hub refuses, the axHub page's buttons show the hub's error in a toast. The console's Auto-approve doesn't depend on this. Parked Plan Studio plan: "axHub: confirm every-service passes and until-off for Auto-approve".
- **Until off on the axHub page** is extended by the page while it is open. The console's until-off is renewed on the server whenever the pass is read, including by the hub.
- **If nothing reads the console pass store for 4 hours** (no hub, no console open), an until-off pass expires like any pass. The safe direction.
- **UI Review screenshots:** not taken in this phase (no running preview). See the PR.
