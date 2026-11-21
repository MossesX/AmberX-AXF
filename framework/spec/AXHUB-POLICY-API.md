# axHub policy API (policy-table@1)

Contract between the Dev Console and axHub: the Approval rules tab in VPS Configuration (`apps/console-web/plugins/gate`,
approval-rules@1) and the Approvals & veto tab in Claude settings. The console side came with build
`claude-settings-tabs-veto` (Nov 7 2026); axHub's routes were written for `owner-recognized-everywhere-veto-countdown-only-on-shell-commands`
(axHub decision #119, Nov 12 2026, `packages/server/src/policy-web.ts`) and landed on axHub main, with match-pattern
rules (axHub decision #121), on Nov 21 2026 (axHub PR #43, build `approval-rules-vps-configuration-veto`). Against an
older hub (404) the console says "axHub doesn't have the policy API yet" and changes nothing; against a hub without
`rules` it says match-pattern rules are missing.

Why it exists: axHub changes tool policy only through its in-container CLI (`axhub services tool-policy`, `veto`,
`preset`). A console tab needs routes, and they must keep policy in the owner's hands.

## Who may do what

| | Admin hub session (browser cookie) | Bearer token (MCP, console server, any session) |
| --- | --- | --- |
| `GET /auth/api/policy` | yes | yes (`describe_service` already shows the same facts) |
| `PUT /auth/api/policy` | yes | **never: 403** |

A write needs the admin session cookie and an `Origin` that is the hub's own or passes `crossSiteOk` (https, under the
cookie domain). Cross-site reads and writes get CORS with credentials for those origins only, and an `OPTIONS` answer.
A request carrying a bearer is treated as a bearer, whatever cookie comes with it. A write needs a JSON body (so a
cross-site write always takes the preflight). Every write is audited (one entry per change, by the admin, via `web`).

## GET

```json
{ "$axf": "policy-table@1", "services": [{
    "namespace": "vps", "type": "ssh", "enabled": true, "defaultPolicy": "deny", "policyPreset": "recommended", "toolsStale": false,
    "rules": [{ "match": "build_*", "policy": "allow" }],
    "tools": [{ "name": "run", "description": "…", "annotations": { "destructive": true },
                "explicit": "veto", "policy": "veto", "vetoSeconds": 90, "vetoWarningSeconds": 30 },
              { "name": "build_test", "description": "…", "rule": "build_*", "policy": "allow", "vetoSeconds": 90, "vetoWarningSeconds": 30 }] }],
  "veto": { "defaultSeconds": 90, "min": 10, "max": 1800 } }
```

`explicit` = the tool's own entry, absent when it follows the service. `rules` = the service's ordered match-pattern
rules; `rule` = the pattern that decides a tool without its own entry. `policy` = effective (`resolvePolicy`), so a
hub rule that raised a choice shows. A disabled service lists cached tools and is never contacted.

## PUT

```json
{ "changes": [{ "service": "vps", "tool": "logs", "policy": "allow", "vetoSeconds": 60 }], "reason": "Default" }
```

`policy`: `allow | veto | confirm | deny`, or `null` to follow the service; left out = unchanged. `vetoSeconds`: 10-1800.
All or nothing: one bad entry refuses the whole list. Answer: `{ ok: true, table }`, or `{ error: { code, message } }`
(400 invalid, 401 not signed in, 403 denied, 404 unknown service). The rules in `policy.ts` stay in force: destructive
tools and owner grants never reach `allow`, explicit approval stays a straight approval, passes never cover them.

## Match-pattern rules (axHub decision #121)

```json
{ "rules": [{ "service": "axf-console", "rules": [
    { "match": "console_terminal_sessions_run", "policy": "veto", "vetoSeconds": 60 },
    { "match": "*", "policy": "allow" }] }],
  "changes": [{ "service": "axf-console", "tool": "console_open", "policy": null }], "reason": "Default" }
```

`rules` sits beside `changes` in the same `PUT` (either may be left out, not both). Each entry replaces that service's
whole ordered list; an empty list clears it. A rule is `{ match, policy?, vetoSeconds? }` with at least one of the two:

- `match`: a tool name or a pattern. `*` stands for any run of characters (none included); everything else is literal
  and the whole name must match. No spaces, at most 128 characters, at most 200 rules a service.
- The first rule that matches a tool and carries a `policy` decides it. A tool's own entry (`changes`) always beats a
  rule, so `policy: null` on the tool hands it back to the rules.
- A rule with only `vetoSeconds` sets the hold for matching veto tools and leaves the decision alone.
- A rule also covers tools the service adds later: a new tool no longer falls back to the preset's countdown.
- A rule counts as the owner's explicit choice (it replaces the service default and the preset, and opens an SSH tool).
- An `allow` rule never decides a guarded tool (destructive, owner grant, explicit approval): that tool follows the
  service as if no rule matched, so a preset's straight approval for a delete is not turned into a countdown.

The console keeps a draft of rule edits (approval-rules@1, `apps/console-web/plugins/gate/README.md`); only the
`PUT` above, from Brett's own click in his own browser session, changes anything on the hub.
