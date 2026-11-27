# Every skin ships a light and a dark colour theme

Brett (2026-11-13 10:39): "Yo, every skin needs a light and dark."

## What shipped
- skin@1 now requires `data.colorThemes: { light, dark }`; the skin's own `colorTheme` must be one of the two.
- Pairs: Atelier orchid-mist / plum-noir, Clinic porcelain / deep-ocean, Control room glacier / obsidian,
  Ledger linen-slate / slate-steel, Newsroom mono-paper / midnight-ink, Windows windows-light / windows-dark (new theme).
- Engine `framework/core/engines/skin-modes.mjs` (skin-modes@1, pure): pair, scheme, mode → colour pick, coverage problems.
- Switching is a colour pick inside the skin (existing skin-rules `setSkinColorTheme`): the skin never forks.
- Follow system: `system` mode. In the browser the runtime follows `prefers-color-scheme` live; on the hub the
  choice is stored per app / scope in `skin-modes.json` beside the look documents.
- CI: `framework/spec/check-skin-modes.mjs` fails if any skin (including future ones) lacks either, names one that
  doesn't ship, or names one with the wrong scheme.

## How it is reached
- CLI: `node framework/cli/skins.mjs modes`, `skins.mjs mode <app> [light|dark|system] [--system light|dark] [--scope ui:<id>|plugin:<id>]`.
- REST: `GET /skins/modes`, `GET/POST /skins/{app}/mode` `{mode, system?, scope?}` (theme-manager plugin).
- MCP: those routes become tools by themselves (plugin-commands@1).
- Voice / in-app: action `skin.mode:light|dark|system`; `skin.mode` alone toggles. "Make the console dark" → POST mode.
- Deep link / state: the skin in force and its scheme read from `GET /skins/{app}/mode`.

## Not done / follow-ups
- No new UI control in this phase: the existing banner theme-switch widget still swaps the app's own pair. A per-skin
  light/dark toggle in the Skins menu is a follow-up (needs UI Review shots).
- Open PR #557 (Studio Pro, Executive, Field, Command skins) must add `colorThemes` to its four skins when it lands
  after this, or check-skin-modes and schema validation fail. Its themes: studio-pro-slate, executive-ivory, field-day,
  command-phosphor each need a partner of the other scheme.
- Design packages (day/night packages already exist) are not skins and are not covered by the check.
- Android twin deferred (framework/spec/PORTING.md).

## Checks
check-skin-modes, check-skin-sections, check-skin-colour-rule, check-skin.mts (917 checks), check-skin-coverage,
axf validate (framework + apps), shared-assets check, check-theme, check-controls, plugin-lifecycle theme-manager,
theme-manager test.py (37), check-console-commands, console-web tsc (no new errors in runtime / skin-modes).
