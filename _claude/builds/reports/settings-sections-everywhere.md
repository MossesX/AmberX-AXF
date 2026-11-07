# Settings sections everywhere

Build `settings-sections-everywhere`, Nov 7 2026, branch `claude/settings-sections-everywhere`.

## What Brett said

> All groups of settings in every settings interface as of now, everything, it's gotta be in sections. Everything's gonna be arranged in sections that are similar: certain types of settings in a section that's collapsible. Every settings interface that is in existence thus far is gonna be like that. You're gonna go through and refactor them, put everything in categories. And they're all collapsible sections.

## What changed

- **settings-ui@1:** `sections` and `sectionTools` on the asset, `section` on groups and panels, 13 standard categories (`SETTINGS_SECTIONS`), `arrangeSettingsSections`. Additive: assets without the fields get the standard set.
- **Settings page:** every group and panel is in a collapsible section, with Expand all / Collapse all on each tab and fold state per device. A section with one item takes its name and shows the category as a tag.
- **Custom panels:** `<Section>` and `<Container title>` inside a settings page fold and remember themselves, so no panel code changed.
- **Chrome settings dialogs:** every tab's fields sit in a collapsible section, with the same memory.
- **Refactor:** 283 groups and panels tagged. No setting key or label changed.
- **Two oversized groups split by kind:** `approvals-banner.alarm` (12 settings) into Veto alarm + Alarm sound; `amberx.voice` (15) into Voice control + Recognition + Answers and commands. Same keys, and the original group ids stay on the first part.
- **Expenses:** it runs on MUI and vendored core, not the settings library. Its dialog's tabs became collapsible sections (Theme is one too), each with its own reset, and the vendored module dialog folds its rows. Same `axf.fold:` memory contract.
- **CI:** `check-settings-sections.mjs` + its spec, wired into `android.yml` and `ci-scope.mjs`.

## Tests

| Check | Result |
| --- | --- |
| `check-settings-ui.mts` | 62 checks pass (fixture grew by 7 cases) |
| `check-settings-sections.mts` | pass (scanner against sources it must flag and pass) |
| `check-settings-sections.mjs` | 283 groups and panels, all in a section |
| `tsc` on console, AmberX, Molly, axHub web, Walkthrough Studio, Expenses | clean |
| The sweep step of `android.yml` (59 commands) | pass; `check-windows` and `check-help` needed a `NODE_PATH` here, `check-help-mode` could not run here (no `jsdom` in this worktree) |
| Real Chromium drive of the console build | Collapse all closed 8 of 8; held after reload; Expand all opened all 8; one header toggles one; a search hit inside a closed section opened it; no page errors on desktop or phone |

## Known gaps

