<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/banner-assets.md tokens=242 -->
## Contract / API / fixture changes (old → new)
| Area | Old | New |
|---|---|---|
| `banner.attach` validation | not validated (bad entries skipped at run time) | validated on all three validators; same messages |
| `rt.attachToBanner` with a bad entry | silently dropped | stored + terminal warning (channel `widgets`) |
| `rt.dismissBannerPopup()` (web) | missing | added (Kotlin already had it) |
| `rt.detachAll(origin)` | missing | added, both ports |
| `bannerSurface()` | n/a (unknown surface → bare `.fx-banner`) | unknown → `flat` |
| Fixtures `banner.json` | — | **unchanged** |
| Fixtures `validation.json` | 10 cases | 13 cases (3 added; old ones unchanged) |
| Android banner UI | none | `AxfBanner` in `AppShell` |

Migration: none needed. Apps and plugins using the Opus API keep working (`claude-badge` unchanged). A banner asset with a mistyped `attach` entry that used to validate will now fail `axf validate` with a precise message; fix the entry.
