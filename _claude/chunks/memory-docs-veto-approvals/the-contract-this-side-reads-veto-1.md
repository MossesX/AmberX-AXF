<!-- memory-chunk@1 source=_claude/memory/docs/veto-approvals.md lines=15-26 tokens=207 -->
## The contract this side reads (veto@1)

- Feed `GET /auth/api/approvals` and legacy `/auth/admin/approvals.json`: a held call is in `pending` with
  `status: "held"`, `veto: { runsAt, secondsLeft, countdownSeconds }`, `jobId`, `denyUrl`, `streamUrl`; also in `held[]`
  with `heldCount`. The explain layer (`/auth/api/approvals/<id>`) carries `status: "held"` + the same `veto`.
- Deny: `POST /auth/api/approvals/<id>/deny` (admin session + hub Origin + `X-AxHub-CSRF`).
- Stream: `GET /auth/api/jobs/<jobId>/stream` (SSE `countdown {secondsLeft}`, `state {state}`, `output {stream, text}`,
  `done {state, exitCode}`).
- Push: `{ type: "veto", phase: "held"|"warning"|"running", id, jobId, title, command, runsAt, secondsLeft, denyUrl,
  streamUrl, approvalUrl }`.
- States: held → running → ran | failed; denied; expired.
