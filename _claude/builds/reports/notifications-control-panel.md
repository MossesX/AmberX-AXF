# Notifications control panel: inventory and report

Build `notifications-control-panel` (Nov 6 2026, Opus). Brett: "You need to have an administration panel. I need to
control all the notifications. I need you to build a console control panel to enable and control all possible
notifications."

## What the inventory found

- **The console has one choke point.** Every console sender goes through `AlertHub.raise_alert`, directly or through
  `POST /api/alerts`, including the landing job, the merge queue and the VPS backup. So the gate is one seam.
- **axHub sends nothing itself.** It holds calls and serves a feed. AmberX polls that feed; the veto banner reads it.
  There is no hub sender to gate, so `axhub.feed` is listed as such.
- **AmberX polls too.** Its console alerts come from `GET /api/alerts` every check, so the server can filter what the
  phone sees. Its approval and veto notifications come from the hub feed and need a check in the app.
- **`notify.buildDone`, `notify.blocked` and `notify.approvalWaiting` were dead switches.** The Claude settings exist,
  no code read them. The first two now work, as linked types. `notify.approvalWaiting` stays a note for Claude sessions:
  it can be changed by any session, so it must not be able to mute a guarded type.
- **`Built` never reached the phone.** AmberX shows warning and worse, and a finished build is `success`. Since the
  Claude setting says "push when a build finishes" and is on, `builds.done` now buzzes. That is the one default that
  changes.
- **`notify.quiet*` had no reader either.** They now drive the panel's quiet hours, one setting, no copy.

## Inventory: 35 types and 11 status banners

### Approvals and veto

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `amberx.approval` Approval waiting (guarded) | AmberX reads the axHub feed | AmberX app | urgent |
| `amberx.veto` Veto countdown (guarded) | AmberX reads the axHub feed | AmberX app | urgent |
| `axhub.feed` axHub held calls | axHub | Nothing to switch | normal |
| `veto.notice` Veto browser notices | Veto banner | Console, browser check | normal |
| `veto.alarm` Veto alarm in the console | Veto banner | Console, browser check | normal |
| `follow.approval` Approval pop-up in the console | Follow Amber | Alert hub gate | high |

### UI Review

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `ui-review.ready` Ready for UI Review | UI Review | Alert hub gate | high |

### Builds

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `builds.failed` Build failed or broke | Pending list poll, console core | Alert hub gate | high |
| `builds.done` Build finished | Pending list poll, console core | Alert hub gate | normal |
| `activity.done` Long task finished | Activity banner | Alert hub gate | normal |
| `builds.start-approval` Start build waits for you | Build manager | Alert hub gate | high |

### Merge queue and CI

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `ci.failed` CI failed | GitHub Actions poll, console core | Alert hub gate | high |
| `deploy.failed` Deploy failed | GitHub Actions poll, console core | Alert hub gate | high |
| `deploy.done` Deploy finished | GitHub Actions poll, console core | Alert hub gate | normal |
| `merge.blocked` Landing blocked | Push banner, landing job | Alert hub gate | high |
| `merge.kicked` Kicked out of the merge queue | Merge queue | Alert hub gate | high |

### Health checks

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `health.check` Systems check problem | Systems check | Alert hub gate | high |
| `maintenance.disk` Disk filling up | Maintenance | Alert hub gate | high |
| `maintenance.swap` Memory pressure | Maintenance | Alert hub gate | normal |
| `maintenance.jobs` Maintenance jobs | Maintenance | Alert hub gate | normal |

### Accounts and limits

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `account.claude` Claude sign-in and keys | Systems check | Alert hub gate | high |
| `account.github` GitHub tokens and limits | Systems check | Alert hub gate | high |

### Claude sessions

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `claude.handoff` Refresh the handoff kit | Claude handoff | Alert hub gate | normal |
| `claude.agent-pick` Pick Claude's agent | Claude sessions | Alert hub gate | normal |

### Console

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `console.plugin` Plugin failed to load | Console core | Alert hub gate | normal |
| `console.conflict` Conflicts | Console core and the page | Alert hub gate | normal |
| `console.crash` Crashes | Console core and the page | Alert hub gate | high |
| `console.restart` Unclean restart | Console core | Alert hub gate | normal |
| `console.test` Alert test buttons | Settings → Alerts | Alert hub gate | normal |
| `terminal.bell` Terminal bell | Terminal | Console, browser check | normal |

### AmberX app

| Type | Sender | Checked by | Priority |
|---|---|---|---|
| `amberx.auto-approved` Auto-approved call | AmberX | AmberX app | normal |
| `amberx.wake` Wake phrase | AmberX | Fixed (Android) | normal |
| `amberx.recording` Recording asked from axHub | AmberX | Fixed (Android) | normal |
| `amberx.console-open` Console opened by Amber | AmberX | Fixed (Android) | normal |
| `amberx.foreground` AmberX running notices | AmberX | Fixed (Android) | normal |

### Status banners (11)

activity, approvals, build-manager, claude-handoff, claude-no-wait, codebase-changes, push-banner, keys-needed,
systems-check, whats-new, token-pass. Read from each `plugin.json` at load. They are status, not events, and Settings →
Plugins → Banners already shows and hides them, so the panel lists them and points there.

## Coordination

`ui-review-notify-session-audio` (PR #365) owns the UI Review push. Its type is registered in
UI Review's own `notify.json`, a new file, so nothing in that PR is rebuilt or touched. It matches
source `ui-review` and the `notify.uiReview` setting, both of which arrive with #365. Until then the row just never fires.
AmberX's Java lines were placed to merge cleanly with #365.

## Gaps

- Muting approval and veto types on the phone needs the new AmberX APK. Everything else works on the current one.
- On the phone, AmberX push has no separate sound: its Android channel decides. The Sound channel is the console's.
- Quiet hours hold web push and ntfy by dropping them: they are not re-sent when quiet ends. AmberX does get held alerts.
- An alert shown on the phone before quiet hours can buzz once more when they end, if it is still open.
- `activity.done` also has its own push settings in Settings → Plugins → Activity; the panel can only narrow them.
- Console per-app switches cover where it lands. axHub is not one of them: it shows nothing that isn't already a row.
- Registry, capability and the `notify` field in `/api/alerts` are additive and were built on Opus. They touch a
  cross-app reply, so a Fable review is the right next step.
