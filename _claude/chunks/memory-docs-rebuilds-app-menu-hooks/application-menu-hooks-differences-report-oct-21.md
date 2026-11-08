<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/app-menu-hooks.md lines=1-8 tokens=143 -->
# Application-menu hooks — differences report (Oct 21 2026, Fable)

Branch `fable/app-menu-hooks` from main `a13f9f1`. The framework half of the decision *"Console application menu
reaches everything"* (`_claude/memory/decisions.md`, Oct 21 2026): the app menu gets run-time contributions,
submenus and live lists so the toolbar and side navigation can be hidden. The console's own menu content is the
next, Opus build. **Scope change mid-build (Brett, Oct 21 2026): all Android work stopped** — web only; the Kotlin
twin is a recorded gap (`framework/spec/PORTING.md`).
