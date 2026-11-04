# Follow Amber

One switch (Settings → Plugins → Follow Amber, the right-click menu anywhere, or the banner chip). While it's on,
whatever Amber mentions opens in the console (`console_show`: MCP, `POST /api/plugins/follow-amber/show`,
`axf follow-amber show`), and axHub's held / confirm calls pop up as one-tap Approve / Deny dialogs.

## The flash (Nov 4 2026)

Brett: "every time I ask you to open a screen for me, whatever item I'm referencing, flash the background a certain
color. Five times." Yellow and orange.

When a `show` opens something, the item Amber referenced scrolls into view and its background flashes:

- **What flashes:** the `highlight` match (a CSS selector, else the visible text: a row, card, build, step, setting,
  button or heading). When the text matches several items, the best one wins: exact text first, then the one in the
  dialog or window on top, then the visible one, then the shortest (the row, not its whole list). A cell or label
  flashes its whole row or card. No highlight: the opened dialog, settings tab or screen flashes.
- **How:** the framework class `fx-attn-flash` (`framework/ui/axf.css`): 5 flashes alternating the colour theme's
  `--fx-flash-a` (yellow) and `--fx-flash-b` (orange), text on it in `--fx-flash-text`, 2.5 s at normal speed. Background and box-shadow only, so
  nothing moves. With reduced motion on, one outline pulse instead.
- **Settings** (Settings → Plugins → Follow Amber → *Flash what Amber opens*): on / off, the two colours (left at the
  default = the colour theme's), flashes (1–10, default 5) and speed (slow / normal / fast).
- **Amber knows it landed:** each show frame carries an id; the console that flashed answers `POST flashed` with the
  item's label, and the `show` result carries it as `flashed` (`''` = nothing found or the flash is off, `null` = no
  console answered within 5 s).

Works wherever the console runs: the console itself, Molly's Console tab, embedded panes, floating windows and phones.

## Tests

```bash
python apps/console-web/plugins/follow-amber/test.py
cd apps/console-web && npx -y tsx --tsconfig tsconfig.json plugins/follow-amber/web/check.mts
```
