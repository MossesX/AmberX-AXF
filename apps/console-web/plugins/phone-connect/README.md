# Phone Connect (console plugin)

The console side of the Phone Connect companion app (`apps/phone-connect`). Contract: `framework/spec/PHONE-CONNECT.md`
(phone-connect@1); reference engine `framework/core/phone-connect.mjs`; inventory `_claude/memory/docs/phone-connect.md`.

What it does: issues pairing codes, keeps the paired phones (device records with a hashed device token), queues commands
for them (`open_url`, `notify`, `approval`, `recorder.start|stop|status`, `voice`), takes the phone's ack and result, and
provides capability `axf.phone@1` so other plugins reach the phone without naming this one.

Also (build phone-connect-popups, Nov 21 2026):
- **Re-pair state.** A device token the console refuses is recorded (`link.json`) and answered with
  `detail.reason: "pair"`; `status.link.state` is then `disconnected`, the settings tab shows a Re-pair button, one
  banner alert is raised and the systems check turns red. The phone stops retrying on that answer.
- **`POST open-url` (MCP `phone_open_url`).** An https amberxai.com page in Chrome or the default browser, in front;
  the answer's `how` is `direct`, or `notification` when Android blocked the start and one tap opens it.
- **Approvals on the phone** (`server/approvals.py`). A watcher in the console server reads what waits on axHub through
  approvals-relay@1 `pending()` every 5 s while a phone is online, and pushes each new approval or veto countdown once.
  It works with no console open. Needs the relay's owner sign-in (`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`);
  `status.approvals` says what the last pass did.
- **Follow Amber on the phone.** `axf.phone@1` `follow(address)`; the `follow` feature switch, on by default.
- **`GET presence` (MCP `phone_status`).** Paired, online, last check-in, and whether the link needs a re-pair.

Rules:
- A pairing code is claimed only with Brett's own hub sign-in (personOnly). A session may issue a code, never claim one.
- An approval prompt on the phone is decided only by Brett's tap there; the decision goes through the approvals-banner
  relay with his hub session. No REST route, MCP tool, CLI command or voice phrase approves, denies or shelves.
- `recorder.start` is confirm-policy and needs Android's own capture consent on the phone.

Data: `.axf-console/plugins/phone-connect` → data-store@1 namespace `phone` (`devices/`, `pairings/`, `commands/`,
`settings.json`, `link.json`, `approvals.json`, `log.jsonl`).

How each feature is reached (UI · REST · MCP · CLI · voice) is listed in `_claude/builds/reports/rebuild-fresh-main-phone-connect-small.md`.
