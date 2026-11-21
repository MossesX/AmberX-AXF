# Approval rules in VPS Configuration: veto countdown only on VPS writes

Build `approval-rules-vps-configuration-veto` · branch `claude/approval-rules-vps-configuration-veto` · Fable · Nov 21 2026

Brett, Nov 21: "I'm tired of this 90 second shit. It's only supposed to be for writes on the VPS." "I need a bunch of
rules to be able to set."

## What changed

**Builds → VPS Configuration has a new tab, Approval rules.** It shows the rules axHub uses to decide each call and lets
Brett add, edit, reorder and remove as many as he wants. One button, **Apply the default**, sets his rule: a veto
countdown only on shell commands on the VPS.

### s1: axHub (MossesX/axHub PR #43, merged and deployed)

The policy API was written on Nov 12 (axHub decision 119) but its PR was never merged, so the live hub answered 404 and
the Nov 12 default could not be applied from the console. This build landed it, with one addition.

- `GET /auth/api/policy` (policy-table@1): every service, its tools, each tool's own entry, the policy in force, the hold.
- `PUT /auth/api/policy`: only from a signed-in admin's browser session. A bearer token gets 403.
- **Match-pattern rules (axHub decision 121, new):** a service carries ordered `policyRules: [{ match, policy?, vetoSeconds? }]`.
  `match` is a tool name or a pattern (`*` = any run of characters). A tool without its own entry takes the first rule
  that matches. A tool's own entry always wins. A rule also covers tools the service adds later.
- Safety kept: destructive tools and owner grants never reach allow; explicit approval stays a straight approval; an
  allow pattern never decides a guarded tool, so a delete's straight approval is not turned into a countdown.
- Tests: `packages/core/test/policy-rules.test.ts`, `packages/server/test/policy-web.test.ts`. axHub CI green.

Decision: patterns live in the hub's engine instead of being expanded into per-tool entries by the console. Expanded
entries would leave every tool added later on the preset's 90 s countdown, which is the complaint this build answers.

Deploy: Coolify's auto deploy did not fire on the merge (no deployment was queued after 10 minutes), so the deployment
was queued through Coolify's own deploy function, the same one its Deploy button calls.

### s2: the editor

`apps/console-web/plugins/gate`: `web/ApprovalRulesTab.tsx`, `web/approvalRulesState.ts`, `web/approval-core.mjs`
(pure, shared with the CLI and tests), `approval-rules.mjs` (CLI and server side), two routes in `server/routes.py`.

- Per service: an ordered list of rules. Each rule: which tools, the decision (allow, veto, confirm, deny, or hold
  length only), the hold in seconds. Each row says how many tools it decides right now and names a few.
- Add, edit, move up or down, remove. **Let the rules decide** clears the tools' own entries on save (never a deny,
  never a delete), because an own entry beats every rule.
- Every edit is a draft. Nothing changes on axHub until Save. The draft is one file, shared by every surface.
- **Save takes Brett's own click.** It is sent from his browser on his own hub session. A console-control press, an
  action or a script is refused before any request goes out (`saveApprovals` checks the click is a real one), the
  console server has no route that writes the policy, and axHub refuses a bearer token anyway.

How each surface reaches it:

| Reach | Read | Stage an edit | Save |
| --- | --- | --- | --- |
| Deep link | `console_show view:gate/tab:gate.tabs=approvals`, `vps.open:approvals`, `vps.approvals.open` | | |
| REST | `GET /api/plugins/gate/approval-rules` | `POST /api/plugins/gate/approval-rules/draft` | never |
| MCP | `vps_approval_rules` | `vps_approval_rules_stage` | never |
| CLI | `axf gate approvals` | `axf gate approvals add, edit, remove, move, clear-own, default, discard` | never |
| Voice / actions | `vps.approvals.status` | `vps.approvals.add, edit, remove, move, clear-own, discard` | never |
| console-control@1 | `setting:vps.approvals.<service>.rules`, `.clearOwn`, `.<n>.match`, `.<n>.policy`, `.<n>.vetoSeconds` | a set on the same addresses | `button:vps-approvals-save` and `button:vps-approvals-default` exist but only Brett's own click works |

Decision: "REST, MCP, CLI and voice the same" stops at Save on purpose. The standing rule is that owner-only settings
are never commands, and a session that could save its own approval rules would make the veto meaningless. Every
surface can read everything and prepare the exact change; Brett's click applies it.

