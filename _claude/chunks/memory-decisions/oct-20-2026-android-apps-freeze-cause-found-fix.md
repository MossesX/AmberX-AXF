<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=180 -->
## Oct 20 2026 — App catalog on axHub (app-catalog@1)

- **Oct 20 2026 — Android apps freeze: cause found, fix waiting on Fable.** Every Android app (Voice Vault, AXHub app, Android console) shows a frozen screen that ignores taps. Cause: `FloatingWindowsHost` (`framework/android/axf-ui/.../windows/WindowHost.kt`) puts a full-screen `Box(Modifier.fillMaxSize().pointerInput { … })` on top of the app content to track the finger position; in Compose the topmost sibling that hit-tests gets the touch, so nothing below ever receives a tap. Fix: track the pointer on the root container in `AxfRoot` (an ancestor, `PointerEventPass.Initial`, never consuming) and delete that overlay Box. Brett chose **Fable** for this.
