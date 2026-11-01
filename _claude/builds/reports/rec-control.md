# rec-control: Claude controls the AmberX recorder through axHub

Nov 1 2026 · headless · Opus · axHub (`MossesX/axHub`) + AmberX-AXF (`MossesX/AmberX-AXF`) · pushed straight to `main` (Brett's brief)

## Install the new APK

**Install the new AmberX APK** once CI's `amberx` job has built it (Apps page on axHub, or the CI artifact). The old
APK has no AXPP link, so until it's installed `amberx.recorder_status` says "No AmberX phone is paired" and start/stop
return `unavailable`. After installing, open AmberX once while signed in to axHub; it connects by itself. It stays
connected while the app is open or the Monitor watch is on.

Coolify redeploys the hub from `main` (commit `419c47e`); the `amberx` service registers itself on start-up.

## What Claude can call (axHub MCP)

| Tool | Policy | What it does |
|---|---|---|
| `amberx.recorder_start {session_name, group?, note?}` | **confirm: a straight approval** | Nothing happens until Brett taps **Approve** on axHub. The approval is titled `Start recording: <session_name>`. No veto countdown, never runs on its own, and no auto-approve window covers it (hub *or* phone). |
| `amberx.recorder_stop {}` | allow | Stops the recorder. The open part is closed and uploaded. |
| `amberx.recorder_status {}` | allow | Shows on/off, since when, session, current file, parts uploaded, the upload queue, mic (always `false`), and whether the phone is online / last seen. |

**Phone offline:** start and stop return `unavailable` with a plain message ("… is offline: last seen 12 min ago. Open
the app …", or "isn't paired with axHub yet"). Status still answers, with `online: false` and the last state the phone
reported.

## How it works

- **axHub (decision #108).** AXPP was only a placeholder before this build, so its first transport is live now:
  HTTPS long poll (`POST /axpp/v1/hello | next | answer`). It authenticates with the phone's signed-in hub admin
  session only, never the MCP token, and also needs `X-AXPP: axpp@1` and a JSON body.
  - The `device-relay` connector is implemented (`DeviceRelay`). It counts a device as online if it polled in the
    last 45 s, and waits 20 s for an answer.
  - The hub defines the `amberx` tools itself. The device can't advertise tools of its own.
  - New tool annotation `explicitApproval` forces `confirm` even under veto-everywhere. `approvalTitle` sets the
    approval title, and only hub-defined tools may use it.
- **AmberX (`apps/amberx-droid`).** `AxppLink.java` says hello, long-polls and answers. It drives the **existing**
  recorder; no new recorder was added.
  - **Start:** saves the session, then opens the recorder's own consent flow, so Android's capture prompt still asks
    every start. It also posts a "Start recording: <session>" notification as a one-tap fallback for when Android
    blocks starting the screen from the background.
  - **Stop:** does the same thing as the notification's Stop button.
  - **Status:** reads the live recorder and upload queue.
- **Names and groups.** Each kept part is named `<session_name> - <YYYY-MM-DD HH-mm> - partN`. The time is the
  session's start on the phone's clock, and N counts from 1. Each part's axHub index carries `group` (defaults to
  `session_name`), `session`, `note` and `part`. The recordings list (output-recorder plugin) shows a session's parts
  together under "Session · <group>", part 1 first.
- **Indicator.** While a session records, the ongoing notification reads "Recording: <session>" with the elapsed time
  and "mic off", plus a **Stop** button. Android's own capture chip shows too. Stopping from anywhere (notification,
  tile, switch or `recorder_stop`) ends the session.
- **Rule.** Added to `_claude/shared/rules/RULES.md` in both repos ("Record every session"): call `recorder_start` at
  session start (Brett approves) and `recorder_stop` at the end.

## Tests

| Suite | Before → after |
|---|---|
| axHub `pnpm test` | 477 → **486** passed (new `packages/server/test/amberx.test.ts`, 9 tests). Covers: confirm not veto, even when set to allow/veto; no countdown; nothing runs by itself; tool title wins; auto-approve window ignored; offline errors; AXPP auth refusals; full start/status/stop round trip; device errors; 204 empty poll. |
| AmberX `npx tsx test.mjs` | 2042 → **2045** checks (`recorder_start` never auto-approved by the phone) |
| output-recorder `test.mts` | 16 → **18** (part names, groups, native wiring, no mic, never auto) |
| AmberX JUnit (`RecorderControlTest` + `HubRulesTest`, run locally on JDK 17) | **12 passed** (naming incl. time zones, session parsing, never auto-approved) |
| `apps/amberx-droid` `npm run build` (tsc + vite) | green |
| Android compile check (javac 21 against android-35 + Capacitor 8.5.3) | changed files compile. Full `assembleDebug` runs on CI. |

## Not done / honest gaps

- **The opt-in mic switch doesn't exist.** The existing recorder has no microphone path at all (AudioPlaybackCapture
  only, and the plugin's static test enforces it). So the mic stays off, and nothing in this build can turn it on.
  Building the switch means new capture code, so it needs its own build if Brett wants it.
- **Android's capture prompt is still a tap on the phone.** Android asks for MediaProjection consent on every start,
  and no app can skip that. So `recorder_start` is two yeses: Approve on axHub, then "Start" on the phone. AmberX
  opens the prompt straight away when it's allowed to (app on screen, or "display over other apps" granted);
  otherwise the notification opens it.
- **Online needs AmberX running.** The phone shows online while AmberX is open or the Monitor watch (foreground
  service) is on. A killed app shows offline, with the clear error.
- **UI Review:** the recordings list now groups by session, which is a small visible change. It hasn't been submitted
  for UI Review because there was no browser for screenshots in this headless run.
- **Pushed straight to `main`, per this brief.** That overrides the shared rule "every change through a PR".
- **The git HTTPS token is dead.** The console's `GITHUB_TOKEN` and the gh CLI token both answer 401, so this build
  pushed over SSH as MossesX. That token needs replacing on github.com and should get a banner item. Anything that
  pushes over HTTPS (bots, the console's push banner) fails until it's replaced.
