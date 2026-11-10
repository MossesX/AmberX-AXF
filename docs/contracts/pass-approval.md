# pass-approval@1 — a link to the pass, a hook to it

Brett, Nov 10 2026: "I'm gonna need a link to the pass, a hook to it."

Today a veto pass request (control-pass@1, `framework/spec/CONTROL.md` → Veto passes) is approved from the console
banner or Token control → Passes. This contract adds the three things console, Molly and AmberX share so a pass can be
reached and decided from anywhere Brett is:

1. a **deep link** that opens straight to the pending pass (`console_show` / `console_open` target `pass:<id>`),
2. a **signed, short-lived, single-use action token** that carries one decision on one pass, for notification actions
   that work in the background,
3. a **push payload** with Approve / Deny actions, and the **grant result fields** that let Claude hand the link over.

Shared types and the pure rules: `packages/shared/pass-approval/` (`index.mjs` pure, `node.mjs` signing,
`cases.json` the fixed cases every port reproduces). The pass record, its states and `passStateAt` stay control-pass@1's.

## Invariant: a pass still traces to Brett

Nothing here loosens CONTROL.md → *A grant traces to Brett*. A command, an MCP tool or a bearer token can never say a
pass was approved. So:

- **A link never decides by itself.** Opening `approve_url` shows the pass with Approve primed; the tap goes out with
  Brett's signed-in console session (`approvedVia: console`), as the banner does today. Link previewers, prefetchers and
  an agent that was handed the URL can open a page, nothing more.
- **A token decides, once.** It is minted by the server holding the pass secret, for one delivery to Brett's own device
  (the AmberX push, a web-push subscription he registered), and is **never answered to a bearer-token caller**:
  `pass_grant`, `pass_status`, `GET pass/<id>` and the stored alert carry links without tokens. A decision through a
  token is recorded `approvedVia: push` (control-pass@1 `PASS_APPROVED_VIA` gains `push`; s2 appends it).
- MCP `pass_approve` / `pass_deny` (s8, parity) never carry an approval: they answer `approval_required` with the links.
  The CLI decides only at a real terminal (`cli-tty`, unchanged). AmberX voice ("approve the pass") uses the token its
  notification holds, or its owner session.

## Deep link

