# Transparency token works on every dialog and settings window — report

Build `transparency-token-works-every-dialog` · branch `claude/transparency-token-works-every-dialog` · Fable (s1), Opus (s2–s4),
one headless session · Nov 13 2026.

Brett (2026-11-13 18:26): "how come I can't see the transparency of a settings interface dialog? Everything needs to have a token"

## Root cause (s1)

The token exists and is set everywhere. Nothing a dialog or settings window is made of reads it.

**The token is live.** `framework/core/engines/theme.ts` writes `--fx-opacity-glass` on the root from the style theme's
`opacityGlass` (default 0.72, `OPACITY_DEFAULTS.glass`), next to `--fx-blur`. Every shipped style theme carries a value
(0.58 glass-pro … 0.95 swiss). Token Control lists it (`control.json` id `opacityGlass`). Changing it does change the variable.

**Only glass variants consume it.** In `framework/ui/axf.css` the variable appears in exactly four surface rules, each
behind a variant switch that the asset has to opt into:

| Rule | Switch | Asset field |
| --- | --- | --- |
| `[data-fx-menubar='glass'] .fx-menubar` | app-menu `surface: glass` | `AppMenuData.surface` |
| `[data-fx-toolbar-surface='glass'] .fx-toolbar` | toolbar `surface: glass` | `ToolbarData.surface` |
| `[data-fx-ctx='glass'] .fx-ctx` | context-menu `variant: glass` | `ContextMenuData.variant` |
| `[data-fx-card='glass'] .fx-card` | container `variant: glass` | `ContainerData.variant` |

The fifth consumer is `framework/core/engines/customize.ts` `case 'glass'`: a per-asset customization `glass: true`
compiles to the same `color-mix(var(--fx-surface) calc(var(--fx-opacity-glass) * 100%), transparent)` plus a blur, for any
type in `CUSTOM_TARGETS` (dialog and popup included). That path is dead: `axf.custom.*` is a **retired look setting**
(`RETIRED_LOOK_SETTINGS` in `engines/designpackage.ts`, `framework/spec/APPEARANCE-SOURCE.md` "Retired look settings").
It is never applied or sent, and a document that still carries it is cleaned on first read. So the one place a dialog
could have asked for glass no longer runs.

**Dialogs have no surface field at all.** `.fx-dialog` (axf.css ~914) is `background: var(--fx-surface)`, opaque.
`DialogData` (`framework/core/types.ts`) and the `dialog` entry in `framework/schemas/asset-types.json` offer
`variant` (modal / drawer / sheet), `width`, `backdrop`, `animation`, `header`, `closeOnBackdrop`. There is no `surface`
and no glass choice. The only transparency a dialog asset has is `backdrop: blur`, which frosts the scrim *behind*
the dialog using `--fx-opacity-scrim`, not the dialog itself. That is why lowering the glass token shows nothing on a
settings dialog: the dialog never reads it, and the scrim reads a different token.

**Floating windows are the same, and worse.** Settings interfaces open as floating windows (`.fx-window`, axf.css ~1293,
`FloatingWindowsHost` in `framework/react/windows/WindowHost.tsx`). `.fx-window` and `.fx-window__title` are
`var(--fx-surface)` / `var(--fx-surface2)`, with no data attribute, no glass variant, and `window` is not a
`CUSTOM_TARGETS` type, so even the retired customize path never reached it. `.fx-popover` / `.fx-dropdown` are opaque
in the same way (popup is a customize target, so same dead path as dialog).

**Why the checks did not catch it.** `framework/cli/check-theme.mjs` fails on fixed transparency (`color-mix(… NN%,
transparent)`, literal `opacity: 0.x`). An opaque `background: var(--fx-surface)` is a valid token use, so a surface
that simply never reads the glass token is invisible to the check. There is no rule saying a surface *must* read a
transparency token.

**Summary.** `--fx-opacity-glass` is a global value with no global consumer. It only acts where a chrome asset opted
into a `glass` variant (menubar, toolbar, context menu, card). Dialogs, floating windows, popovers and the settings
interfaces built on them have no such variant and no token of their own, so the "transparency" the token promises
never reaches them.

## What s2 needs to change (handoff)

Per Brett's correction on the build (no on/off switch; every surface reads its own value, default 100%, lower it to see
through; per surface type in tokens.style, overridable per instance in Quick settings):

- `theme.ts` / `StyleThemeData`: per-surface opacity tokens (dialog, settings window, panel/card, popover/menu, toolbar,
  banner), default 1. Emit `--fx-opacity-<surface>` next to `--fx-opacity-glass`. Keep `opacityGlass` as the legacy
  value the `glass` variants still read.
- `axf.css`: base rules for `.fx-dialog`, `.fx-window`, `.fx-window__title`, `.fx-popover`, `.fx-card`, `.fx-toolbar`,
  `.fx-menubar`, `.fx-banner` take `background: color-mix(in srgb, var(--fx-surface) calc(var(--fx-opacity-<surface>) * 100%), transparent)`
  plus `backdrop-filter: blur(var(--fx-blur))` so a value under 1 is visibly see-through. Framework copy first, then the
  app copies (`apps/*/src/axf/ui/axf.css`) regenerate.
- Schema + Token Control: `control.json` entries for each new token; `control-rules.mjs` types; `asset-types.json` style-theme
  optional fields; fixtures in `framework/spec/fixtures`.
- Per instance: a Quick settings slider on the dialog / window (reads and writes the same token scoped to the instance).
- Check: a `check-theme.mjs` rule that every `.fx-*` surface root with a `background:` reads a `--fx-opacity-*` token.
- Kotlin twin: deferred gap in `framework/spec/PORTING.md`.
