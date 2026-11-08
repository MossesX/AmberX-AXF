<!-- memory-chunk@1 source=_claude/THREADS.md lines=67-67 tokens=240 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Toolbars plugin: tap-to-confirm on touch (Urgent `toolbar-tap-confirm`, 21 steps; Brett Nov 3 voice + Addendum 1; agent Landin' Lenny, Opus): every toolbar in every app arms on the first finger tap (tip + countdown, 3 s default) and runs on the second; mouse/pen/keyboard single click; framework `core/engines/tapconfirm.ts` + `react/tapConfirm.ts` via AxfProvider; `lib-toolbars` (Settings → Plugins → Toolbars, All toolbars) in every app + templates; 37 toolbars adopted; `check-toolbars.mjs` + `check-tapconfirm.mts` in CI; rules added | part 1 PR open (s1–s7 done); s8–s12 Opus next; s13–s14 Fable (needs Brett's upgrade approval) | `claude/toolbar-tap-confirm` | [#272](https://github.com/MossesX/AmberX-AXF/pull/272) | Report `_claude/builds/reports/toolbar-tap-confirm.md`. UI Review r-20261103-6815df1d waiting. Next: s8 per-toolbar settings + context hooks | 2026-11-03 |
