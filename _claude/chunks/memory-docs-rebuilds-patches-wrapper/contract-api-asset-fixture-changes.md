<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md tokens=260 -->
## Contract / API / asset / fixture changes

| What | Change | Compatibility |
| --- | --- | --- |
| `hiddenSlots(overrides, defaults, forced = [])` (TS + Kotlin) | new optional third argument | additive; old calls unchanged |
| `AxfRuntimeOptions.embed` (TS), `AxfRuntime(embedded =)` (Kotlin) | new optional | additive; web auto-detects from the page when omitted (an app that must never embed passes `null`) |
| `rt.embedded`, `rt.embedHiddenSlots()`, `rt.slotHiddenByHost()` | new | additive |
| `setSlotHidden` | refuses host-shown chrome | only while embedded |
| `.fx-frame[data-axf-embed]` | new attribute | additive |
| `spec/fixtures/hide.json` | +3 forced cases | Kotlin `ConformanceTest` reads the optional `forced` key |
| `spec/fixtures/embed.json` | new | — |
| `rebuild-shots.mjs` | per-shot `path`, `userAgent` | additive |
| `gen-fixtures.mts` | **fixed**: the app-menu block never closed (the generator had been failing at HEAD); embed + forced cases added | regenerated fixtures identical except hide.json / embed.json |
