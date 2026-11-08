<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=133 -->
## Status (as of Oct 21 2026)

- **Android apps froze — fixed (Oct 20 2026, Fable):** every Android app rendered but ignored taps. `FloatingWindowsHost` laid a full-size `Box` with a `pointerInput` over the app content to track the finger for minimize-to-cursor; a topmost sibling with any pointer input takes every touch in Compose, so nothing underneath got a tap. The tracking now lives on `AxfRoot`'s root container (ancestor, Initial pass, never consumes) and the overlay is gone (`axf-ui/AxfRoot.kt`, `windows/WindowHost.kt`).
