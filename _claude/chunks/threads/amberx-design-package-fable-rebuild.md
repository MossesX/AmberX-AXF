<!-- memory-chunk@1 source=_claude/THREADS.md lines=617-629 tokens=289 -->
### AmberX Design Package (Fable rebuild)
- **Built on Opus (Oct 27 2026, Brett: "Do in opus"):** branch `rebuild/design-package-opus`. New types `design-package`
  (style + colour theme + layout + behaviour theme, optional `extras` = what the appearance package held) and
  `behavior-theme` (motion, interaction, windows, feedback); `appearance-package` retired and migrated. Settings →
  Appearance: AmberX Design Package picker on top, everything else in one collapsible *Everything else* container.
  Report `_claude/memory/docs/rebuilds/design-package.md`.
- **Fable rebuild:** pending item `design-package-fable` (steps in the pending list). Starts by reading the report and
  replacing the Opus build in place (same type names, data format and setting keys unless it says why).
- **Checks:** `npx -y tsx framework/spec/check-design-package.mts`, `gen-fixtures.mts`, `axf.mjs validate --framework`,
  re-baked apps' typecheck + build, `check-theme.mjs`, `check-controls.mjs`.
- **First message:** "Start the thread *AmberX Design Package (Fable rebuild)* from `_claude/THREADS.md` → To carry on
  (pending item `design-package-fable`). Run on Fable."
