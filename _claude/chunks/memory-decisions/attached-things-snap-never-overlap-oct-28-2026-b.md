<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=137-137 tokens=173 -->
## Oct 24 2026 — Vinny works without Claude; Auto fix tries Vinny first (Gizmo/Brett)

- **Attached things snap, never overlap (Oct 28 2026, Brett):** "make all attached plugins and widgets snap so they don't overlap, always make attached things snap so no overlap." Banner sides are never narrower than what's attached to them, the search bar gives way first (down to 12 × space), and a full banner scrolls sideways with scroll snap; banner popups sit in the flow next to their item; toolbar and menubar items snap too. Framework CSS (`framework/ui/axf.css`, `Widgets.tsx`), copied into every web app's baked `src/axf`. Branch `fix/banner-snap`, shots in `memory/docs/fixes/banner-snap/`.
