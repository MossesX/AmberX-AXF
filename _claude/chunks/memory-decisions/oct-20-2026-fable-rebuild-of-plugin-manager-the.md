<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=179 -->
## Oct 20 2026 — App catalog on axHub (app-catalog@1)

- Oct 20 2026 (Fable rebuild of `plugin-manager`): the plugin-manager model is a **framework contract**, `plugin-inventory@1` — one engine (TS reference, Kotlin kernel, Python copy in the console plugin) resolves what a plugin needs, who provides it, who needs it and what clashes; every port's Plugin Manager and every app's Settings → Plugins tab read it. Android got a Plugin Manager (`PluginManagerModule` in axf-devtools, same ids/actions/settings keys as the web plugin); `axf init` apps ship the settings interface with a Plugins tab on web and Android. Rebuild report: `_claude/memory/docs/rebuilds/plugin-manager.md`. <!-- axf-plugin:plugin-manager -->
