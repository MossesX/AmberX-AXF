# Terminal (held commands) — AmberX plugin

Held commands (veto@1, Brett Oct 28 2026; Approve + Shelve Oct 30 2026, axHub decision 104). Claude sends a command
to the VPS through Vinnie on axHub; the hub holds it for a 90-second countdown and then runs it itself unless Brett
stops it: **Deny** stops it, **Approve** runs it right away, **Shelve** pauses the countdown until he decides.

Since Oct 30 2026 the **notices, the veto screen and the alarm belong to the veto banner plugin** (console
`apps/console-web/plugins/approvals-banner`, which AmberX loads because its `targets` list `amberx-droid`). Its
settings (Settings → Plugins → Approvals banner): the alarm (tone or his own sound file, volume, louder over time, how
long it rings, repeats, vibration, when in the countdown it starts, ring through silent mode) and the notices.
The phone side is the shell's `VetoAlerts.java` (cards with Deny / Approve / Shelve, tap = the veto screen) and
`VetoAlarm.java` (the alarm on the alarm stream), lent to the plugin through lib-hub's `setVetoHost`
(`src/native.ts installVetoHost`).

This plugin keeps:

- **Terminal** (nav → Terminal): one tab per held command, with the countdown and Deny / Approve / Shelve, then the
  live output from the hub's job stream and the final state (ran / failed / denied / expired). "Open a terminal tab
  when a timer starts" (off by default) in Settings → Plugins → Terminal.
- The phone's deciding path for lib-approvals (below).

Contract and parsing: `framework/libs/hub/veto.ts`. Docs: `_claude/memory/docs/veto-approvals.md`.

Remove: `node framework/cli/plugin-catalog.mjs app-uninstall amberx approvals`.

## Assistant title bar (Oct 28 2026)

This plugin also plugs the phone's deciding path into lib-approvals (`framework/libs/approvals`), whose badge sits in
the assistant's title bar (the AI plugin's Ask view, and the console AI assistant's chat when it runs here):
`setApprovalsHost({ hub, frame: false, decide: decideFromPhone })` in `register`. Deny = the veto host's `act` (the
phone's hub session; fallback: the call's page); Approve / Decline open the approval in the signed-in hub web view.
A tapped approval notification dispatches `approvals.popover:<id>` (the monitor's `open` listener) and the popover
opens on that item.
