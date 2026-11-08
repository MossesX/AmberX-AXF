<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md tokens=220 -->
## Known gaps

- Android screenshots ([android.md](patches-wrapper/android.md), run 14): the emulator capture never got past the launcher for **any** app, before or after (every screen `?`, the Android console at the base commit included), so this is a capture-pipeline fault, not Patches'; the APKs themselves built. Worth a look at `rebuild-shots.yml` / `boilerplate-capture.py` on its own (launch intent or demo-mode step). Patches' web tabs would show the waiting screen / sign-in there anyway (no hub session on the emulator).
- No tab badges yet (approval counts etc.): `patches.bridge` placeholder.
- The hub tab keeps the hub's own header (axHub isn't AXF).
- Native Console / AXHub modules inside Patches: `patches.native-tabs` placeholder (the Android hold still covers those apps).
- Embedded apps' plugin banners stay (by design: they are notices, not "the banner").
