<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/banner-assets.md tokens=106 -->
## Known gaps
- Kotlin written without Maven: engines compiled and replayed locally with kotlinc; Compose UI, runtime and tests compile on CI only.
- Android badge `link` runs through `AxfActions.dispatch` (same as toolbar items); no long-press tooltip yet (content description only).
- The Android banner has no Compose `@Preview` yet (would need the preview tooling dependency in axf-ui); name reserved: `BannerPreview`.
