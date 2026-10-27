# axf-data

DataStore-backed typed preferences (`PreferenceStore` / `PrefKey`), a JSON document store on the schema-driven file layout, `OfflineFirstRepository` (local source of truth + outbox + conflict rules), disk persistence for the kernel's `QueryClient`, and a one-Room-database-per-module `DbRegistry`.

`PreferenceStore` raw keys: `raw(name)` / `setRaw(name, value)`, and deletion with `removeRaw(name)` (one key, any value
type) and `removePrefix(prefix)` (every key starting with it, in one edit; a blank prefix removes nothing) — use these to
delete an uninstalled plugin's saved settings instead of blanking them. `PreferenceStore.inMemory()` (on
`MemoryPreferencesDataStore`) behaves like the DataStore-backed store, for tests and previews.
