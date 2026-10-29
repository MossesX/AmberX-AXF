# Approvals (veto) — AmberX plugin

Held commands (veto@1, Brett Oct 28 2026). Claude sends a command request to the VPS through Vinnie on axHub; the hub
holds it for a 3-minute countdown and then runs it itself unless Brett denies it. There is no Approve.

- **Notifications:** timer started (title, command, live countdown, **Deny**), time running out (30 s left), running.
  Android: the watch service (`android/.../VetoAlerts.java`), one channel per phase made with the chosen sound and
  vibration. Browser: this page while it is open (Notification API, tones, `navigator.vibrate`).
- **Settings → Plugins → Approvals:** timer-started sound, vibration, time-running-out sound, running sound, each with
  Test; "Open a terminal tab when a timer starts".
- **Terminal** (nav → Terminal): one tab per held command, with the countdown and Deny, then the live output from the
  hub's job stream and the final state (ran / failed / denied / expired).
- **Deny:** Android posts it with the phone's hub session (hub Origin + CSRF); a browser opens the call on the hub.

Contract and parsing: `framework/libs/hub/veto.ts`. Docs: `_claude/memory/docs/veto-approvals.md`.

Remove: `node framework/cli/plugin-catalog.mjs app-uninstall amberx approvals`. Outside this folder only the shell's
`VetoAlerts.java` and its seam in `src/native.ts` remain (shared shell code; inert without this plugin's settings).
