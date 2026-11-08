<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md tokens=195 -->
# Patches — differences report (pending `patches-wrapper`, Fable, Oct 21 2026)

**What Brett asked (voice, Oct 21 2026):** take the Console / Pilot / axHub tab group out of the console so the
Console, Pilot and axHub are each their own app again; make a new app, **Patches**, that is just one banner and a tab
group showing the three apps in tabs; when an app runs inside Patches its own banner goes away and Patches shows the
one banner. Android first. Design he picked: **native shell, web tabs**.

Branch `fable/patches-wrapper`. Web screenshots in [`patches-wrapper/shots/`](patches-wrapper/shots/) (before = commit
`5d95cd0`, after = this build); Android screenshots arrive by themselves on the branch (`patches-wrapper/android.md`,
`rebuild-shots.yml`) once it is pushed.
