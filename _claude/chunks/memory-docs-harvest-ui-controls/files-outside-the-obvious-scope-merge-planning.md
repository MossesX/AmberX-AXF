<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md lines=131-141 tokens=197 -->
## Files outside the obvious scope (merge planning)

- `framework/core/index.ts`, `framework/react/index.ts` (new exports), `framework/ui/axf.css` (+71 lines of `.fx-*`).
- `framework/android/axf-kernel/.../contract/UiKit.kt` (5 new `ComponentKind`s), `framework/cli/ui-port.mjs` (same list).
- `framework/libs/settings/index.tsx` (toggle rows use `Switch`).
- `apps/console-web/src/api.ts` (re-exports), `src/views/{Wizards,Explorer,Boilerplates}.tsx`, `src/console.css`
  (`.cx-switch` removed), `src/axf/**` re-baked (core, react, ui, libs — exact copies of `framework/`).
- `apps/console/app/src/main/kotlin/app/{ConsoleRepo.kt,views/WizardsView.kt}`.
- `.github/workflows/android.yml` (one line: the new checker).
- `_claude/memory/docs/harvest/ui-controls/shots/` (3 MB of PNGs).
