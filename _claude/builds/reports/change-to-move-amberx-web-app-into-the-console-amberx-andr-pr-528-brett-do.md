# Console app: every notification through the console (narrows PR #528)

Build `change-to-move-amberx-web-app-into-the-console-amberx-andr-pr-528-brett-do`, Phase 1 (Opus), Nov 13 2026.

Brett: "do NOT bring AmberX features into the console. Plan Studio is already there. Only build the Console Android app with all
notifications (text, approvals, alerts) going through the console. Drop the rest of the AmberX port."

## What was done

The branch starts again from main and takes only the parts of PR #528 that this asks for; PR #528 is superseded and can be
closed unmerged.

| Step | Result |
|---|---|
| s1 No AmberX features in the console | New branch from main. Kept from #528: the console raising and pushing every notification (s15), per-device notification history (s9), the phone app becoming the Console app (s12, trimmed). Not taken: s2–s5, s7, s8, s10, s11, s13, s14's parity test. |
| s2 Plan Studio is already there | Notes, to-dos, tasks and lists stay with Plan Studio and the Todo manager on the console; the amberx-notes / amberx-tasks / amberx-lists plugins and the amberx-import migration are not brought in. |
| s3 Console Android app, all notifications through the console | `apps/amberx-droid`: the app is named Console and loads `https://console.amberxai.com` (allowed hosts: console + hub only; offline page retries the console). `WatchService` reads the console's alerts with its device name (history); approvals come as the console's `approvals:<id>` alerts whenever the console's approvals watch reads axHub fine (`GET /api/plugins/approvals-banner/watch`, `on` + `state: ok`), otherwise the phone falls back to its own axHub read so nothing is missed. Auto-approve and the held-veto card with Deny stay native (actions, not notices); the console's veto alert is skipped only while the phone shows that card. Approval alert types now reach the phone by default (`notify.json` channel `amberx` on). Text notices: `POST /api/plugins/notify-control/fyi`. |
| s4 Drop the rest of the port | Also dropped the s6 Approvals page and comments (an AmberX page port), the open_url queue, recorder uploads to the console and the backend switch from the phone's Java (`OutputRecordUploader`, `AxppLink`, `HubRules`, `MainActivity` back to main). Contract `docs/contracts/amberx-console-api.md` rewritten down to the seven calls the phone reads (C1–C7). |
| s5 | Tests, this report, THREADS row, PR. |

## API (every way in)

| Feature | REST | MCP | CLI | Deep link |
|---|---|---|---|---|
| Phone's notifications | `GET /api/alerts?view=phone&device=` | `alerts-bell_feed` | `axf alerts-bell feed` | — |
| Notification history | `GET /api/alerts/history?device=` | `alerts-bell_history` | `axf alerts-bell history` | `console_open("alerts-history", focus="<id>" or "device:<name>")` |
| Approvals as alerts | `GET /api/plugins/approvals-banner/watch`, `POST …/watch/poll` | `approvals-banner_watch`, `approvals-banner_watch-poll` | `axf approvals-banner watch` | alert `link` → the call on axHub |
| Text notice (FYI) | `POST /api/plugins/notify-control/fyi` | `notify-control_fyi` | `axf notify-control fyi` | — |
| Which types reach the phone | notify-control `GET types`, `POST set` | `notify-control_*` | `axf notify-control …` | Settings → Notifications |

Voice: Amber reads the same MCP tools.

## Tests

- `apps/console-web/plugins/alerts-bell/test.py` 58 checks, `approvals-banner/test.py` 67, `notify-control/test.py` 144,
  `server/test_alerts.py` pass.
- `npx tsx apps/amberx-droid/test.mjs` 2335/2335.
- `check-theme`, `check-controls`, `check-toolbars`, `plugin-lifecycle check` (alerts-bell, approvals-banner, notify-control,
  console-commands, molly-guide, output-recorder) clean.
- `ConsoleBackendTest` (JVM) rewritten for the new rules; no Java toolchain on this VPS, it runs in CI's Android job.

## Left

- UI Review: the Notification history screen (from #528 s9) has no desktop / phone shots yet (no scratch console built in this
  session); the PR stays draft until they are in UI Review.
- Close PR #528 unmerged once this lands (not done here: closing someone's PR is Brett's call).
- Install the new Console APK on the phone (CI artifact) after merge.
- The contract change was done on Opus: it only narrows an unshipped contract, nothing new is designed.
