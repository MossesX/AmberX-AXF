# Banner widgets (build `banner-widgets`, Opus, Nov 5 2026)

Asked: pick which widgets sit on the top banner, settings for each one's size and room, usage meter on it.

## What landed

- **Widgets…** on right-click or long-press of the banner, in Banner settings and in View: every widget with a checkbox, drag or arrows to reorder, a live preview, and the banners under the bar.
- **Widget settings** per widget: size (icon only, compact, normal, wide), what it shows, max width in px or characters, hide when empty, may move into `⋯`, priority, region. Right-clicking a widget also offers Hide.
- **Overflow:** when the bar runs out of room, the lowest-priority widgets move into `⋯` and come back when there is room. Works in the banner and Molly's banner strip.
- **Compact by default:** chips cap at about 100 px with an ellipsis, so the What's new ticker no longer takes half the bar. The alerts bell stays on the bar.
- **One registry:** `rt.attachToBanner` plus the banner asset's `attach` list. Anything attached shows up in the picker. `check-banner-widgets.mjs` fails CI on a hard-coded chip.
- **Saved** per app and per form factor (phone or computer) in a look setting, so it syncs through axHub. Reset to default clears it.
- **API, MCP, CLI, voice:** the existing console action route, `banner.widget:<name>:<hide|show|reset|size>`. No new tool or pin.

## Contract notes (for a later Fable review)

- Optional `widget` hint on a host attachment (`HostAttachment.widget`). No asset type or schema changed; `check-widgets.mts` covers the engine, there is no fixture yet.
- Kotlin twin deferred in `framework/spec/PORTING.md`.

## Known gaps

- **Usage meter:** the `usage-meter` build had not landed when this was written (branch has no commits, queued behind the agent cap). Its chip appears by itself once it attaches; docs give the exact call. It was exercised here with a stand-in chip of the same shape.
- **Per device** means per form factor, not per physical phone.
- Region and order stay in the shared arrangement (`axf.widgets.arrange.banner`), so they are not per form factor. That is what keeps arrange mode and the picker in agreement.
- A chip whose plugin has taken it down is listed under *Not on the bar right now* only after it attached once this page load.
- Shots use a console with no server behind it, so plugin chips show their offline text.
- Molly's strip shares the same code but was only typechecked and built, not opened in Molly.

## Checks

Driven in a real browser (Playwright, console build): right-click on a widget, long-press on a phone viewport, reorder arrows, pointer drag, checkbox hide, Reset, `banner.widget` actions for hide and size, overflow at 620 and 390 px wide.

Engine job steps run locally: 45 steps, 41 passed. The four failures were looked at: help coverage was mine and is fixed. Plugin lifecycle hit git-ignored synced files CI doesn't have. `check-agent-slots` and the session check-in test failed in this headless environment on code this build doesn't touch (the check-in test fails the same on `/opt/axf`).

Shots: `_claude/builds/reports/banner-widgets/shots/`.
