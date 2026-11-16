# Every settings interface gets collapsible sections

Build `every-settings-interface-gets` (Opus). Brett, Nov 16 2026: "Why don't these settings interfaces have collapsible sections?"

Branch `claude/every-settings-interface-gets`.

## Result

Every settings interface now groups its fields into collapsible sections, by default, with no per-plugin work:

- **Settings page** (every tab and sub-tab, so every plugin's Settings → Plugins sub-tab): each group and each panel is a section with a header and chevron. The level containers (Available at … / More settings) were already collapsible and now share the same state.
- **Plugin panels built on the framework `Section`**: inside a settings panel, `Section` renders as a collapsible section with a stable id (`settings-panel:<panel id>/<title slug>`). Voice notes, AI keys, GitHub App, Vinny, To-do and the rest fold without code changes.
- **Claude settings**: each tab's groups are sections, with Expand all / Collapse all.
- **Chrome settings** (tab groups, toolbars, banners, nav, menus): Look / Behaviour / the tab-group token overrides / every extra group from the settings asset are sections; the list layout folds per tab.
- **Banner settings**: Hide / Look / Behaviour / the banner's own settings are sections.
- **Open / closed is remembered per user** (setting `axf.settings.sections`).
- **Expand all / Collapse all** bar (role="toolbar") on any tab with two or more sections.
- **Search opens the matching section**: the settings search, the chrome settings search and the Claude settings Find all show their sections open while you type.

## Framework default

- `settings-ui@1` (asset type `settings`) gains two optional fields: `sections` (`collapsible` default | `flat`) and `sectionsOpen` (`all` default | `first` | `none`). New interfaces get collapsible sections automatically; a `flat` asset fails CI.
- Engine `framework/core/engines/settingsui.ts`: `normalizeSectionState`, `sectionOpen`, `sectionCollapsible`, `setSectionsOpen`, `SETTINGS_SECTIONS_KEY`. Fixture case `sections` in `framework/spec/fixtures/settings-ui.json` (66 checks).
- React: `framework/react/components/SettingsSections.tsx` — `SettingsSection`, `SectionsBar`, `SectionsScope`, `useSettingsSection`, `useSectionsScope`, `setSections`, `sectionState`. Tokens only (`fx-ssec*` in `framework/ui/axf.css`).
- Same pattern as `orchestrator-settings-collapsible-split` (one collapsible block per topic); that branch's `<details>` Split section still counts as a section for the CI check, nothing duplicated.
- Kotlin twin deferred (`framework/spec/PORTING.md`).

## API (all four the same)

| What | How |
|---|---|
| Expand / collapse all (everywhere, or one tab) | action `settings.sections:expand-all[:<tab>]`, `settings.sections:collapse-all[:<tab>]` |
| One section | `settings.sections:open:<section id>`, `close:…`, `toggle:…` (a bare group id means `settings-group:<id>`) |
| Open the section holding a setting and go there | `settings.sections:reveal:<setting key>` |
| Read the state | setting `axf.settings.sections` (`settings.get`) |
| Deep link | `settings.open:<tab>` / `view:settings/tab:settings.tabs=<tab>`; each chevron is console-control target `section:<id>` |

Reached through REST `/api/console-control` (console actions), MCP `console_control_*`, CLI `axf console …`, and AmberX voice, like every console action.

## CI

`node framework/cli/check-settings-sections.mjs` (added to `android.yml` next to the toolbar check) fails when:

1. a framework renderer stops wiring sections (settings page, Forms `Section`, chrome settings, banner settings, engine default);
2. a settings asset sets `sections: "flat"` without a recorded reason;
3. a hand-built settings UI (a `*settings*.tsx` file, or the file of any component a plugin draws as a settings panel) has two or more headed blocks and no collapsible section.

Ratchet `framework/spec/settings-sections-baseline.json` only goes down. It holds 5 files with raw `<h3>`/`<h4>` headings in panel files that also hold non-settings views: `glossary-index/web/index.tsx`, `plugin-manager/web/LazyLoader.tsx`, `push-banner/web/queue.tsx`, `push-banner/web/ui.tsx`, `framework/libs/ashes/index.tsx`. Each panel is still a collapsible section as a whole; only its inner headings don't fold yet.

## Tests

- `check-settings-ui.mts` 66 passed; `check-chrome-settings.mts` 304; `chrome-settings.mjs check` ok; `claude-settings/test.mjs` 93.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `check-console-control`, `check-settings-sections`: all pass.
- Console typecheck (`tsc --noEmit`, re-baked framework, CI-style): clean.
- Fixed on the way: `claude-settings` tab row used a non-static id, which kept `check-console-control` red on main; control inventory regenerated.
- Not mine, still red on main: `shared-assets.mjs check` (Molly's baked `assets/help/framework.json` drift).
- No screenshots: no built console to shoot on this run. Before/after go to UI Review → Screenshots after the deploy.

## Next

- Redeploy the console, axHub web and AmberX after merge (CI re-bakes the framework).
- Bring the 5 baseline files down by moving their raw headings onto `Section` / `SettingsSection`.
