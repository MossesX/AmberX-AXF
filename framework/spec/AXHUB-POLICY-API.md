# axHub policy API (policy-table@1)

Contract between the Dev Console's Approvals & veto tab and axHub. **Proposed** by build `claude-settings-tabs-veto`
(Nov 7 2026): the console side is built against it; axHub's routes are step s4 of that build, pinned to Fable, which
may refine this page. The console answers "axHub doesn't have the policy API yet" on a 404 and changes nothing.

Why it exists: axHub changes tool policy only through its in-container CLI (`axhub services tool-policy`, `veto`,
`preset`). A console tab needs routes, and they must keep policy in the owner's hands.

## Who may do what

| | Admin hub session (browser cookie) | Bearer token (MCP, console server, any session) |
| --- | --- | --- |
| `GET /auth/api/policy` | yes | yes (`describe_service` already shows the same facts) |
| `PUT /auth/api/policy` | yes | **never: 403** |

A write needs the admin session cookie and an `Origin` that is the hub's own or passes `crossSiteOk` (https, under the
cookie domain). Cross-site reads and writes get CORS with credentials for those origins only, and an `OPTIONS` answer.
A request carrying a bearer is treated as a bearer, whatever cookie comes with it. Every write is audited.

## GET

```json
{ "$axf": "policy-table@1", "services": [{
    "namespace": "vps", "type": "ssh", "enabled": true, "defaultPolicy": "deny", "policyPreset": "recommended", "toolsStale": false,
    "tools": [{ "name": "run", "description": "…", "annotations": { "destructive": true },
                "explicit": "veto", "policy": "veto", "vetoSeconds": 90, "vetoWarningSeconds": 30 }] }],
  "veto": { "defaultSeconds": 90, "min": 10, "max": 1800 } }
```

`explicit` = the tool's own entry, absent when it follows the service. `policy` = effective (`resolvePolicy`), so a
hub rule that raised a choice shows. A disabled service lists cached tools and is never contacted.

## PUT

```json
{ "changes": [{ "service": "vps", "tool": "logs", "policy": "allow", "vetoSeconds": 60 }], "reason": "Default" }
```

`policy`: `allow | veto | confirm | deny`, or `null` to follow the service; left out = unchanged. `vetoSeconds`: 10-1800.
All or nothing: one bad entry refuses the whole list. Answer: `{ ok: true, table }`, or `{ error: { code, message } }`
(400 invalid, 401 not signed in, 403 denied, 404 unknown service). The rules in `policy.ts` stay in force: destructive
tools and owner grants never reach `allow`, explicit approval stays a straight approval, passes never cover them.
