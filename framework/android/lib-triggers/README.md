# lib-triggers (0.1.1, triggers@1 level 1)

The user-facing side of the kernel's **triggers@1** contract (`axf-kernel/.../triggers/Triggers.kt`). The kernel owns the
data model, validation, the registry and the pure `TriggerMatcher`; this module adds persistence, the lib-voice bridge,
settings by voice and the screens. Nothing here redefines the contract.

```kotlin
// App.kt
override fun modules() = listOf(/* … */ SettingsModule(), VoiceModule(this), TriggersModule(), AppModule())

// in a module's register()/init()
val triggers = ctx.require<AxfTriggers>()
triggers.store.registerPermanent("notes", listOf(
    TriggerHosting.voiceCommand("notes.add", "New note", listOf("new note", "take a note"), module = "notes"),
))
triggers.registerContext("notes.editor", "Note editor")
triggers.bindSetting(SettingVoiceBinding(AxfVoice.SPEAK, "notes", "Speak prompts",
    listOf(SettingPhrase("prompts off", JsonPrimitive(false)), SettingPhrase("toggle prompts", toggle = true))))

// hands-free: lib-voice engine → arming + sensitivity → TriggerMatcher → commands
val bridge = triggers.voiceBridge(context = { currentContext }, log = { entry -> overlayLog(entry) })!!
bridge.start(scope)
scope.launch { bridge.commands.collect { triggers.run(it) } }
voice.engine().start(voice.engineOptions())
```

## Pieces

- **TriggerStore** (`trigger-store@1`, one JSON value in the KV store under `axf.triggers.store`):
  `registerPermanent(module, triggers, locked)` / `unregisterPermanent(module)` (permanent triggers come from modules at
  runtime and are never stored), `saveCustom`, `removeCustom` (permanent → false), `setEnabled` / `setThreshold` /
  `setWorksIn` / `change(id, TriggerOverride)` (overrides for permanent triggers, direct edits for custom ones),
  `reset(id)`, `newCustomId(label)`, `list: StateFlow<List<StoredTrigger>>`, `triggers()`. A locked permanent trigger
  can't be switched off. When the kernel's `TriggerRegistry` is given, every change is mirrored into it per module.
  Pure parts: `TriggerMerge.merge/apply`, `TriggerStoreCodec.encode/decode` (lenient: invalid entries are dropped).
- **VoiceTriggerBridge** (+ pure `VoiceTriggerDecider`): final `VoiceResult`s → `VoiceSensitivity` floor →
  `VoiceArming` → kernel `Observation` (confidence in %) → `TriggerMatcher.match` with the current context, armed kinds,
  switched-off kinds and cooldowns. `commands: SharedFlow<TriggerCommand>`; every utterance (except partials) goes to
  a plain `TriggerLogSink = (TriggerLogEntry) -> Unit` with each trigger's decision (confidence + outcome) or the
  `VoiceDrop` reason. `ArmingGate.PER_TRIGGER` (default, kernel semantics: `arming = required` triggers need the arming
  phrase, `always` triggers don't) or `ArmingGate.ALL` (nothing matches until armed, lib-voice classic).
- **Settings by voice**: `SettingsVoiceBindings.bind(SettingVoiceBinding)` registers `TriggerHosting.bindingTriggers` as
  permanent triggers; `apply(cmd)` turns `TriggerHosting.settingChange(cmd)` into a write through `SettingsAccess`
  (`SettingsEngineAccess` = lib-settings, `ConfigSettingsAccess` = kernel Config). `SettingValues.resolve` coerces per
  kind: toggle flips / "on"/"off", numbers from digits or words clamped to min..max (a 0..1 slider takes a spoken
  percent), choices by id, label or close label (≥ 0.75), text as said; secrets and other kinds are refused.
- **Actions**: `TriggerActionCatalog` (tabs from the action bus per module + a Settings tab from settings groups +
  `AxfTriggers.registerActions`), `search(query)` filters live across every tab and each hit carries its tab label.
- **AxfTriggers** (`axf.triggers.store` service): `store`, `bindings`, `contexts`, `catalog()`, `run(cmd)` (settings
  actions through the settings API, the rest on the action bus with the args JSON as payload), `voiceBridge(...)`.
  The bridge matches `matchable()` = `TriggerUnion.merge(store, registry)`: the store's triggers (user overrides applied)
  plus triggers registered only in the kernel `TriggerRegistry` (lib-speech's speech controls, plugin triggers); for an id
  in both the store's copy wins, nothing twice. `UnionTriggerSource` caches the union and rebuilds it on
  `TriggerRegistry.subscribe` / store changes; `VoiceTriggerBridge.close()` unsubscribes (0.1.1).
- **Screens** (route `triggers`, action `triggers.open`, Settings → Triggers link): `TriggersScreen` = dense single-column
  `TriggerList` (permanent then custom, switch per row, "edited"/"locked" badges), `TriggerEditor` (enabled, threshold,
  works in, reset / delete), `AddTriggerFlow` (kind → phrases, typed or recorded with lib-voice → action → details),
  `TriggerActionPicker` (search bar pinned on top, tab chips, hits show their tab), `ThresholdEditor` (1–99 % slider + exact
  0.01–99.99 field). Tokens only (`Axf.space`, `Axf.colors`, `Axf.type`, kit components).

## Placeholders

- `axf.triggers.sync`: `TriggerSync` / `PlaceholderTriggerSync` (answers `NotImplemented`).
- Gesture and face detectors are the kernel's placeholder kinds; the add flow already accepts them (signature ids).

Written without a compiler: CI compiles it and runs `:lib-triggers:testDebugUnitTest` (store merge + overrides,
bridge decisions with fake results, setting coercion + binding end to end, catalog search, add-trigger draft).
