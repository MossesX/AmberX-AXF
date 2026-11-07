# Glossary & Index

An encyclopedia of AmberX AXF inside the Dev Console: a **glossary** (A–Z definitions) and an **index** (a categorized
tree, like the back of a book) of every plugin, feature, screen, control, setting, command, asset, asset type, CLI tool,
build option, job type and core concept, plus a **grid** of all of it.

Nothing in it is a hand-kept list. `catalog.mjs` builds the catalog (`glossary-catalog@1`) from what the repo already
registers:

| Kind | Source |
| --- | --- |
| Concept | `terms.json` (hand-written definitions of ideas no single file defines: asset@1, hot-swap, veto call, merge queue…) |
| Plugin, Command | every `plugins/<folder>/plugin.json` and its `commands.items`, with REST routes, MCP tool names and the `axf` CLI form |
| Screen, Control, Setting | every help@1 entry: framework chrome, Dev Console + plugins, axHub web |
| Asset type, Asset, Job type | `framework/schemas/asset-types.json`, `framework/assets/<type>/*.json` |
| CLI tool | the header comment of every `framework/cli/*.mjs` |
| Build option | `framework/schemas/build-options.json` |
| Feature | the feature tracker, `framework/catalog/catalog.json` |
| UI element | `apps/<app>/src/assets/ui-registry/*.json` when an app ships the UI registry |

Every entry has an id (`<kind>:<scope>:<key>`), term, kind, category path (`Plugins › Build manager › Controls`), a
one-sentence summary, the longer detail, the file it comes from, where it appears, its API, related entries,
children (a plugin lists its controls and commands) and keywords (for search and auto-tagging).

## Using it

- Console: **Help › Glossary & Index** (or the side nav). Search (every word must match), filter by kind, sort, show
  drafts, show only undescribed entries; switch Glossary / Index / Grid; tap an entry for its details and links.
- MCP: `glossary_index_stats`, `glossary_index_search`, `glossary_index_entry`, `glossary_index_changes`,
  `glossary_index_rebuild`.
- CLI: `axf glossary-index search --q "merge queue"`, or offline `node catalog.mjs search merge queue`,
  `node catalog.mjs get concept:asset`, `node catalog.mjs stats`.
- Other plugins: capability `glossary@1` (`lookup(id)`, `search(q, kind, limit)`, `rebuild(reason, build)`).

## Keeping it complete

- The built catalog lives in the plugin's data folder (`.axf-console/plugins/glossary-index/catalog.json`), never in
  git. It is rebuilt when missing, from Settings › Plugins › Glossary & Index › **Rebuild now**, over the API, and after
  every build. Each rebuild that changes something appends to `changes.json` (added / changed / removed, and the build).
- CI runs `test.mts` and `catalog.mjs --check`: every plugin and asset type must have an entry, every entry a summary,
  and the number of items whose source has no description of its own (their summary is generated) may only go down
  (`coverage.json`; lower it with `node catalog.mjs --update-ratchet` after describing things).
- New kind of thing in the system? Add a source function in `catalog.mjs` and a kind in `KINDS`.
