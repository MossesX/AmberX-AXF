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

## Shape

| Part | Where | Notes |
| --- | --- | --- |
| Web app | `apps/clipx` (react-ts template, `axf init`, own `project.manifest.json`) | AXF chrome: banner, toolbar, nav, app menu, context menu, settings interface (levels toolbar rule), design packages |
| Server | `apps/clipx/server` (FastAPI) | clips API, AI calls with keys server-side; Coolify app at `clipx.amberxai.com` (A record to the VPS, logged in the DNS log) |
| Android shell | `apps/clipx/android` (Capacitor, same pattern as `apps/amberx-droid`) | `ClipAccessibilityService`, share target "Save to ClipX", quick-settings tile, optional floating bubble (reuse AmberX `DetectionOverlay` pattern) |
| Data | axHub `/projects/amberx-axf/_data/clipx/` (or its own project folder if Brett wants) | clips, snippets, docs, folders/tags, settings; offline cache on the phone |

## Features

- **Capture:** Android accessibility service (every copy, any app); share sheet; quick tile; web: paste box,
  Ctrl+V anywhere in the app, "read clipboard" button (browser Clipboard API, needs focus). Source app + time kept.
- **History:** grid (framework DataGrid) + cards view; sort (newest default), filter (type: text, link, code, colour,
  image, file path; source app; tag; folder; pinned; archived), search; Basic filter plugin attaches when it exists.
- **Manage:** pin, favourite, tag, folders, merge clips, split, rename/title, duplicate detection (same text = bump,
  not a new row), bulk select (double-click multi-select like pending-grid-view), undo.
- **View/edit:** viewer with syntax highlight for code, link preview, colour swatch; editor (text + markdown);
  version history per clip.
- **Archive + trash:** archive (hidden from history, searchable); trash with auto-empty after N days (setting);
  auto-expire unpinned clips after N days (setting, default off).
- **Snippets:** saved reusable text with placeholders (`{date}`, `{clipboard}`, `{cursor}`, custom fields asked on
  use), folders, short keys/abbreviations, copy-to-clipboard in one tap.
- **Documentation:** turn one or many clips into a markdown doc (ordered sections), doc library, export .md;
  AI "write this up" from selected clips.
- **Notes + tasks:** "Send to AmberX notes / tasks" writes into AmberX's shared lists (`amberx-notes/` on axHub) —
  no second notes or task system (AX Notes was killed for being a duplicate). ClipX shows a read-only peek.
- **AI (via AmberX's server AI router, `axf.llm@1`):** auto-title, classify (code / link / address / task-like),
  summarise, suggest tags, "make a snippet", "make a task". Off by default for clips marked sensitive.
- **Voice (AmberX voice control):** ClipX ships the shared speak+listen speech library and registers a
  **Clipboard** category in AmberX's voice-command@1 command center (e.g. "save that", "read my last clip",
  "copy snippet <name>", "archive last clip", "make a task from my last clip", "search clips for <x>",
  "pin it", "open ClipX"). Commands run in ClipX directly, or from AmberX through axHub when ClipX isn't open.
  Chains/wizards from the command center work with these commands.
- **Privacy/security:** skip or mask likely secrets (passwords, OTP codes, card numbers, keys); ignore list of apps
  (password managers, Voice Vault, banking) — default on; sensitive clips stay on the phone (never synced to the hub)
  unless Brett allows it; encrypted at rest on the phone; accessibility disclosure screen; clear-all.
- **Settings:** capture on/off per source, ignore list, retention, sync, AI, voice, appearance — under the
  Simple/Basic/Administrator/Developer levels toolbar.

## Steps (orchestrator draft, each ≤ 30 min) — ~9.5 h

| # | Model | Step | Est |
| --- | --- | --- | --- |
| s1 | Fable | `clip@1` / `snippet@1` / `clipdoc@1` data contracts + JSON schema + validators; link format to AmberX notes/tasks | 30 |
| s2 | Fable | Sensitive-content detector (pure, fixture) + sync rules (what never leaves the phone) | 30 |
| s3 | Opus | `axf init apps/clipx` (react-ts), manifest, chrome assets, design package, settings skeleton | 25 |
| s4 | Opus | Server: clips/snippets/docs API on axHub `_data`, auth through hub sign-in, tests | 30 |
| s5 | Opus | History grid + cards, sort/filter/search, dedupe | 30 |
| s6 | Opus | Manage: pin, tags, folders, bulk select, archive, trash, undo | 30 |
| s7 | Opus | Viewer + editor (markdown, code highlight, link/colour preview, versions) | 30 |
| s8 | Opus | Snippets: library, placeholders, fill dialog, copy | 30 |
| s9 | Opus | Docs from clips: compose, reorder, export .md, AI write-up | 30 |
| s10 | Opus | Send to AmberX notes/tasks (shared lists), peek panel | 25 |
| s11 | Opus | AI actions via the AmberX AI router (title, classify, summarise, tags) | 25 |
| s12 | Opus | Voice: speech library + Clipboard category in voice-command@1, runs from ClipX and from AmberX via axHub | 30 |
| s13 | Opus | Android shell (Capacitor) + accessibility service capture + disclosure — **needs Android exception** | 30 |
| s14 | Opus | Share target, quick tile, floating bubble, ignore list, on-phone encryption | 30 |
| s15 | Opus | Deploy: Coolify app clipx.amberxai.com, DNS + log, CI (web build, APK) | 30 |
| s16 | Opus | Tests, screenshots, README, CLAUDE.md status, THREADS.md, merge approval | 25 |

One model switch (Fable s1–s2 → Opus s3–s16).

## Clash check (Oct 28 2026)

Refactor queue had nothing touching a clipboard. Related, not clashing: AmberX notes/tasks (ClipX writes into them),
`amberx-voice-center` PR #153 (voice-command@1 — ClipX adds a category; build after it merges), `amberx-handsfree`
PR #141 (overlay pattern reused), Basic filter #155 (attach later). Re-check when the stop is lifted.
