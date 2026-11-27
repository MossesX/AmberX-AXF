# Look regression s5: skins-only branch vs pre-skins-only-2026-11-09

Baseline: 6ad482ea3 (claude/appearance-skins-colour-themes-only-remove-design-packs, 2026-11-09T18:42:36.741Z)
Current: daa63898f (claude/appearance-skins-colour-themes-only-remove-design-packs, 2026-11-10T18:10:52.396Z)

**Verdict: blocked.** 1397 unexpected differences (shots 543, vars 496, menus 260, errors 60, settings 30, storage 6, catalog 2). The diff exits 1; this branch must not land until the blockers below are fixed and the rest is declared expected.

## Blockers (real look changes)

1. **Default look not identical: `defaults.skin` is never applied at boot.** `appliedSkin()` only reads it as a name. Before, the `design-package` default was applied on first start. Molly now shows its manifest sections (`fresh-light` / `fresh`, normal spacing) instead of Hub Default (`hub-night` / `hub`, tight spacing): 92 `--fx-*` variables changed per viewport (accent #f5a524 → #4f46e5, bg #0f1012 → #f6f7f9, space 3.4px → 5.6px). The fix belongs in the runtime boot path (framework/core/runtime.ts, kernel: Fable).
2. **The console's default look changed.** Before: Sage Paper / Geometric / Signature Dock, light, with a status bar. After: Hub Default (dark amber, tight, toolbar and status bar hidden). See the before/after shots of Settings → Appearance. The vars diff for console-web desktop did not flag it, so the walker's `:root` capture for the console needs a check as well. Brett has to say which look is right: Hub Default for every app (the Nov 1 rule) or each app's look from before. The answer goes in expected/skins-only.json or the runtime.
3. **Console Skin round trip has no effect with the hub off.** Choose… → AmberX Signature Day → Apply changed 0 variables (`original: (none)`, `changedNow: 0`). `useSkin(true, id)` with no app-look document (hub off) does nothing. The shared-document fallback from s2 does not cover the console source (kernel: Fable).

## Fixed in this phase

- Theme manager (Plugins → Snapshots) crashed on skin section types with no asset in force (`reading 'data'`). Fixed; the console now walks with 0 page errors.
- Console menu reach: Previous skin and A random skin were missing from View → Look. Added.
- axHub help ratchet: 170 controls, 100% covered after the theme controls were removed.
- Walker: temp-folder cleanup no longer aborts a record.

## Noise to declare or re-baseline (not look changes)

- menus / shots / errors: live data that moved since the baseline (pending builds, banners, plugin routes that fail with the hub off, plugins added since Nov 9). Re-record the baseline on main at the same data snapshot, or mask live lists, before the next diff.
- amberx-droid phone: 266 `vars` removed and the settings walk lost every tab, so the walk failed on that viewport. Rerun it.
- walkthrough-studio: 22 vars added per viewport (new variables, not changed values).

Full report and diff PNGs: /root/axf-builds/_regression/skins-only-s5/report/report.md · findings.json · diffs/ (outside the repo; PNGs are large).
