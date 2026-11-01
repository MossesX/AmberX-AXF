# ClipX — clipboard manager (plan, ON HOLD)

**Asked (Brett, Oct 28 2026 15:18 EDT):** "Build a clipboard manager to save, sort, manage, view, edit, archive, create
snippets, create documentation, notes, tasks, etc and integrate amberx voice control stuff too."

**Decided (cards, Oct 28 2026):**
- A **separate new app** (not a plugin in AmberX). Working name **ClipX** (Brett can rename).
- Phone capture through an **Android accessibility service** (catches every copy in any app; one-time Accessibility toggle).
- Build profile **Refactor**.
- **Held:** the STOP ORDER (Oct 28 15:26 EDT) was in force, so Brett picked "plan + thread only". Nothing is in the
  orchestrator yet. When he lifts the stop: add build `clipx` to the orchestrator (Refactor) from the steps below,
  check the queue for clashes again, then start.
- **Needs an Android exception:** ClipX's Capacitor shell + accessibility service is Android code, and Android is on
  hold except AmberX, Voice Vault and Patches. Ask Brett (card) to add ClipX as an exception before the Android steps.

Full plan (shape, features, 16 steps ~9.5 h, clash check): branch `claude/clipx-plan`, file `_claude/memory/docs/clipx.md`
in MossesX/AmberX-AXF (this hub copy is a summary until that branch merges and claude-sync replaces it).
