# Settings library

The settings page every app on the framework ships. It draws tabs, then the groups and panels that libraries and plugins contribute. The page follows the active `settings` asset (settings-ui@1).

## Sections

Every group and panel sits in a categorized, collapsible section. Settings of the same kind land in the same section in every interface.

Tag each group and panel with `section`:

```ts
settings: [{ id: 'my-plugin.look', section: 'look', label: 'On the banner', tab: 'my-plugin', settings: [ … ] }],
settingsPanels: [{ id: 'my-plugin.queue', section: 'status', tab: 'my-plugin', title: 'Queue', render: () => <Queue /> }],
```

| id | Title | Starts |
| --- | --- | --- |
| `general` | General | open |
| `look` | Look and layout | open |
| `behaviour` | Behaviour | open |
| `alerts` | Notifications and alerts | open |
| `voice` | Voice and audio | open |
| `ai` | AI and models | open |
| `access` | Access and safety | open |
| `connections` | Connections | open |
| `data` | Data and storage | open |
| `status` | Status and activity | open |
| `tools` | Tools | open |
| `advanced` | Advanced | closed |
| `plugin` | Plugin (install, uninstall) | closed |

The list is `SETTINGS_SECTIONS` in `framework/core/engines/settingsui.ts`.

A section with one item takes that item's name and shows its category as a tag. A section with several shows the category and lists them under it.

Inside a settings page, `<Section>` and `<Container title>` in a custom panel fold and remember themselves, with no change to the panel.

### The asset

A `settings` asset can rearrange sections without code:

```json
{
  "sectionTools": true,
  "sections": [
    { "id": "general", "title": "Main", "order": 5 },
    { "id": "advanced", "collapsed": false },
    { "id": "mine", "title": "My section", "icon": "star", "tab": "about", "members": ["axf.about"] }
  ]
}
```

An id from the standard list overrides it; any other id adds a section. `tab` limits an entry to one tab, and `members` moves groups or panels in, ahead of their own tag. `sectionTools: false` drops the Expand all / Collapse all bar.

### Fold state

Fold state is per device, in `localStorage` under `axf.fold:settings:<asset>:<tab>`, and never in the asset. Closed sections stay mounted, so search can reach a setting inside one and opens the way to it.

For other screens, `FoldScope`, `FoldPanel` and `FoldTools` are exported from `framework/react`. They are the live-UI twin of `FoldSections`, which folds Markdown.

### The check

`node framework/cli/check-settings-sections.mjs` fails CI when a group or panel names no section, names one that doesn't exist, or holds more than 10 settings (split it by kind). It scans libraries, `addGroup` / `addPanel` calls and settings assets' own groups.
