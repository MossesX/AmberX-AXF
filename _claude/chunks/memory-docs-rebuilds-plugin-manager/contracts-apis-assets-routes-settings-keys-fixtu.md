<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md tokens=543 -->
## Contracts, APIs, assets, routes, settings keys, fixtures (old → new)
| What | Old | New |
| --- | --- | --- |
| Model | Python-only `inventory.py` resolver | `plugin-inventory@1` engine, TS = Kotlin = Python, one fixture |
| `GET …/inventory` (the plugin route) | items, services, conflicts, counts | same + `frame`; items also carry `targets`, `serverPart`, `dataDir`, `dataDirProblem` (engine record fields) |
| Conflict kind for web-only clashes | `web-contribution` (id `web:view:x`) | `contribution` (id `contribution:view:x`), resolved by the engine |
| Dependency kinds | framework, service, env, scope, core, other | + `plugin` (`plugin:<id>`) |
| Dependency detail text | "The console runs…" | "The host runs…" (identical across ports) |
| `rt.libraries[]` | `{id,label,version,template?}` | `InstalledLibrary` (superset; old fields unchanged) |
| `STANDARD_ACTIONS` (web) | no `app.settings` | `app.settings` stub (lib-settings registers the handler) |
| Starter nav/app menus | no Settings item | Settings item (`view: settings` / `action: app.settings`) |
| `spec/fixtures/menu-filter.json` | — | regenerated (Settings item) |
| New fixture | — | `spec/fixtures/plugin-inventory.json` |
| New route | — | `GET …/records` next to `/inventory` (plain records + context) |
| Android | no plugin manager | `PluginManagerModule` id `ai.amberx.axf.plugin-manager`, route `plugin-manager`, dialog `plugin-manager.window`, same actions + settings keys as the web plugin |
| Android settings | flat list of groups | tabs + sub-tabs (`SettingsTabs`, `SettingsGroup.tab`), `InstalledModulesPanel` |

**Migration / compatibility.** Apps and plugins using the Opus version need no change: ids, actions, settings keys and
routes are the same; the inventory JSON is a superset. Code that filtered conflicts by kind `web-contribution` should use
`contribution`. Apps that read `rt.libraries` keep working (superset). Existing `axf init` apps don't gain the Settings
nav item until they re-bake assets or add it; new apps get it. An Android app that rendered `SettingsScreen` sees tabs now
(groups without `tab` land in General, except the framework's `appearance`/`about`).
