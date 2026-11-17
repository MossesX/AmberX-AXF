# Phone Connect (console plugin)

The console side of the Phone Connect companion app (`apps/phone-connect`). Contract: `framework/spec/PHONE-CONNECT.md`
(phone-connect@1); reference engine `framework/core/phone-connect.mjs`; inventory `_claude/memory/docs/phone-connect.md`.

What it does: issues pairing codes, keeps the paired phones (device records with a hashed device token), queues commands
for them (`open_url`, `notify`, `approval`, `recorder.start|stop|status`, `voice`), takes the phone's ack and result, and
provides capability `axf.phone@1` so other plugins reach the phone without naming this one.

Rules:
- A pairing code is claimed only with Brett's own hub sign-in (personOnly). A session may issue a code, never claim one.
- An approval prompt on the phone is decided only by Brett's tap there; the decision goes through the approvals-banner
  relay with his hub session. No REST route, MCP tool, CLI command or voice phrase approves, denies or shelves.
- `recorder.start` is confirm-policy and needs Android's own capture consent on the phone.

Data: `.axf-console/plugins/phone-connect` → data-store@1 namespace `phone` (`devices/`, `pairings/`, `commands/`, `log.jsonl`).

How each feature is reached (UI · REST · MCP · CLI · voice) is listed in `_claude/builds/reports/rebuild-fresh-main-phone-connect-small.md`.
