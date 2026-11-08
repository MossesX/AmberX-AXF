<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/design-package.md tokens=80 -->
## Gaps
Android twin deferred (PORTING.md). Not screenshot-verified (the console waits for axHub in the build sandbox).
Behaviour `windows.stack` / `minimize` / `snap` and `feedback.busyCursor` are stored and exposed through
`rt.behavior()` but the window manager doesn't read them yet: the Fable rebuild wires them in.
