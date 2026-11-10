# The control registry (control-registry@1)

The offline index of everything controllable: every page, app, plugin, tool, behaviour, display option and setting,
with where it lives, what opens it, how its state is read, every action with every parameter and allowed value, and how
it is reached (REST, MCP, CLI, voice). Contract: `contracts/control-registry@1.schema.json`; doc:
`docs/contracts/control-registry.md`; engine: `framework/core/engines/control-registry.mjs`; collectors, store, CLI and
dispatcher: `apps/console-web/lib/registry/`.

| File | What |
|---|---|
| `index.json` | the index, one entry per line. Rebuilt with `node apps/console-web/lib/registry/index.mjs build --write`; checked with `… check` (schema + hashes) and `… diff` (what changed in the sources since) |
| `registry.d/*.json` | hand-written declarations (control-registry@1 `declaration`): allowed values a scanner cannot see, `needsAI`, synonyms, providers (Hostinger, Coolify, VPS, Moshi), gaps, `remove: true` for a derived entry that is not controllable. Plugins declare their own in plugin.json `control`; this folder is for the apps and providers that have no manifest |

Nothing here is written by a model: the collectors read the repo, the dispatcher matches exact ids, aliases, synonyms,
declared phrases and allowed values, and Claude is asked only when nothing matches and Claude settings' **Make Claude
available to the console** is on.

Query it: `node apps/console-web/lib/registry/index.mjs list --owner console-web --type page`, `… get plan-studio`,
`… search "font scale"`, `… gaps --what params`, `… stats`. Resolve: `node apps/console-web/lib/registry/dispatch.mjs "open plan studio"`.
