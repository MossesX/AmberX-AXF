# axf-assets

Ships the shared framework assets in the APK and loads them.

- `copyAxfAssets` (Gradle, runs before `preBuild`) copies `framework/assets/**/*.json` into `src/main/assets/axf/assets/<type>/<id>.json`, so the Android port carries the web demo's 39 assets byte for byte. The copied folder is git-ignored.
- `AssetLoader.loadAll(context): List<JsonObject>` reads every bundled envelope; `AxfApplication` passes them to the kernel builder.
- `AssetsModule` (`ai.amberx.axf.assets`) contributes two `ExtensionPoints.ASSET_SOURCES`:
  - `FileAssetSource` — `FileArea.ASSETS/imported/*.json`, so imported assets survive restarts (`save(raw)`).
  - `RemoteAssetSource` — GETs `axf.assets.url` from config when the `axf.hotReload` flag is enabled (stub: no polling/QR yet).
