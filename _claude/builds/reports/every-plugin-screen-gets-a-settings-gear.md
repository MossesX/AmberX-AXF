# Every plugin screen gets a settings gear (draft)

Brett, 2026-11-16: "Every one has a gear icon to open its settings, right? Yeah, check and fix."

## Audit, before (s1)

`node framework/cli/check-plugin-settings.mjs --report` on cea0d59af:

```
plugin settings: 71 plugins, 44 with a screen, 44 of them with a settings sub-tab, 4 with a gear (host gear not mounted)
  hand-made gear (4): mcp-client, project-wizard, session-checkin, voice-notes
  no gear (40): agent-manager, agent-swarm, agent-voice, ai-assistant, amberx-listeners, audio-extract, brand-library, build-breaker, build-orchestrator, builds-page, changes-grid, chat-viewer, claude-accounts, claude-handoff, claude-settings, codebase-changes, context-menu-designer, crew-live, demonstration-designer, fable-rebuilds, feature-matrix, gate, glossary-index, maintenance, md-studio, notes-browser, notify-control, output-recorder, plan-studio, plugin-commands, plugin-manager, plugin-update, shipped-features, skin-editor, skin-gallery, theme-editor, theme-manager, todo-manager, token-control, ui-review
  settings only, no screen (27): activity, agent-slots, ai-keys, alerts-bell, approvals-banner, basic-filter, build-profiles, claude-badge, claude-session, console-commands, console-terminal, container-access, feature-assist, follow-amber, github-app, hub-sync, main-build-status, molly-guide, plugin-switches, plugins-menu, project-switcher, push-banner, ref-links, snapshot-manager, systems-check, wake-listener, whats-shipped
```

- **44** plugins draw a screen (a view in their web library, framework libraries spread in included). Confirmed.
- **Settings sub-tab: 44 of 44.** The plan's "10 without a settingsTab" (brand-library, build-breaker, builds-page,
  demonstration-designer, gate, mcp-client, md-studio, plan-studio, shipped-features, ui-review) all already declare
  `settingsTabs` with `parent: 'plugins'` in their web entry, and every plugin.json lists a `settings-tab:` in
  `provides`. Not confirmed: the gap is the gear, not the tab. Steps s10–s14 add the default tab panels
  (enable/logs/info) on top of what they keep, no new tab ids.
- **Gear on the screen: 4 of 44** (mcp-client through framework/libs/mcp, project-wizard, session-checkin, voice-notes).
  19 more reach their settings only through an application-menu entry (`settings.open:<tab>` in web/menu.ts), which
  is not a gear on the screen. The other 21 have no way from the screen to their settings at all.
- **hub-sync** has a settings sub-tab (`hubsync`, from framework/libs/hubsync) and no screen of its own, so it gets
  no gear; its sub-tab id matches what `provides` declares.

So the answer to "every one has a gear, right?" was no: 40 of 44 plugin screens had none.
