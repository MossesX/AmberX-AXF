<!-- memory-chunk@1 source=_claude/memory/docs/veto-approvals.md lines=1-14 tokens=264 -->
# Veto approvals (veto@1), AmberX-AXF side

(Updated Oct 30 2026: see the last section for Approve, Shelve, 90 s and the alarm.)

Brett, Oct 28 2026 21:35 EDT: "Change approval system: Claude sends a command request to the VPS through Vinnie on
axHub. Vinnie sends a notification through the AmberX Android app that waits 3 minutes before running the command in
the AmberX terminal through Vinnie. After the 3-minute countdown appears on the approval page and in a banner in the
console — but instead of an Approve button I can Deny it and stop it from running before time is up. Put a setting in
AmberX to configure the notification sound and vibration, and the notification sound for time running out and for
running. When the timer starts, open a tab in the AmberX terminal with the countdown before running."

Built on branch `refactor-all/veto` (refactor-all steps s83–s86, group veto-approvals, Opus). The hub side (axHub repo,
branch `claude/veto-approvals`) holds, counts down, runs and streams the call; this repo shows it and lets Brett deny it.
