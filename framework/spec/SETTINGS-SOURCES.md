# settings-sources@1 — one true source for every console setting

Brett, Nov 21 2026: "One true source: get the redundant settings out." A setting is stored under **one key**, shown
under **one wording**, and every screen that shows it reads and saves that key. A screen never keeps its own copy.

## The registry

`framework/schemas/settings-sources.json`, plus the part a plugin ships as `settings-sources.json` in its own folder
(same shape; a plugin's file is named `plugin:<folder>/<file>`, so the framework never names a plugin by path).

| Field | Meaning |
|---|---|
| `sources[]` | A setting that once had a second copy. `store { file, key, module }` is the one stored key, `label` the one wording, `edit` / `read` how it is reached without the UI (REST, plugin commands over MCP and voice, CLI). |
| `sources[].aliases[]` | The old keys. **Read aliases**: a store that still carries one is read from it, nothing writes it again, and its `migration` moves the value over once. |
| `sources[].retiredWording[]` | Labels that may not come back on a screen. |
| `distinct[]` | Settings that look alike and are not the same thing, with the reason. |
| `sameName` | Key names the audit finds in more than one store: `oneStore` (the folders hold one store between them) or `differentSettings` (same name, different thing), each with its reason. |

## Rules

1. One stored key. A second place for the same value is an alias in the registry, read only.
2. Migration keeps the value saved last when two copies disagree and writes what it kept and dropped as a `settings-migrated`
   line in the owning module's journal (`build-limit.log.jsonl`, the pipeline's `log.jsonl`). It never raises an owner-only value (Builds at once).
3. One wording. Every screen, help entry and command description uses `label`.
4. A screen reads and saves through the owning module's API. No `localStorage`, `writeLocal` or settings-registry
   copy of a merged key.
5. A new setting that repeats the job of a listed one is added as its alias, never as its own key.

## The merged settings today

| Setting | Stored as | Read aliases |
|---|---|---|
| Builds at once | `<agent-slots dir>/build-limit.json` `maxBuilds` (`framework/cli/build-limit.mjs`) | agent-slots `settings.json` `maxAgents` |
| Sessions per account | claude-workers `workers.json` `limits.building`, per account `perAccount.<name>.building` (`deploy/claude-workers.mjs`) | pipeline `settings.json` `parallelPerAccount`, pipeline `accounts.json` `<name>.parallel`, Claude setting `builds.maxParallel` |
| Launch builds without asking | Claude setting `builds.launchWithoutAsking` | pipeline `settings.json` `autoQueue` |
| Max launch brief size (bytes) | Claude setting `builds.briefMaxBytes` | pipeline `settings.json` `briefMaxBytes` |

## Tools

- `node framework/cli/settings-audit.mjs [--json|--md]`: the inventory (every registered setting and module store,
  the screens that name each key, key names in more than one store, labels that repeat).
- `node framework/cli/check-settings-sources.mjs` (CI): fails when an alias is registered or stored again, two
  registered settings share a wording, a key name sits in two stores unexplained, a screen stores its own copy or
  shows a retired wording. It also probes the engines in a scratch store.
- `node framework/spec/check-settings-sources.mjs` (CI): proves the check fails on each of those.

Android: nothing to port. The stores and screens are the Dev Console's and the VPS's (web, Node, Python); no
cross-port contract changed.
