<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md tokens=620 -->
## Added — embed@1 (cross-port contract)

An app can now run inside another app's frame and know it.

- **Reference engine** `framework/core/engines/embed.ts` = Kotlin `ai.amberx.axf.kernel.engine.EmbedEngine`; fixture
  `framework/spec/fixtures/embed.json` (hosts, hidden lists, queries, user agents, detect precedence, suffixes, urls),
  replayed by `framework/spec/check-embed.mts` (94 checks, in CI) and `EmbedConformanceTest` (Kotlin, written without a
  compiler — CI compiles it).
- **The marker**, two carriers, the query winning: `?axf-embed=<host>[&axf-embed-hide=<type>,<type>]` or a user-agent
  token `AXF-Embed/<host>[/<type>+<type>]`. `<host>` = `[a-z0-9][a-z0-9-]{0,31}` (lower-cased); hidden types are cleaned
  to hideable chrome in spec order; nothing valid named = the default (`banner`); `none` = hide nothing; no valid host =
  no marker. Host helpers `userAgentSuffix(host, hidden)` and `embedUrl(url, host, hidden)` build the marker.
- **Hide engine forced layer**: `hiddenSlots(overrides, defaults, forced)` on both ports (`hide.ts`, `HideEngine.kt`);
  `spec/fixtures/hide.json` gained three `forced` cases (an override can't undo it; non-hideable names ignored).
- **Runtime** (both ports): `AxfRuntime.embedded` (web: detected from the page when the option is omitted — `location.search`
  + `navigator.userAgent` —, or passed; Kotlin: constructor `embedded =`), `embedHiddenSlots()`, `slotHiddenByHost(type)`,
  `hiddenSlots()` = host's chrome over the user's overrides over the app's defaults; `setSlotHidden` on host-shown chrome
  refuses with an info toast ("patches shows the banner for this app while it runs inside it") and writes nothing, so the
  user's own choice is there when the app runs on its own. `rt.banner()` is empty and `--fx-banner-h` is `0px` while the
  banner is hidden this way (the existing hide path; nothing new to render).
- **UI**: web `AppShell` marks `.fx-frame[data-axf-embed="<host>"]` (styles/plugins can adapt); lib-settings' slot picker
  and the Compose settings chips grey the slot out and label the choice *Shown by <host>*.
- **Not changed**: engines, fixtures and layouts for everything else; `manifest.hidden`, the appearance document
  (the forced layer is never pushed to the hub), Build Pilot (bakes the framework: it gets embed@1 on its next
  `bake-contracts` / re-bake, step listed below), axHub's own pages (not AXF; they keep their header inside Patches —
  a hub-side change if Brett wants it gone).
