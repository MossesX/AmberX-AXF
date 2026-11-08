<!-- memory-chunk@1 source=_claude/THREADS.md lines=69-69 tokens=242 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| What's new tap fix (Current `whats-new-open-fix`, bug fix, Opus; agent Janitor Joey; Brett Nov 3 voice: "I'm clicking it. But I'm not seeing anything." + "I can't close it"): the console Terminal's floating window opened over the Banners strip on phones and ate the taps; the strip's What's new row only folded open inside the capped strip. Fix: floating windows open below the top chrome; the row opens the What's new panel (`whats-new.open`), chevron folds details; every dialog closes by X (finger-sized), outside tap, Escape, Android back, swipe down; control@1 `console.dialogs` act `close` (MCP `console_dialog(action="close")`, REST, CLI) | built, PR #290 open, UI Review r-20261103-049edfb2 waiting | `claude/whats-new-open-fix` | #290 | Report `_claude/builds/reports/whats-new-open-fix.md`. Brett: approve the UI Review item; then it auto-merges once CI is green | 2026-11-03 |
