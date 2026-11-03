# molly-nav-submenus: Molly navigation sub menus + Navigation settings

Build `molly-nav-submenus` (Current profile), Nov 3 2026, Opus, branch `claude/molly-nav-submenus`.
Agent: Reel Rhonda (headless worktree; the router is on main only).

Brett (voice): "I want Molly to have the console's navigation menu slide open, like when you click console, have a sub
menu slide open, show its menu, and same thing for AXHub and AmberX. Have a sub menu slide open with an animation and
give the navigation menu its own settings interface to control everything. The theme, the way it looks, its animation,
its behavior, all that."

## What changed

### Framework (s4: opt-in for any app)
- **nav-style@1**, a new optional shared asset type (`framework/schemas/asset-types.json`). Its fields live in one registry:
  `core/engines/navstyle-rules.mjs`, shared by the TS engine, the build engine's validator, control@1 and the
  settings UI. The engine is `core/engines/navstyle.ts`: it compiles to `--fx-navs-*` tokens and `data-fx-navs-*`
  attributes, and it holds the pure tree logic (open/close, single vs many, follow the active page, pinned/hidden/order).
- Six presets in `framework/assets/nav-style`: standard, glide, accordion, soft-fade, push, still. They are baked into
  every shared app. Colours are colour-theme token ids, never literals. `theme` leaves a value to the stylesheet.
- `NavItem.items` adds children, nested as deep as the data goes. A nav-menu opts in with `navStyle: true`. Any other
  nav is drawn exactly as before, because `NavMenu` only hands off to the new `NavTree` when the nav opts in.
- `react/components/NavTree.tsx` draws the sub menus with these animations: slide / accordion / fade / push / none,
  plus duration, easing, stagger and chevron rotate/flip. Reduced motion is respected (from the system or forced).
  Other behaviour:
  - Hover-open on desktop.
  - On a phone, a bottom sheet slides up: swipe up opens it, swipe down closes it.
  - The nav can collapse to icons and can be resized by dragging its edge.
  - Open state, width and collapse are kept per device: `axf.nav.open`, `axf.nav.width`, `axf.nav.collapsed`.
- `react/components/NavStyleSettings.tsx` is the settings interface. It has one panel per group: presets + live
  preview + reset, colours, font, icons, density, width, animation, behaviour, and items (order / pin / hide / accent).
  Any app that opts in can mount it.
- `mergeNavSections` now lets a contributed item hang children on an existing item with the same view.
- control@1 target **`tokens.nav`** is appended last (append-only), with settings key `axf.tokens.nav`. Every nav
  setting is a token override, so it rides the axHub look. REST, MCP and the CLI get the same values from the one
  registry: `axf token nav set animation.kind push`. Python `mcp_server.py` and the Token control plugin list it.
- Runtime additions:
  - `navStyleData()`.
  - `styleSettingsKey()`: the provider now re-applies styles when token overrides or the nav state change. That also
    fixes live token overrides, which used to wait for the next swap.
  - `shareChrome` also sends contributed nav sections (plugin pages), so an app's full nav reaches Molly.

### Molly (s1–s3)
- `src/assets/nav-menu/molly.json` sets `navStyle: true`. The manifest default nav-style is `standard`.
- xLayout (`plugins/xlayout/web/host.ts`) hangs each app's live nav under that app's own entry. The nav comes from the
  chrome@1 bundle the app sends, with no hard-coded lists. Labelled sections become nested groups. Tapping an item
  opens that page in the app's frame, and the active page highlights and opens its own branch. When sub menus are off,
  it falls back to the old one-section-per-app layout.
- New plugin `plugins/navigation`:
  - Settings → Plugins → Navigation.
  - Right-click the nav → Navigation settings / Collapse to icons / Reset.
  - View → Navigation settings / Collapse navigation.
  - Actions `navigation.get|set|reset|preset|open|settings|collapse`, declared in plugin.json `commands`.

## Tests
- `npx -y tsx framework/spec/check-navstyle.mts`: 98 checks (new).
- `check-control.mts`: updated for the 23rd target. `check-xlayout` 199, `check-chrome` 130, `check-embed` 429,
  `check-dock` 1679, `check-appearance` 107 and `check-design-package` 1158 all pass.
- `check-theme.mjs` and `check-controls.mjs` are green. `axf validate --framework` reports 498 valid.
- Molly `tsc` and `vite build` pass.
- Browser run (Playwright, stub app frames that send chrome@1 exactly as the guests do):
  - Console opens with nested Build / Studio groups.
  - Picking Pending builds opens it.
  - axHub opens and Console closes (single mode).
  - The context menu shows Navigation settings.
  - The settings page renders.
  - The phone sheet slides up with nested groups.
- Fixtures regenerated: `nav-style.json` (new), plus `control.json`, `appearance.json` and `roll.json` (new slot).

## Known gaps
- The live apps send their full nav (plugin pages) only once Console, axHub web and AmberX are redeployed with this
  framework. Until then Molly shows what they already send: the nav-menu asset's items.
- chrome@1 still folds each app's sections into one in `mergeChrome`, so xLayout reads the raw bundle to keep the
  section labels. The contract is unchanged.
- Android twin deferred (`framework/spec/PORTING.md`).
- The nav-style contract was built on Opus (web-only, additive, opt-in). Under the shared rule, Opus-built foundation
  work gets a Fable review.
