# @axf/pass-approval — pass-approval@1

The shared types and pure rules behind approving a veto pass from a link or a notification. Console, Molly and AmberX
all read this one module (or its twin) so a deep link, a token and a push mean the same thing everywhere.

Spec: [docs/contracts/pass-approval.md](../../../docs/contracts/pass-approval.md). Pass records: control-pass@1
(`framework/core/engines/control-pass.mjs`).

| File | What |
|---|---|
| `index.mjs` + `index.d.mts` | Pure: deep link and target grammar, the token wire form and the string it signs, pre-signature checks and the replay rule, the pass-push@1 payload, alert@1 input, grant result fields, result shapes. No IO, no clock, no crypto. |
| `node.mjs` + `node.d.mts` | Node: `mintActionToken`, `mintActionTokens`, `verifyActionToken` with HMAC-SHA256 over the pass secret (`AXF_PASS_SECRET`, else `AXF_WALL_SECRET`). |
| `cases.json` | Fixed secret, fixed clock: messages, tokens and verdicts every port must reproduce (the Kotlin twin replays it). |
| `test.mjs` | `node --test test.mjs` |

Consumers import by relative path (the repo has no workspace root): the Token control plugin's server and the console's
deep-link resolver on the web side, the console MCP server through the plugin, AmberX's notification handler (bundled).

Rules in one breath: a link never decides by itself. A token decides once, for one pass and one decision, within
15 minutes, and only ever travels inside a push to Brett's own device. Everything a bearer-token caller can read
(pass_grant, pass_status, GET pass/\<id\>) carries links without tokens.
