# axHub: veto countdown setting, read-only calls skip it

Brett, Nov 16 2026: "We need to stop this 90 second thing. Put the veto thing on zero seconds or 10 seconds."

Decision #119. Code in the **axHub repo** (`MossesX/axHub`, branch `claude/axhub-veto-countdown-setting-read-only`) and,
for the AXHub web app and the console / AmberX actions, in this AmberX-AXF branch of the same name.

## Before → after

| | before | after |
| --- | --- | --- |
| veto countdown | fixed 90 s + 30 s warning (decision #104), also written per tool into `vps` by `deploy/ssh-shell.sh` | one hub-wide setting, **10 s** by default, 0–120 s, no warning; 0 = runs at once (still held, logged, streamed) |
| read-only `vps.run` (`git log`, `docker ps`, `cat`, `grep` …) | waited the full 90 s | runs at once, logged **read-only, ran at once** |
| writes (`docker restart`, `git push`, `rm`, `cat x > y` …) | 90 s | the setting's countdown (10 s by default) |
| straight approvals, explicit-approval, owner-grant, irreversible | approval | unchanged: still need Brett |

## What changed

**s1 (Fable)**: spec `docs/veto-countdown.md`, `ApprovalSettings` schema + clamp in core.

**s2**: `policy.ts` constants come from the settings defaults; `vetoSettingsFor(service, tool, defaults)`; `Hub`
option `approvalSettings`; the held answer at 0 s says it runs now; Vinnie sends no `held` / `warning` push at 0 s and
ticks at once. Per-tool countdowns: writes 0–120, stored older values still load (clamped to 120 on read).

**s3**: `ApprovalSettingsStore` (`packages/server/src/approval-settings.ts`) reads
`/data/_shared/settings/approvals.json` at start, on every data-feed change and every 15 s. Migration: a hub without
the document gets the defaults (10 s) once; a saved document is kept. With that first document, the installer's fixed
90/30 s per-tool countdowns (`vps.run`, `vps.logs`) are removed so the setting applies, and the `vps` description no
longer promises 90 s. `deploy/ssh-shell.sh` stops writing them.

**s4**: AXHub web page `#/approvals/settings`: "Veto countdown (seconds)" slider + number field (0–120), quick
0 / 10 / 30 s, the read-only switch. Framework controls and tokens only (check-theme, check-controls pass).

**s5**: every door on the same document (below). Console plugin `approvals-banner` gets the relay route
`GET/POST /approval-settings` (the admin's own hub session, owner sign-in fallback, validated before the hub).

**s6–s7**: `packages/connectors/ssh/src/read-only.ts`, a fail-closed classifier: bash-like split; every simple command
must be on the allow-list with its sub-command and flag rules. Held: redirection (except to `/dev/null`, `2>&1`), tee,
here-docs, `$(…)`, backticks, any `$` expansion, subshells, groups, brace expansion, `VAR=x` prefixes, sudo and
interpreters, rm/mv/cp/chmod, git push/commit/reset/checkout/…, docker run/rm/exec/restart/…, `sed -i`,
`find -delete/-exec`, `sort -o`, `git log --output`, leading wildcards, secret-looking paths, a line ending in `|`.
143 table tests.

**s8**: hub decision step (after the policy, before passes): only `veto` calls; the connector's `readOnly` hook decides
for `vps.run` (`config.readOnlyAllow` / `readOnlyDeny` are now valid ssh config keys; a secret-looking `cwd` never
skips); otherwise only tools read-only by definition. MCP `call` gets `read_only`. **A claim is never enough on its
own**: a write with `read_only: true` is held (the step's wording; the spec first proposed refusing it).

**s9**: integration tests with the real SSH connector over a fake transport.

**s10**: approvals log kind `read_only` → "read-only, ran at once" (web log shows it inline with the programs);
allow-list API; MCP instructions, `call` and `vps.run` descriptions no longer say 90 s; `docs/veto.md` updated.

**s11**: help entries (screen, fields, read-only toggle, intro), decision #119 row in axHub's decision log, CLAUDE.md
and roadmap lines, the shared veto rule (RULES.md) and the approvals banner description.

## How each part is reached

| | REST | MCP | CLI | voice / console | deep link |
| --- | --- | --- | --- | --- | --- |
| read the countdown | `GET /auth/api/approvals/settings` (admin session) | `axhub.settings_get {name: "approvals"}` | `axhub approvals settings` | console `approvals.settings` | `https://axhub.amberxai.com/auth/admin/approvals/settings` → web `#/approvals/settings?field=vetoSeconds` |
| set it | `PUT /auth/api/approvals/settings {vetoSeconds}` (Origin + CSRF; POST from the web app) | `axhub.settings_set {name: "approvals", patch: {vetoSeconds: 10}}`: a straight approval, never a countdown | `axhub approvals veto-seconds <0-120> [warning]` | `approvals.veto-seconds:<n>` (console-control voice, AmberX); plugin route `POST /approval-settings` | same page, Save |
| read-only on/off | same PUT `{readOnlySkipsVeto}` | same tool | `axhub approvals read-only on\|off` | `approvals.read-only:on\|off` | page, switch (`?field=readOnlySkipsVeto`) |
| allow-list / check a command | `GET /auth/api/approvals/read-only?service=vps&command=…` | `axhub.settings_get {name: "read-only", command}` | — | — | — |

## Tests

- axHub: `vitest run` in node:22: **771 / 772 pass**. The one failure, `build_land … merges main with bookkeeping files
  settled`, needs `/opt/axf-batch/resolve.py` on the machine; it fails the same way on the base commit `9de150a`
  (checked in a separate worktree), so it is not from this build.
- AXF: `apps/axhub-web/test.mjs` 264/264, approvals-banner `test.py` 72 checks, `test.mts` 29, check-theme and
  check-controls pass.

## Open / for the VPS

- The live hub picks all of this up on its next deploy: the migration writes `settings/approvals.json` (10 s) and
  drops the `vps` 90/30 s per-tool countdowns once. Nothing for Brett to do.
- Shipped features entry and the THREADS row are written by the VPS when the build lands (build rules), so not by hand.
- `docs/veto-countdown.md` §2.1 records the "held, not refused" change for a wrong `read_only` claim.
- Audit action for setting changes is `service_changed` on `axhub` / `approvals.settings` (no new audit enum, to keep
  the frozen model unchanged).
