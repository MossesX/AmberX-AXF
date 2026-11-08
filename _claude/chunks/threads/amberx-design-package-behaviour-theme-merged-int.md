<!-- memory-chunk@1 source=_claude/THREADS.md tokens=628 -->
### AmberX Design Package + Behaviour theme (merged into enterprise-branding)
- **Orchestrator (Oct 27 2026):** build `design-package`, Fable s1-s5 then Opus s6-s9 (one switch).
- **Asked (Brett, Oct 27 2026, in the "Repo thread status review" chat):** "Make new AmberX Design Package asset type
  that wraps style theme, color theme, layout theme, and behavior theme. Add behavior theme asset type too. Apply
  option to select one in appearance section of settings. Wrap the rest of interface in collapsible container."
- **His answers (cards):** the Design Package **replaces** the Appearance package (`appearance-package`); a behaviour
  theme holds **everything**: motion (animations, speed, easing, reduced motion), interaction (hover/click/focus
  feedback, long-press time, double-tap), windows & dialogs (open/close, snap, stacking, drawers, pop-ups) and
  feedback (toasts, sounds, vibration, confirm-before-delete); "the rest" = the rest of **Settings → Appearance** in
  one collapsible container under the Design Package picker; model **Fable**.
- **Model:** Fable (new cross-app asset types + engines). Web first; Android twin goes in `framework/spec/PORTING.md`.
- **Plan:** pending item `design-package` (9 steps, 4.5 h; `node framework/cli/pending.mjs --steps`). Branch
  `fable/design-package`. Read first: `framework/schemas/asset-types.json`, `framework/core/engines/appearancepackage.ts`
  (what is being replaced), `framework/core/engines/looktokens.ts` (behaviour fallbacks), `framework/libs/settings`
  (Appearance tab), `framework/assets/appearance-package/`.
- **Overlaps:** `settings-asset-fable`, `appearance-asset-tokens-fable`, `apply-all-levels-fable`, `asset-templates`
  (all Fable, all touch Settings → Appearance or the asset types): say which to build together before starting.
- **Waiting on:** Brett, before step 6, on where the Appearance package's extra settings go (spacing, shown/hidden
  chrome, the other slot picks, customize tokens) once it is retired.
- **Checks:** `node framework/cli/axf.mjs validate --framework`, `npx -y tsx framework/spec/gen-fixtures.mts`, the new
  `check-behavior.mts` / `check-design-package.mts`, `check-appearance-package.mts` (replaced), `check-settings-ui.mts`,
  each re-baked app's typecheck + build, `node framework/cli/check-theme.mjs`, `check-controls.mjs`.
- **First message:** "Start the thread *AmberX Design Package + Behaviour theme* from `_claude/THREADS.md` → To carry
  on (pending item `design-package`). Run on Fable."
