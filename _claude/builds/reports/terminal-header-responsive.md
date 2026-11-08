# Terminal window header: responsive overflow (`terminal-header-responsive`)

Nov 8 2026 · Opus · agent Greenlight Gina · branch `claude/terminal-header-responsive`

## Brett said (verbatim)
> The header on Terminal windows that open when a headless session starts (shows the output pane and the context chain) gets squished on smaller screens: items overlap.
> 1. Make the header measure its available width (ResizeObserver, not just viewport) and adapt live.
> 2. When space runs out, move items into a three-dots overflow menu, exactly like the top banner's overflow does. Reuse the same framework overflow control, don't build a new one.
> 3. Priority order for what stays visible (title/session name and status first); setting to choose which items stay pinned.
> 4. Never overlap or clip at any width; check desktop, tablet and phone widths.

## What changed
- **Framework (one ⋯ control):** `framework/react/components/Overflow.tsx` — `useOverflow(barRef, items, on, measure?)` + `OverflowMore`. It is the banner's ⋯ lifted out: same rule (`overflowWidgets` in `core/engines/bannerwidgets.ts`, unchanged: lowest priority leaves first, last-on-the-bar first within a priority, pinned never), same ResizeObserver on the bar and every item, widths remembered so items come back as soon as there is room. `useBannerOverflow` / `BannerMore` are now thin wrappers (banner classes and attributes unchanged). CSS `fx-overflow*` in `framework/ui/axf.css`. Exported from `@axf/react`.
- **Terminal command toolbar + context chain bar** (`console-terminal/web/header.tsx`, `header-core.ts`): both bars are on that control. Priority (1–9): session name 9, status 9 (new: the front headless tab's working / waiting / done / failed dot + word), settings 7, find 6, text size 5, Claude Code / copy / paste 4, mouse / Mosh 3, hide 2; chain bar: title 9, count 8, play 6, skip 5, fold 4, speed 3. Items in ⋯ are still live (menu rows with icon + name, text size and reveal speed keep their controls), listed in bar order. The bar never wraps; if the pinned items alone are wider it scrolls sideways (scroll snap) and the session name shortens with an ellipsis (full name in the tooltip).
- **Settings:** Terminal settings → **Header** (collapsible section per bar): style (priority | compact | menu) and a Pin switch per item. Defaults pinned: session name, status, chain title. Server validates `headerPins` / `headerStyle` (`server/store.py`).
- **Parity:** `GET /header` (`header-get`) and `PUT /header` (`header-set`: `pin` + `on`, `pinned`, `style`) as plugin commands, so console voice, MCP and CLI get them.

## Checks
- `node --experimental-strip-types apps/console-web/plugins/console-terminal/test.mts` (new): 24 checks — registry, pins, styles, voice lookup, the rule at 1280 / 600 / 360 px, pinned never leaves, exact-width give-way, server mirror. Passes on Node 22.
- `python3 apps/console-web/plugins/console-terminal/test.py`: 140 → 145 (header routes, validation).
- `check-widgets.mts` 277 ok (banner rule unchanged), `check-headless-tabs.mts` 63 ok, check-theme / check-controls / check-toolbars / check-chrome-assets clean, plugin-lifecycle clean, console `tsc` clean.
- Shots (built console, mocked headless session, Playwright): 3 styles × phone 390 / tablet 820 / desktop 1440, plus the ⋯ menu open. Measured on every one: **no overlapping items, no sideways scroll** on either bar. `shots/`.

## UI Review options (toolbar assets, owner console-terminal)
1. **Priority overflow** (default) — labels kept, least important into ⋯ first.
2. **Icons first** — labels drop to icons, then ⋯.
3. **Everything in ⋯** — only pinned items on the bar.

## Gaps
- The tab strip (tabs, +, ∨) keeps its own sideways scroll; it is a `tablist`, not part of this header.
- Kotlin twin of the overflow control deferred (Android on hold); the rule itself (`overflowWidgets`) is the existing banner engine.
- Other apps that bake the framework (axHub web, AmberX, Molly) pick up the refactored banner ⋯ at their next re-bake; behaviour is identical.
