<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md lines=95-118 tokens=484 -->
## The baseline build (fixed reference)

A small, fully specified build that never changes. Its cost per model × effort is **measured**, not guessed.

- **Definition:** `apps/console-web/plugins/session-checkin/baseline/BASELINE-v1.md`, pinned to commit `69e855d` (tag `baseline-v1` to be created from the VPS). The build must:
  1. Read three named files: `framework/core/engines/layout.ts`, `framework/spec/PORTING.md`, `framework/schemas/asset-types.json`.
  2. Add one fully specified pure function (`compareSlots(a, b)`, spec in the file) to a scratch copy of `layout.ts`, with five named unit tests.
  3. Run `tsc --noEmit` and the tests; both must pass.
- **Where it runs:** always in a throwaway worktree at `baseline-v1`. It's never merged or pushed.
- **What's measured per run:**
  - input, output and cache-read tokens
  - tool calls and wall time
  - pass/fail
  - model and effort
- **Usage sources:** Claude Code's `/cost` / usage output, or the API `usage` fields when on an API key.
- **Calibration:** `apps/console-web/plugins/session-checkin/baseline/calibration.json`, `{ version: "baseline-v1", runs: [...] }`.
  - The estimate for a model × effort pair is the **median of its measured runs** × current prices.
  - **Pairs not measured yet** are scaled from the nearest measured pair and labelled **"uncalibrated"**.
  - **Recalibrate** only when Brett asks, or when a new model arrives. He approves each calibration run, because every run costs money.
- **Prices:** `apps/console-web/plugins/session-checkin/baseline/pricing.json`, with per-million input / output / cache-read prices for each of the three models.
  - Filled in and dated from docs.claude.com when calibrated.
  - The check-in shows the date. If it's older than 60 days, the estimate carries a "prices may be stale" tag.
- **A new baseline version** (`baseline-v2`) starts a new calibration. It never overwrites v1, so the history stays comparable.