### s3: Apply the default

`DEFAULT` in `web/approval-core.mjs`:

| Service | Rule | Decision |
| --- | --- | --- |
| vps | `run`, `launch` | veto |
| axf-console | `console_terminal_sessions_run`, `agent_manager_vinny_commands_by_cid_run` | veto |
| axf-console | `orchestrator_upgrade_approve` | confirm |
| axf-console | `*` (everything else: screen opens, overlays, navigation, the orchestrator, tools added later) | allow |

Checked against the live hub table on Nov 21 (read only, with the console's own hub credential): `axf-console` has
550 tools, 62 of them on the veto countdown, and 59 of those have no entry of their own. They are tools added since
Nov 12 that fell back to the preset (`console_control_do`, `console_commands_overlay`, `console_commands_shot`,
`claude_view_set` and others), which is the 90 s wait Brett kept hitting. After Apply the default: 3 tools decided by
the three named rules, 524 by `*` = allow, the 23 destructive tools untouched, 232 own entries cleared. All three named
console tools and both `vps` tools exist under those names. On `vps` the two rules decide nothing today because `run`
and `launch` already carry their own veto entry; the rules keep them held if those entries are ever cleared.

On axf-console it also clears the tools' own entries so the rules decide. Deletes keep the hub's approval, denied tools
stay denied, the other `vps` tools keep their own entries, and no other service is touched. Rules Brett added himself
stay, above the catch-all. The hold length is not changed by the default: set it on the rule.

While the default is not applied, the systems check shows **Veto countdown only on VPS shell commands**
(`vps-approval-default`, `server/approval_default_health.py`) with the steps. It has no Fix button: only Brett's click
applies it. It also shows when staged edits wait for his Save.

The older "Your default" plan in Settings → Plugins → Claude → Approvals & veto wrote per-tool entries, which would
beat the new rules. It now points to the new tab.

### s4: tests and checks

- `node apps/console-web/plugins/gate/test.mjs`, `python3 apps/console-web/plugins/gate/server/test_routes.py`,
  `python3 apps/console-web/plugins/gate/test_auto_lander.py`, `node apps/console-web/plugins/claude-settings/test.mjs`.
- `check-theme`, `check-controls`, `check-toolbars`, `check-console-control`, `check-chrome-assets`,
  `plugin-lifecycle check gate`, `tsc --noEmit`: all pass.
- Seen in a real browser (`apps/console-web/scripts/vps-config-shots.mjs`, now also the Approval rules tab): desktop
  and phone screenshots against the built console with a fixture table. The same run presses Save through
  console-control with its confirm: the tab answers "Only Brett saves approval rules, with his own click in his
  signed-in console." and no request reaches the hub's policy route. The script fails if one does.
- Screenshots: `axf shot` saved them to the worktree's local Screenshots store only; filing them in the live console
  needs the console token, which this session was not given.
- Help: entries in `plugins/gate/help.json`. Docs: `plugins/gate/README.md`, `framework/spec/AXHUB-POLICY-API.md`.

## For Brett

1. Open Builds → VPS Configuration → Approval rules, signed in.
2. Press **Apply the default**, confirm.
3. Done: only VPS shell commands hold. Change the hold length on any rule and Save.

Nothing was applied to the live policy by this build. That click is yours.

## Needs Brett

- **Rotate the Coolify API token.** While checking the live table, a shell step loaded the console's credential file
  and the shell printed a fragment of the Coolify token as an error line into this session's output. The value is not
  in the repo or the PR, but it is in the session transcript. Make a new token in Coolify → Keys & Tokens, save it in
  the console's systems check (Coolify API token), delete the old one.
- Coolify's auto deploy for axHub did not fire on a push to main. This build queued the deployment itself; the
  GitHub webhook for the axHub app in Coolify should be checked.

## Gaps

- `orchestrator_upgrade_approve` is `confirm`, which the live hub (confirm-as-veto) shows as a countdown, not a
  straight approval. Unchanged from Nov 12; making an explicit `confirm` a straight approval changes every existing
  confirm entry on the hub and was left out.
- No rule per caller, per argument or per time of day: rules match tool names only (axHub roadmap, "Richer policy rules").
- No UI Review choices were shipped: the tab uses the screen's existing look (one layout, stacks on a phone).
- This build's branch contains PR #881 (the rename to VPS Configuration), which the tab is built on.