| Form | Value |
|---|---|
| Target (console_show, console_open, Follow Amber `show`) | `pass:<id>` — `kind:name` like `approval:<id>`; a bare pass id is accepted too |
| Console URL | `https://console.amberxai.com/#/pass/<id>` |
| Decision primed | `…/#/pass/<id>/approve`, `…/#/pass/<id>/deny` |
| Molly | `https://molly.amberxai.com/#/console/pass/<id>[/approve|/deny]` (Molly's `#/<app>/<route>` frames the console on `#/pass/…`) |
| Alert link (alert@1 `link`) | the console URL above |

`<id>` is the control-pass@1 record id (`pass-<base36 ms>-<6 hex>`, `PASS_ID_RE`). Anything after the optional decision
makes the route not a pass route (`parsePassRoute`). The resolver (s3 / s5) answers `console.screens` path `pass` with
`arg: <id>`: the console opens its pass-approval view on that pass; a pass that is no longer pending still opens, showing
its state. A Follow Amber `show` of `pass:<id>` behaves like a screen show (focused, highlighted, `say` as the note).

## Action token (pass-action@1)

Wire form, one line, URL-safe:

```
pa1.<pass id>.<approve|deny>.<exp ms>.<nonce 16 hex>.<sig 64 hex>
```

Signed message (`actionTokenMessage`), HMAC-SHA256 with the pass secret (`AXF_PASS_SECRET`, else `AXF_WALL_SECRET`, the
secret token-control already uses for its publication and axHub's approvals): <!-- axf-plugin:token-control -->

```
pass-action@1.<pass id>.<decision>.<scope>.<minutes>[.irreversible].<exp>.<nonce>
```

| Property | Rule |
|---|---|
| Binding | pass id, decision, and the request as it was: scope, minutes, the irreversible flag (same binding as axHub's approval message, so a token minted for a plain 30-minute pass can't turn on a wider or longer one; a changed pass makes the signature fail) |
| Expiry | `exp = min(minted + 15 min, requestedAt + 15 min)`: never past the request's own lapse (`actionTokenExpiry`). Checked on the server's clock; `now >= exp` is expired |
| Single use | the pass must still be `pending` at `now` (`passStateAt`); any decision ends that, so every other token for the pass fails with `decided`. The deciding token's `{nonce, decision}` is recorded on the pass (`decidedBy`); the **same token again answers ok with `already: true`** and changes nothing (idempotent for a retried notification action). A different-decision token after a decision is `decided`, not a second decision |
| Nonce | 16 hex (8 random bytes) per minted token: tells the push's token from any other and makes the replay record exact |
| Who mints | only the server, only for a pending pass, only into a device delivery (`mintActionTokens` for a push). Never into an API answer |
| Verify order | parse → pass exists → same pass → not expired → still pending (or the recorded replay) → signature (constant time). `verifyActionToken` |
| Codes | `malformed` 400 · `unknown_pass` 404 · `wrong_pass` 409 · `expired` 410 · `not_pending` 409 (lapsed) · `decided` 409 · `bad_signature` 401 · `no_secret` 503 (`actionProblem`) |

Deny needs the same proof as approve (CONTROL.md); revoke and undo never ride a token.

## Push payload (pass-push@1)

Raised through the console's AlertHub like every notification (`passAlertInput`: source `pass`, key `pass:<id>`,
severity `warning`, link = deep link, no token), so the Notifications panel decides channels. Pass requests are an
approval type: `guarded` in the plugin's `notify.json` (type id `pass.request`), through quiet hours, only Brett's own
session can turn it down. The **device delivery** (AmberX, web push) is this frame:

```json
{ "$axf": "pass-push@1", "type": "pass", "phase": "pending", "id": "pass-…", "scope": "all", "minutes": 30,
  "include_irreversible": false, "requestedBy": "amber (mcp)", "requestedAt": "…", "state": "pending", "expiresAt": "…",
  "deep_link": "https://console.amberxai.com/#/pass/pass-…", "molly_url": "https://molly.amberxai.com/#/console/pass/pass-…",
  "target": "pass:pass-…", "title": "Pass: Everything for 30 min", "body": "amber (mcp) asks for a pass. … Approve or deny.",
  "actions": [
    { "id": "pass.approve", "label": "Approve", "token": "pa1.…", "background": true },
    { "id": "pass.deny",    "label": "Deny",    "token": "pa1.…", "background": true },
    { "id": "pass.open",    "label": "Open",    "url": "https://console.amberxai.com/#/pass/pass-…", "background": false }
  ] }
```

- Action ids: `pass.approve`, `pass.deny` post their token to `POST pass/action {token}` **without opening the app**;
  `pass.open` and a tap on the body open `deep_link`. A follow-up notification shows the result (`text` of the answer).
- A second push with `phase: "cleared"` (decided, revoked or lapsed; `actions: []`, no tokens) takes the notice away,
  like veto@1's `cleared`. One push per phase per pass.
- Tokens exist only in a `pending` delivery, never in the stored alert, the bell or any bearer read of alerts.
- `parsePassPush` drops unknown action ids and actions without a valid token / url.

## Grant result fields

`pass_grant` (MCP), `POST pass/grant` and `control_act pass.scopes grant` add, for the request they filed
(`passGrantResultFields`; also on every pending entry `pass_status` / `GET pass/status` lists, and on `GET pass/<id>`):

| Field | Value |
|---|---|
| `deep_link` | `https://console.amberxai.com/#/pass/<id>` |
| `approve_url` | `…/#/pass/<id>/approve` (opens primed; Brett's session decides) |
| `deny_url` | `…/#/pass/<id>/deny` |
| `molly_url` | `https://molly.amberxai.com/#/console/pass/<id>` |
| `target` | `pass:<id>` for `console_show` |
| `hand_over` | pending only: one line to read to Brett, "Approve here: <deep_link>" |

The answer's `text` sentence keeps its form and gains the link: "… waiting for Brett to approve: <deep_link>". The base
URL is the console's configured public URL (`AXF_CONSOLE_URL`, default `https://console.amberxai.com`; Molly
`AXF_MOLLY_URL`).

## Surfaces (everything comes with an API)

Canonical REST lives under the Token control plugin's mount, so the plugin stays removable; the step texts' short
`/api/passes/…` paths are aliases the console core registers through capability `pass-approval@1` (the plugin provides it;
with the plugin off they answer `not_implemented`, as `follow-amber@1` does). <!-- axf-plugin:token-control -->

| Surface | Open | Read | Approve / deny |
|---|---|---|---|
| Deep link | `#/pass/<id>` (console), `#/console/pass/<id>` (Molly) | — | primed `/approve`, `/deny` + one tap (owner session) |
| REST | — | `GET pass/pending`, `GET pass/<id>` (links, state, `text`) | `POST pass/<id>/approve`, `POST pass/<id>/deny` (owner session, same proof as `pass/approve|deny`); `POST pass/action {token}` (signed token, no session, background) |
| MCP | `console_show` / `console_open` `pass:<id>` | `pass_status`, `pass_get`, `pass_list_pending` | `pass_approve` / `pass_deny` answer `approval_required` + links (MCP never approves) |
| CLI | `axf pass link <id>` prints the links | `axf pass list`, `axf pass show <id>` | `axf pass approve|deny <id>` at a terminal (`cli-tty`) |
| Voice (AmberX) | "open the pending pass" → `deep_link` | "what's waiting" → pending list | "approve the pass" / "deny the pass" → the notification's token (`POST pass/action`) or the owner session |

Answers: `actionResult` `{ ok, decision, already, pass, text }`; failures `actionProblem` `{ ok: false, code, status, message, pass? }`.
Every decision is audit-logged by the existing pass logger with `approvedVia` (`console`, `axhub`, `local`, `cli-tty`,
`push`) and, for a token, its nonce.

## Steps that implement it

s2 token module + service (reuse token-control's approve / deny, add `push` to `PASS_APPROVED_VIA`, record `decidedBy`), <!-- axf-plugin:token-control -->
s3 REST + resolver, s4 grant result fields, s5 console view, s6 Molly, s7 AmberX push + background actions, s8 parity
(MCP, CLI, voice), s9 tests (`cases.json` replayed) and the PR. Kotlin twin of `index.mjs` (AmberX native notification
actions): deferred gap in `framework/spec/PORTING.md`.
