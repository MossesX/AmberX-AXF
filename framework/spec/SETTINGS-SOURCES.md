# SETTINGS-SOURCES — one true source for every setting (settings-source@1)

Status: contract, Phase 1 of build `one-true-source-for-every-setting` (Fable, Nov 18 2026). Registry
`framework/schemas/settings-sources.json`; resolver `framework/core/settings-source.mjs` (Python twin
`apps/console-web/server/settings_source.py`); migration helper `framework/cli/settings-migrate.mjs`; CI check
`framework/cli/check-settings-sources.mjs`; fixture `framework/spec/fixtures/settings-sources.json`.

## Why

Brett, Nov 18 2026: **"All settings need one true fucking source."**

The same setting had come to live in more than one place: an account's on/off switch in the pipeline's `accounts.json`
and in `claude-accounts/workers.json`; model defaults in Claude settings and in the orchestrator; look values in the
shared appearance document, an app's look document and a local SettingsRegistry copy. Two stores drift, two controls
disagree, and whichever one a session reads decides what happens. From now on a setting has one owner, every reader
asks the owner, and a copy is a bug the CI catches.

## Vocabulary

| Word | Meaning |
|---|---|
| **setting key** | the setting's one global name, dotted lower-case segments (`accounts.mossesx-max-.use`, `claude.builds.defaultModel`, `pipeline.parallelPerAccount`). The key names the setting, not where it lives |
| **key pattern** | a registry entry's key with `*` (one segment, captured as `{1}`, `{2}` …) and a trailing `**` (the rest, captured as `{rest}`). `accounts.*.use` matches `accounts.mossesx-max-.use`; `claude.**` matches every key under `claude.` |
| **store** | the one document that holds the setting: `kind: data-store` = a data-store@1 key (`ns` + `path`; `file` is a template over the four data roots for where it is today, `envDir` / `envFile` the owner's own env overrides; axf-data once cut over), or `kind: browser` = a SettingsRegistry saved under `storageKey` in one app's localStorage |
| **pointer** | a JSON pointer inside the owner document, with the captures substituted (`/perAccount/{1}/use`; `{rest}` = one segment with its dots, `{rest/}` = nested). `""` = the whole document |
| **owner** | the plugin or module the store belongs to (`plugin:claude-accounts`, `framework:skins`). Only it writes the store |
| **readers / writers** | who reads the key (through the owner) and who may write it. A writer not on the list, or writing another store, is refused |
| **mirrors** | always `[]`. The field exists so the check can assert it: a copy is never registered, it is removed |
| **formerly** | where copies used to be (`{ store, pointer, note }`), so the check can fail a writer that still writes the old place and the migration knows what to strip |

## The rules

1. **One owner per key.** The best-ranked matching entry owns a key: an exact entry beats a `*` entry, which beats a
   `**` entry; among patterns more fixed segments win, then more literal ones (`rankOf`). Two entries of the same rank
   that could both match one key are `ambiguous` and fail the check; a catch-all under a specific entry is fine.
2. **Readers resolve through the owner.** A module that needs a value calls `readSetting(key)` (Node) or
   `settings_source.read(key)` (Python), which opens the owner store through the data layer (`data-files.mjs` /
   `data_store.py`, so modes and axf-data apply) and follows the pointer. A reader never opens another module's file.
3. **No copies.** No store holds a value another store owns. A non-owner that needs the value fast keeps a cache in
   memory, never on disk, and re-reads on focus / tick like every editor (last save wins, fresh on focus).
4. **Writes go to the owner only.** `writeSetting(key, value)` writes the owner store at the pointer and nothing else; a
   write asked for another store (`assertOwner(file, key)` from a store writer, or `writeSetting` with `store` set to a
   non-owner) throws `not_owner`. A write to a key with no registry entry throws `no_owner`: a new setting registers
   its owner first.
5. **One control, one API.** The owner's UI is the one place the setting is edited (`editor`: a console_show deep link).
   Another screen may show the value read-only with a "Change in <owner>" link to that deep link; it never gets a
   second field, REST route, MCP command, CLI flag or voice action. The owner store's `api` block names the four
   surfaces (REST, MCP, CLI, voice) and they all land on the same write.
6. **A `browser` store is the owner for client-only settings** (SettingsRegistry keys an app saves for itself). Node and
   Python can name it, not read it: `readSetting` answers `{ reachable: false, store }` and the API path is
   console-control@1 (`console_set` on the registered target). A value the server needs is not a browser setting: it
   moves to a data-store store.

## Moving a key from one store to another (migration)

`node framework/cli/settings-migrate.mjs <key-or-pattern> [--dry-run] [--apply]`:

1. The registry says the owner (`store`, `pointer`) and every former place (`formerly`).
2. The helper reads the owner and every former store that still holds the key. The value kept is the **owner's when it
   is set**; when the owner is unset, the **newest** former copy wins (the store file's mtime, or the document's
   `updatedAt` when it has one) and the choice is recorded.
3. `--dry-run` lists what would move: key, each store's value, the pick and why. Nothing is written.
4. `--apply` writes the picked value to the owner at the pointer (through the data layer), strips the key from every
   former store, and appends one entry per key to
   `_claude/builds/reports/one-true-source-for-every-setting/migrations.json`:
   `{ at, key, owner, pick: { store, value, why }, before: { <store>: value }, after: { <store>: value | undefined } }`.
5. Changing the owner later is the same move: the old owner joins `formerly`, the new one becomes `store`, the migration
   runs, the old writer is deleted. The registry never lists two live stores for one key, not even for a transition.

## The check (`framework/cli/check-settings-sources.mjs`, CI)

Static: every registry entry is well formed (key pattern, known store, empty `mirrors`, pointer uses only captures the
key has), no two entries can own one key, every `formerly` store exists. Then a scan of every store writer (data-files
`writeJson` / `updateJson`, `data_store.write_json`, `SettingsRegistry.set`, plain JSON writes under plugin dataDirs)
and every settings asset: a key written in two stores, a written key with no owner, or a non-owner writing an owned key
fails the build. The fixture test replays golden owner lookups (exact, pattern, unknown, ambiguity refused).

## Surfaces

| Surface | How |
|---|---|
| REST | `GET /api/settings-sources` (list), `GET /api/settings-sources/owner?key=` , `GET /api/settings-sources/check` (live duplicate scan) |
| MCP | console tools `settings_source_owner`, `settings_source_check` |
| CLI | `axf settings-source owner <key> \| list \| check` |
| Voice | action `settings.source` ("who owns the account on/off setting") |
| Deep link | `view:settings/tab:settings.tabs=sources` (the read-only Settings → Sources view: key, owner, jump to the owner's control) |

## Not in this contract

A Kotlin twin: the Android apps read their settings through the hub documents the registry already names
(appearance@1, app-look@1) and have no second store, so the resolver has nothing to twin today; recorded as a deferred
gap in `PORTING.md`. The data-store@1 contract itself (`DATA-STORE.md`) is unchanged: this registry sits above it and
says which key in which document is the setting's home.