- **FoldSections is still unmerged (PR #349).** It folds Markdown text, so settings use `FoldPanel`, its live-UI twin with the same look and memory contract. This branch copies #349's `.fx-fold` CSS unchanged, so the two merge cleanly. Once #349 lands, FoldSections can share `FoldPanel`'s memory code.
- **`apps/demo` is not re-baked.** It was already 124 files behind and keeps its old settings page until it is re-baked. Walkthrough Studio was also behind and is re-baked here, which is most of that app's diff.
- **The Kotlin twin is deferred** (Android on hold), recorded in `framework/spec/PORTING.md`.
- **This contract was built on Opus.** It is an additive settings-ui@1 change, and the rules pin schema and engine work to Fable. It needs the same Fable review as other Opus-built foundation work.
- **Panels are one section each when they hold flat rows.** A custom panel with no `<Section>` inside folds as a whole; the largest are 5 to 7 controls on one topic.
- **`claude-settings-tabs-veto` was not found** in the builds store. Its tabs will sit above these sections: the Claude panels are tagged, and the panel code was not touched beyond the tag.

## Inventory

Groups and panels per interface, and the categories each one uses.

| Interface | Items | Categories |
| --- | --- | --- |
| AmberX · ai | 4 | general, ai, status |
| AmberX · approvals | 1 | behaviour |
| AmberX · commands | 1 | general |
| AmberX · companion | 6 | ai, voice, behaviour, access, data |
| AmberX · dictation | 1 | general |
| AmberX · monitor | 2 | general, access |
| AmberX · tasks | 1 | general |
| AmberX · voice | 4 | voice, behaviour |
| AmberX · web | 1 | general |
| amberx-droid | 4 | voice, access |
| console-web | 6 | general, access, connections, look |
| console-web · plugin _template | 1 | plugin |
| console-web · plugin activity | 2 | general, plugin |
| console-web · plugin agent-manager | 8 | ai, general, access, behaviour, plugin |
| console-web · plugin agent-slots | 3 | general, status, plugin |
| console-web · plugin agent-swarm | 3 | look, general, plugin |
| console-web · plugin agent-voice | 7 | look, general, voice, data, plugin |
| console-web · plugin ai-assistant | 9 | look, general, ai, behaviour, status, plugin |
| console-web · plugin ai-keys | 2 | general, plugin |
| console-web · plugin alerts-bell | 3 | look, status, plugin |
| console-web · plugin approvals-banner | 5 | alerts, voice, general, plugin |
| console-web · plugin audio-extract | 5 | general, voice, data, look, plugin |
| console-web · plugin basic-filter | 4 | general, look, status, plugin |
| console-web · plugin brand-library | 2 | general, plugin |
| console-web · plugin build-breaker | 2 | general, plugin |
| console-web · plugin build-manager | 3 | general, plugin |
| console-web · plugin build-orchestrator | 1 | plugin |
| console-web · plugin build-profiles | 2 | general, plugin |
| console-web · plugin builds-page | 3 | look, data, plugin |
| console-web · plugin changes-grid | 1 | plugin |
| console-web · plugin chat-viewer | 2 | general, plugin |
| console-web · plugin claude-accounts | 3 | general, connections, plugin |
| console-web · plugin claude-badge | 4 | look, status, plugin |
| console-web · plugin claude-handoff | 2 | general, plugin |
| console-web · plugin claude-session | 2 | general, plugin |
| console-web · plugin claude-settings | 2 | per group, plugin |
| console-web · plugin codebase-changes | 3 | general, plugin |
| console-web · plugin console-commands | 4 | general, behaviour, status, plugin |
| console-web · plugin console-terminal | 10 | look, behaviour, ai, general, connections, status, plugin |
| console-web · plugin container-access | 6 | connections, access, status, plugin |
| console-web · plugin context-menu-designer | 2 | general, plugin |
| console-web · plugin crew-live | 1 | plugin |
| console-web · plugin fable-rebuilds | 2 | general, plugin |
| console-web · plugin feature-assist | 2 | general, plugin |
| console-web · plugin feature-matrix | 2 | general, plugin |
| console-web · plugin follow-amber | 3 | general, plugin |
| console-web · plugin github-app | 2 | general, plugin |
| console-web · plugin hub-sync | 1 | plugin |
| console-web · plugin main-build-status | 4 | look, status, general, plugin |
| console-web · plugin maintenance | 6 | general, alerts, behaviour, status, plugin |
| console-web · plugin mcp-client | 1 | plugin |
| console-web · plugin md-studio | 3 | general, data, plugin |
| console-web · plugin molly-guide | 4 | general, tools, plugin |
| console-web · plugin notes-browser | 2 | general, plugin |
| console-web · plugin output-recorder | 5 | general, voice, data, plugin |
| console-web · plugin plan-studio | 2 | general, plugin |
| console-web · plugin plugin-commands | 2 | connections, plugin |
| console-web · plugin plugin-manager | 4 | look, general, advanced, plugin |
| console-web · plugin plugin-switches | 2 | general, plugin |
| console-web · plugin plugin-update | 2 | general, plugin |
| console-web · plugin plugins-menu | 8 | general, look, behaviour, advanced, plugin |
| console-web · plugin project-wizard | 1 | connections |
| console-web · plugin push-banner | 4 | general, status, plugin |
| console-web · plugin ref-links | 3 | general, tools, plugin |
| console-web · plugin session-checkin | 3 | status, general |
| console-web · plugin snapshot-manager | 5 | general, data, status, plugin |
| console-web · plugin systems-check | 6 | ai, access, alerts, plugin |
| console-web · plugin theme-editor | 3 | look, general, plugin |
| console-web · plugin theme-manager | 2 | general, plugin |
| console-web · plugin todo-manager | 2 | general, plugin |
| console-web · plugin token-control | 2 | general, plugin |
| console-web · plugin ui-review | 3 | general, look, plugin |
| console-web · plugin voice-notes | 7 | general, voice, behaviour, tools, plugin |
| console-web · plugin whats-shipped | 3 | look, general, plugin |
| framework | 2 | behaviour |
| library alerts | 5 | alerts, general, connections, tools |
| library ashes | 4 | look, advanced, general |
| library hubstatus | 4 | general, alerts, behaviour, status |
| library hubsync | 3 | status, connections |
| library mcp | 1 | general |
| library plugintheme | 2 | look |
| library settings | 8 | look, tools, access, general |
| library toolbars | 2 | behaviour, general |
| molly · plugin banners | 3 | look, general, plugin |
| molly · plugin navigation | 1 | look |
| molly · plugin toolbar-designer | 1 | general |
| molly · plugin xlayout | 4 | look, general, plugin |
| shared settings assets | 1 | general |
| walkthrough-studio | 1 | general |
