# Per-instance settings: small live preview pane

Build `per-instance-settings-small-live-preview` · Phase 1 (Opus) · branch `claude/per-instance-settings-small-live-preview`

## Brett said (verbatim)
> on the per toolbar, per nav menu, per application menu, per tab group settings I need a small preview pane, a couple of icons or two tab groups with some seed data, showing what the settings look like

## What shipped
- **Preview pane** (`framework/react/components/ChromePreview.tsx`) at the top of every instance's settings dialog
  (`ChromeSettingsPanel`), under the header and above the interface picker, in every layout (tabs, side tabs, list,
  and the built-in fallback when an app ships no settings interface).
  - Toolbar: three seed buttons in two groups, one with a badge, one pressed (`fx-toolbar` / `fx-toolbtn`), plus the
    search box when the instance shows it.
  - Tab group: two seed tab groups (Mail: Inbox 4 / Drafts / Sent; Views: Board / List / Chart), one tab active in each,
    drawn by the real `TabGroup` through a new `previewOf` prop: the rows take the instance's asset pick and overrides
    live, but save no last tab or fold, register no control targets and are not counted as tab groups on screen.
  - Navigation menu: Home / Projects (selected) / Reports (badge) / Settings (`fx-nav`).
  - Application menu: File (open) / Edit / View menu bar with the File menu below it, Open recent as a submenu (real
    `MenuList`).
  - Context menu: Cut / Copy / Paste with shortcuts (real `MenuList` in `fx-ctx`).
  - Banner: no pane (Banner settings has its own); a `dialog` chrome kind does not exist yet (still open on Fable).
- **Live**: the pane carries the style-engine output (`toolbarStyle`, `navMenuStyle`, `appMenuStyle`,
  `contextMenuStyle`; the TabGroup its own) of the instance's effective data, so each field change shows the moment
  it is set. Settings in these dialogs save on change (there is no Apply button), so "before Apply" = before leaving
  the dialog. The stylesheet rules that a root attribute turns on are restated scoped to the pane, so the pane shows
  the instance even when the app's own toolbar / nav / menu bar is set differently.
- **Bar**: App's / Light / Dark sample colours (the first installed colour theme of that scheme; a note when none),
  Off / Hover / Press demo on one seed item, Hide / Show. All three are device settings shared by every dialog.
- **Engine** (`core/engines/chrome-settings-rules.mjs`): `CHROME_PREVIEW_SEED`, `CHROME_PREVIEW_*_KEY`,
  `chromePreviewState`, `chromePreviewChange`, `chromePreviewModel`; fixture `spec/fixtures/chrome-settings.json` →
  `preview`; Kotlin twin recorded as a deferred gap in `spec/PORTING.md`.

## API (all four the same)
- Deep link: `chrome.settings:<type>:<instance>` opens the dialog with the pane on top (console_open / console_action).
- Actions: `chrome.preview:<open|close|toggle>`, `chrome.preview:scheme:<app|light|dark>`,
  `chrome.preview:demo:<none|hover|press>` (bare `dark`, `hover`, `off` work too): REST console action, MCP
  `console_action`, CLI (`axf` console action), voice (AmberX, through console_action).
- State: control target `panel:chrome.preview` (seed, the field values it draws, open / scheme / demo); set = a
  change word. The three settings are readable as `axf.chrome.preview.{open,scheme,demo}`.
- Every field the pane shows is still `chrome.set:<type>:<instance>:<field>:<value>`.

## Checked
- On screen (demo app built from this branch, Playwright): every dialog shows the pane, desktop 1280 and phone 390;
  `chrome.set` changes (Icons + labels, Raised, Pills) show at once; Dark sample, Hover and Press demo, Hide.
  Captures in UI Review → Screenshots, group `per-instance-settings-small-live-preview`.
- Seen: in Icons + labels the seed badge sits over the end of "Open" (the real toolbar badge position).

## Tests
See the s3 section below.

## Tests (s3)
- `spec/check-chrome-settings.mts` 364 checks (new `preview` section: keys, defaults, junk, every change word, toggle
  both ways, model = asset + overrides, seed has two tab groups with an active tab, a submenu, one selected nav item,
  a badge, and only shipped icons); fixtures regenerate with no drift.
- `check-chrome.mts` 130, `check-tab-group.mts` 445, `check-tapconfirm.mts` 80, `spec/check-console-control.mts` 290.
- CLI: check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control all green.
- console-web `tsc --noEmit` (baked from this branch): no errors in changed files.
- `check-help.mts`: the new entry validates and the four app copies match; it then stops at help-coverage on the
  `gizmo-guide` tab (molly-guide plugin), which fails on main too.

## Still open
- Banner: no pane here (Banner settings has its own preview). `dialog` chrome kind and the per-instance transparency
  field are still open on Fable (per-toolbar-settings follow-up); the pane will draw them once they exist.
- Kotlin twin of the pane and engine functions: deferred (PORTING.md).
- UI Review queue: not submitted. `review.mjs submit --console` needs AXF_CONSOLE_URL + AXF_TOKEN, and this headless
  session has neither. Captures are in Screenshots (group `per-instance-settings-small-live-preview`).
