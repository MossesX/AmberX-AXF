<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/widget-assets.md tokens=309 -->
## Contract / API / fixture changes (old → new)
| Area | Old | New |
|---|---|---|
| Host definition | literals in two engines | `asset-types.json` `attach`/`widgets` blocks → open host registry (both ports) |
| `toolbar.widgets` validation | none | validated on all validators |
| `search-bar` config | read raw by the UI | `searchBarConfig()` normalized (clamped 1–50, kinds filtered) on both ports |
| Widget renderers (web) | `if/else` in `WidgetView` | `registerWidgetRenderer` registry |
| Kotlin `SearchEngine.KIND_LABELS` | immutable `Map` | `MutableMap` + `labelKind()` |
| Kotlin `DialogContribution` | no `searchable` | `searchable = true` added (before `content`) |
| Kotlin `Toolbar` | no live search | `liveSearch: SearchBarConfig?` |
| Android search UI | none (`k.search` partial) | banner/toolbar live search + host + settings/console providers |
| Fixtures `widgets.json` | 5 sections | 9 sections (old 5 unchanged) |

Migration: none for apps. A Kotlin caller constructing `DialogContribution` positionally with four arguments would need the named `content =` (none exist in the repo). The Kotlin `ConformanceTest` now also runs `AssetTypeRegistry.builtin()` before comparing hosts (so the spec's hosts are loaded).
