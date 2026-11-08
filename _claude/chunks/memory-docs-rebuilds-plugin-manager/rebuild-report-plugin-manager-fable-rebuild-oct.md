<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md lines=1-16 tokens=405 -->
# Rebuild report — `plugin-manager` (Fable rebuild, Oct 20 2026, branch `fable/plugin-manager`)

**Summary.** The Opus Plugin Manager was a web-console-only plugin whose dependency logic lived in one Python file.
The Fable rebuild turns that logic into a **framework contract, `plugin-inventory@1`**: one engine (TypeScript reference
`framework/core/engines/plugins.ts`, Kotlin `PluginInventoryEngine` in `axf-kernel`, and a Python copy in the plugin's
server part) that resolves what a plugin needs (`service:<capability>`, `plugin:<id>`, env, scopes, framework level,
console API), whether each need is met (satisfied / provider off / missing / not installed / unsupported), who provides it,
**who needs it**, its health, the clashes (duplicate id, two providers, duplicate contribution, shared data folder, two
enabled UI editors) and even the dependency-graph layout — all pinned by one fixture replayed on every port. On top of it:
the web console plugin keeps every Opus feature (five views, four layouts, terminal commands, context-menu link, logs,
files, lifecycle panel, inline settings, catalog Install view) with the same id, folder, actions and settings keys;
Android gets a real Plugin Manager (`PluginManagerModule` + `PluginManagerScreen` in `axf-devtools`, same ids, in the
Android console showcase and the `android-compose` template); and **every `axf init` app now ships the settings interface
with a Plugins tab** that lists its libraries with health, dependents and clashes from the same engine (web `libs/settings`
and Android `lib-settings`), plus a Settings entry in the starter nav and app menus.
