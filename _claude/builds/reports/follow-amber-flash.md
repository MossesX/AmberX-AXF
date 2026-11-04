# Follow Amber flash (build `follow-amber-flash`, Opus, Nov 4 2026)

## Brett said (verbatim, Nov 4 2026, voice)

> When you open something, every time I ask you to open a screen for me, whatever item I'm referencing, flash the
> background a certain color. Five times.

Asked which colour: "Yellow and orange."

## What changed

**Framework (web)**
- Colour themes carry three optional tokens `flashA` / `flashB` / `flashText`; all 30 framework colour themes ship them
  (yellow `#ffd60a`, orange `#ff8a00`, dark text `#1a1205`). `colorThemeVars` (`core/engines/theme.ts`) emits
  `--fx-flash-a` / `--fx-flash-b` / `--fx-flash-text` and fills `FLASH_DEFAULTS` when a theme has none (rolled and
  older themes). Not added to the required token list, so every existing theme stays valid.
- `ui/axf.css`: class `fx-attn-flash`. Background + box-shadow flash, `--axf-attn-count` times (default 5),
  alternating the two colours, one flash every `--axf-attn-period` (default 500 ms, so 2.5 s in all). One keyframe pass
  covers two flashes, so the iteration count is count / 2 (5 = a b a b a). Nothing moves. Reduced motion (media query
  or `data-reduced-motion`) gets one outline pulse instead.
- Fixture `spec/fixtures/theme.json`: three more vars per colour theme. Kotlin `ThemeEngine.cssVars` already passes
  every theme token through, so the conformance test holds on the shipped themes; the default-fill twin is a deferred
  gap in `spec/PORTING.md` (Android on hold). `THEMING.md` lists the tokens.
- Re-baked: console `src/axf` (rebake.mjs), shared assets into axhub-web / amberx-droid / molly.

**Follow Amber plugin**
- Client (`web/index.tsx`): on a `show` frame it finds the referenced item, scrolls it into view and flashes it. The
  item is the `highlight` match: a CSS selector (first visible match), or the best text match on the page. With no
  highlight it's the opened dialog, the settings tab or the screen (`.fx-main` / the focused window). A matched cell
  or label flashes its whole row or card.
- Best match (`web/core.ts` `pickBest`, pure): exact text, then inside the dialog or window on top, then visible, then
  the shortest text (the row, not its list), then document order. Partial matches count only when the text is close
  in size to the highlight.
- Settings (Settings → Plugins → Follow Amber → *Flash what Amber opens*, framework settings interface): Flash it
  (on), First colour / Second colour (colour pickers, default yellow / orange; left at the default = the theme's
  token, so a theme swap still recolours it), Flashes (1–10, default 5), Speed (slow 750 / normal 500 / fast 300 ms).
  Help entries added.
- Server: every show frame carries an `id`. The console that flashed answers `POST /flashed {id, client, label}` and
  the first report wins. `show()` waits up to 5 s (only when a console is following) and returns `flashed`: the label,
  `''` (nothing found or flash off), or `null` (no console answered). The message says "opened X, flashed Y". MCP
  `console_show` docs mention it. The route is listed as a skipped command in plugin.json.
- `README.md` for the plugin (new).

## Tests

| check | before | after |
| --- | --- | --- |
| `plugins/follow-amber/test.py` (server) | 33 | 41 (show id, report taken / first wins / late dropped, `flashed` label, nothing found) |
| `plugins/follow-amber/web/check.mts` | 11 | 17 (frame id, prefs defaults + clamps + colour override, theme vars, best match, label) |
| console `tsc --noEmit` | pass | pass |
| check-theme, check-controls, check-toolbars, help-coverage --check, check-plugin-commands, shared-assets check, validate --framework | pass | pass |

## Screenshots

These are in UI Review → Screenshots, group *follow-amber-flash - Nov 4 4:45 PM* (non-blocking), with copies in
`follow-amber-flash/shots/`. Each shows the referenced row mid-flash, yellow then orange, on a dark theme (hub-night)
and a light one (porcelain), desktop and phone. They come from a static harness built on `framework/ui/axf.css` and
the theme fixture vars, not the live console, which shows "Waiting for axHub" under Playwright on this host.

## Known gaps

- Children that set their own text colour (muted spans inside a row) keep it during the flash; the row's own text
  takes `--fx-flash-text`.
- Several consoles following at once: every one of them flashes, and the first to answer names the label.
- Android: default-fill for themes without the tokens, and a Compose flash (deferred, PORTING.md).
