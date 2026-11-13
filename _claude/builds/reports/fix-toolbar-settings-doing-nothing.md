# Fix toolbar settings doing nothing

Build `fix-toolbar-settings-doing-nothing` (Phase 1, Opus). Brett, Nov 13 2026:

> when I long-press / right-click a toolbar and open toolbar settings, none of the settings change anything. Selecting
> icons, text, collapsible etc. has no effect. Seen on Shipped features (Sync/CSV/Markdown bar, group-by tabs, filter
> checkboxes, status chips, edit status). Fix it so every toolbar setting actually applies live to that toolbar, on
> every toolbar in the console, persists, and is controllable by API (REST, MCP, CLI, voice). Add a test that changing
> each setting changes the rendered toolbar.

## s1 Why nothing changed (diagnosis)

- Right-click / long-press on any `role="toolbar"` opens the chrome settings dialog (chrome-settings@1,
  `framework/react/components/ChromeContext.tsx`) for instance `slug(data-axf-toolbar | data-axf-toolbar-asset |
  aria-label)`, e.g. `shipped-features-actions`.
- The dialog writes the choice to the setting `axf.chrome.toolbar.<instance>` (`setChromeField`). That part works:
  the value is saved.
- **Nothing reads it.** Only `TabGroup` merges its instance overrides (`chromeInstanceData`). The app toolbar
  (`Chrome.tsx` `Toolbar`) renders straight from the toolbar asset, and the hundreds of page toolbars (plain
  `<div role="toolbar">` in plugins) have no renderer of their own at all. So every toolbar field (Buttons, Align,
  Size, Surface, Rule between groups, Search box, Collapsible) was stored and ignored. Only Tap to confirm worked,
  because `react/tapConfirm.ts` reads the same key.
- Second bug: `setChromeField` drops an override that equals the *app toolbar asset's* value. For a page toolbar that
  meant picking **Icons** (the toolbar asset's default) saved nothing at all, so even a working renderer would not
  have seen it.

## s2 Fix: every toolbar draws its settings, live

- New `framework/react/toolbarLook.ts`, installed once by `<AxfProvider>` (next to tap-to-confirm): finds every
  `[role="toolbar"]` now and as pages open (MutationObserver), reads `axf.chrome.toolbar.<instance>` and writes
  `data-axf-tb-*` attributes; a change of any setting re-applies them at once (settings subscription).
- `framework/ui/axf.css` draws them from tokens: Buttons (Icons hides button text but keeps it for screen readers,
  Labels hides icons), Align, Size, Surface, Rule between items; Collapsible adds a fold button (fold saved per device,
  `axf.toolbars.<instance>.folded`); Search box adds a filter box that hides items (and chips in a group) that don't match.
- Only what a person set is written: an unset toolbar looks exactly as its plugin built it.
- Page toolbars now compare with how they were built (`TOOLBAR_AS_BUILT`: Icons + labels, start, regular, flat, no
  rule), not with the app toolbar asset, so picking Icons is saved.
- The app toolbar (`Chrome.tsx`) merges its own instance (`app`) settings over its toolbar asset; it lists the fields it
  draws itself in `data-axf-tb-native` and the host draws the rest.

## s3 Shipped features

The three bars Brett named are plain plugin toolbars, so they get it with no plugin change:

| Bar | Instance (context menu opens) | Contents |
|---|---|---|
| Sync / CSV / Markdown | `shipped-features-actions` | icon buttons: Buttons Icons / Labels visibly switch |
| View by + Search | `shipped-features-view` | segmented "group-by" tabs + search field |
| Filters | `shipped-features-filters` | checkboxes, status chips (group), Edit status select, Clear |

`framework/spec/check-toolbar-settings.mts` renders the same three bars from the same framework controls inside the
real AppShell and changes every setting on each of them. Buttons Icons / Labels only has something to switch where a
button has an icon; on the filter bar (checkboxes, chips) the other six settings are the visible ones.

## s4 Every toolbar, persisted, by API

- Every toolbar in every app on the framework (console, axHub web, AmberX, Molly, walkthrough-studio, demo) gets it
  through `<AxfProvider>`; no plugin change. Settings live in the settings store (`axf.chrome.toolbar.<instance>`,
  fold `axf.toolbars.<instance>.folded`), so they survive a reload and sync like every other setting.

| What | Console API (REST) / MCP `console_action` | CLI / voice (AmberX) |
|---|---|---|
| Open a toolbar's settings (deep link) | `chrome.settings:toolbar:<instance>`, e.g. `chrome.settings:toolbar:shipped-features-actions` | same action ("open toolbar settings") |
| Set one setting | `chrome.set:toolbar:<instance>:<variant\|align\|density\|surface\|divider\|showSearch\|collapsible\|tapConfirm>:<value>` | same |
| Put one back | `chrome.unset:toolbar:<instance>:<field>`; all of them `chrome.reset:toolbar:<instance>` | same |
| Fold / unfold | `toolbar.fold:<instance>:<on\|off\|toggle>` (new) | same |
| Read state | console catalog `field` "Toolbar: <name>" per toolbar on screen or with saved settings (`console_list settings`): what is set, folded, on screen | same |

Values: variant `icons | icons-labels | labels`, align `start | center | spread`, density `compact | regular | roomy`,
surface `flat | raised | glass`, toggles `on | off`.

## s5 Test

`framework/spec/check-toolbar-settings.mts` (jsdom, real AppShell + AxfProvider; in CI next to Help mode): 146 checks.
Right-click → Toolbar settings… → Icons is saved and drawn; every field × every value on each of the three Shipped
features bars changes the rendered toolbar and unset puts it back; the stylesheet has a rule for every value;
collapsible fold by click and by `toolbar.fold`; search box filters buttons, checkboxes and chips; the app toolbar
draws its own Buttons setting; state reads back for the API; a new runtime on the same storage (reload) and a toolbar
that appears later get the saved settings.

## s6 Checks

- `check-toolbar-settings.mts` 146/146, `check-tapconfirm.mts` 80/80, `check-chrome-settings.mts` 282, `check-help-mode.mts` 43
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` green
- console-web `tsc --noEmit` with the framework copied in as CI does: 0 errors
- Shots (jsdom render of the shell with the three bars, in Chromium, desktop + phone): before, after (actions Icons +
  Raised, view Spread, filters Collapsible + Search box + Rule + Roomy), folded.

## Notes

- Buttons Icons / Labels switches buttons that have an icon (and segmented options' icons); a checkbox or chip has no
  icon to show, so on the filter bar the other settings are the visible ones.
- No core engine or contract changed (chrome-settings@1 fields are as they were); no fixture or Kotlin twin needed.
- Other baked apps (axHub web, AmberX, Molly, walkthrough-studio, demo) get it on their next rebake / CI copy.
- UI Review: not sent. `review.mjs submit --console` needs AXF_CONSOLE_URL + AXF_TOKEN, which this headless session
  doesn't have, and `axf shot` only saved locally. The six shots are in `_claude/builds/reports/fix-toolbar-settings-doing-nothing/`
  (`before|after|folded`-`desktop|phone`.png). To submit: `node apps/console-web/plugins/ui-review/review.mjs submit --kind toolbar
  --name "Toolbar settings apply live" --app console-web --screen shipped-features --group "fix-toolbar-settings-doing-nothing - Nov 13 12:45 PM"
  --shots <those six> --branch claude/fix-toolbar-settings-doing-nothing --pr 572 --console --single-option "Bug fix"`.
