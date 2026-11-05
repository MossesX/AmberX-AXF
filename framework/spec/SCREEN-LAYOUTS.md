# Screen layouts (screen-layouts@1)

Every new plugin screen has three layouts and a toolbar to pick one, hidden by default. Older plugin screens are not
retrofitted.

> "From now on, all plugin screens get three layouts, and come with a toolbar to select which one, with the toolbar
> hidden by default." "Not old ones, only new ones." (Brett, Nov 4 2026)

Built on Opus. The contract is marked **Opus, possible Fable review** (see `_claude/builds/reports/three-layouts-per-screen.md`).

## Start a plugin

```bash
node framework/cli/axf.mjs new-plugin my-thing --label "My thing"
```

That gives you a plugin with `screens` in `plugin.json`, `layouts` on the view, the page wired to `useScreenLayout`, and
the hidden `LayoutToolbar`. Rename the three layouts to what fits the screen (Compact / Standard / Spacious, List / Grid /
Split, …) and branch the page on `screen.layout`.

## The contract

`plugin.json`:

```json
"screens": {
  "my-thing": {
    "layouts": [
      { "id": "compact", "label": "Compact", "icon": "list", "description": "Tight rows." },
      { "id": "standard", "label": "Standard", "icon": "layout" },
      { "id": "spacious", "label": "Spacious", "icon": "grid" }
    ],
    "default": "standard"
  }
}
```

- 3 to 8 layouts per screen. `default` is one of them; without it, the first.
- A layout is a preset of that screen, not the app's `layout` asset.
- The web library declares the same on the view: `views: { 'my-thing': { …, layouts, defaultLayout } }`.
- Validators: `framework/core/engines/screen-layouts.mjs` (`checkScreens`, used by `plugins.mjs`) and
  `apps/console-web/server/main.py` (`_plugin_screens`). Fixture: `framework/spec/fixtures/screen-layouts.json`.

## On a screen

```tsx
const screen = useScreenLayout(VIEW);
<div className="fx-stack fx-stack--lg" {...screen.rootProps}>
  <header className="fx-pagehead"><div {...screen.headProps}><h1>Title</h1></div></header>
  <LayoutToolbar view={VIEW} plugin={PLUGIN_ID} />
  {screen.layout === 'compact' ? … : …}
</div>
```

`rootProps` sets `data-axf-screen` and `data-axf-layout` on the root. `headProps` makes the title a right-click target.

## The toolbar

There is one shared toolbar asset: `framework/assets/toolbar/layout-switcher.json` (`axf.toolbar.layout-switcher`). Its
buttons come from the runtime's `screen-layouts` live list. Change the asset once and it changes in every plugin.

| Do this | How |
| --- | --- |
| Show or hide it on a screen | Right-click the screen title, or `screen.layout-toolbar:show\|hide\|toggle\|inherit[:<view>]` |
| Show it on every screen | Settings → Plugins → Toolbars → Layout toolbars |
| Pick a layout | The toolbar, the title's right-click, or `screen.layout:<id>[:<view>]` |
| Give one plugin its own copy | Right-click the toolbar, or `screen.layout-toolbar.copy:<plugin id>` |
| Go back to the shared toolbar | Right-click the toolbar, or `screen.layout-toolbar.shared:<plugin id>` |
| Change how it looks | Right-click the toolbar → Toolbar settings… |

All of these are console actions, so voice can drive them. The pick and the visibility are per screen, per device.

A copy reads the shared toolbar until it is edited. Toolbar settings… edits the shared toolbar while the plugin has no
copy and only the copy once it has one. Going back to shared drops the copy's edits. Settings → Plugins → Toolbars →
Layout toolbars lists which plugins use the shared toolbar and which use a copy.

The layout toolbar's right-click has Toolbar settings… but not Change or Move: those act on the app's toolbar, and its own
items already cover what changes it.

## CI

`node framework/cli/check-screen-layouts.mjs` fails on a plugin screen with fewer than 3 layouts, unless the screen is in
`framework/spec/screen-layouts-baseline.json`. That list is the screens that existed when the rule landed. It only
shrinks: `--update-baseline` removes screens that gained layouts and never adds one.

## UI Review

Brett: "So UI Review will only allow you to select from the three layouts it is going to generate."

- `reviewLayoutChoices(screens, view)` gives the options, with the default marked. A screen without layouts gets a
  disabled choice saying "no layout variants".
- In the console: `reviewLayoutChoicesFor(screen)` from `@console/screenLayouts`.
- From a shell: `node framework/cli/screen-layouts.mjs review --screen <view>` (`list` shows every screen with layouts).

The Layout dropdown itself comes with the `ui-review-alarm` build (addendum 5), which is not merged yet. It must use this
helper.

## Android

Deferred: see `framework/spec/PORTING.md`.
