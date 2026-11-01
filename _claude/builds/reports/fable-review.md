# Fable review of Opus-built foundation work (Nov 1 2026)

Fable, one session, branch `claude/fable-review`. Brett's rule (Nov 1 2026): **Opus or Fable only, never Sonnet; Fable for
foundation work** (schemas, asset types, data models, kernel/engines, cross-app GUI behaviour). Every headless build since
Oct 31 ran on Opus because the launcher could not start Fable (fixed, axHub decision #111). Plan he approved: **Fable reviews
first and only rebuilds what it flags.** This is that review: six items, each read against the AXF design rules (asset@1
envelope, namespaced ids, semver + migrations, open type registry, both validators web + Kotlin, conformance fixtures,
tokens-only styling, typed placeholders, new types never need kernel changes, plugin-lifecycle) and long-term scalability.

## Verdicts

| Item | Verdict | Why | What changed / what's planned |
|---|---|---|---|
| 1. One builds store (builds@1, `urgent-builds`, 2a057cc4) | **fix** | Pure core + IO split, soft deletes, journalled writes, projections with newer-only absorb, 34-check conformance, `verifyNothingLost`: sound. Gaps: `normalizeStore` coerced any JSON into shape and never said what was wrong (a corrupt or hand-edited store was silently "repaired"); the only verify was against the old files, which go away after one release; no written spec. Steps already limited to Fable / Opus. Python has no second implementation (the builds-page server shells to the CLI), so one writer. No Kotlin twin needed (build tooling, nothing an app renders). | `validateStore(store)` in `framework/plan/builds-store-core.mjs` names every problem by path (unique build ids, an order in every profile, unique live step uids across the store, Fable / Opus steps only, statuses, ISO times); `builds-store.mjs verify` runs it first (the real store: 248 records valid); 2 new checks in `check-builds-store.mjs` (36). Spec `framework/spec/BUILDS.md` (store shape, invariants, projections, versioning, ops, migration, deferred JSON Schema). |
| 2. UI Review schema: ui-review-item@1 / ui-review-group@1 (`review-schema`) + shot-group@1 (`shot-groups`) | **fix** | One registry drives JS + Python (Python reads `schemas/ui-review.json`), fixtures as the contract, every intake refuses by field, migration with dry run, CI check: good. Gap: **two time rules**. The core's `stamp` / `groupId` / `autoGroupName` were UTC while the plugin's groups core and the Python server used Brett's zone (America/New_York, the shared rule's "same name the same day"), so the automatic group name and the group day differed by path. Two group id makers (store `g-<day>-<hex>`, core `g-<day>-<slug>`) are both valid ids; kept, documented. | `REGISTRY.timeZone = 'America/New_York'`; zone-aware `localParts` / `dayKey` / `stamp` / `groupId` / `autoGroupName` / `makeGroup` / `prepareItem` / `migrateLegacy` in `framework/core/ui-review-schema.mjs` (+ `.d.mts`); `groups-core.mjs` delegates `dayKey` / `stamp` to the core; Python `schema.py` gets `local_time` (zoneinfo, Eastern-by-rule fallback) and `screenshots.py` delegates to it. `schemas/ui-review.json` regenerated. Contract pinned: 08:20Z on Nov 1 2026 = 03:20 EST. Checks 62 → 64, test.mts 23, test.py 155. |
| 3. help@1 + Help mode engine (`help-mode`) | **OK** | Asset type in the asset@1 envelope (`help`, collection: every pack in force, never rolled, not a look slot), registered in `asset-types.json` / `types.ts` (optional, late-optional), ONE rules file drives `core/validate.ts` and the build engine, stable help ids (action > view > banner > label slug, `<screen>/<id>` overrides), fixture `help.json` + 214 checks + jsdom AppShell test, coverage ratchet in CI, tokens-only `.fx-help-*`, plugin packs as `help.json` asset@1 envelopes removed with the plugin, Kotlin twin deferred in PORTING.md. Nothing to change. | — |
| 4a. job-type@1 + agent jobs router (`agent-jobs`) | **fix** | Type registered properly (rules file for both validators, fixture 87 checks, JSON Schema, starters, router found by capability). **Broke the model rule:** enum `haiku, sonnet, opus, fable`, default `sonnet`, five of six starters on Sonnet, two crew agents Haiku-only; the swarm roster and planner the same; `plan.mjs` still suggested Sonnet; the banter call ran on Haiku. | New **model-policy@1**: `framework/core/model-policy.mjs` (+ `.d.mts`, snapshot `framework/schemas/model-policy.json` written by `axf schemas`): tiers stay open, `allowed = [opus, fable]`, default opus, foundation fable, `coerceModel` goes UP never down, `modelProblem` names the rule. Readers: job-type enum/default/normalize/errors, the six starters → opus, `asset-types.json`, swarm core (`normAgent`, `requiredTier`, `MODEL_IDS`), roster (14 agents → opus / opus+fable), `swarm.mjs` banter call, `plan.mjs` picker. `framework/spec/check-model-policy.mjs` (12 checks, in CI). job-type fixture regenerated (95 checks, new `blocked-model` case), swarm tests 80. |
| 4b. Agent cap / queue (`agent-cap`, agent-slots@1) | **OK** | VPS infrastructure, not a cross-port contract: pure core inside the CLI, settings hot-reloaded with limits, state under a mkdir lock, 56 checks incl. real tmux end to end, console plugin on capability `axf.agent-slots@1`, health item. | — |
| 5. session@1 + chat viewer (`chat-viewer`) | **OK** | Pure validator + redaction + chain hash with no DOM / Node APIs, registry snapshot `schemas/session.json` read by the Python mirror, fixture replayed by both (37 checks), namespaced ids `<prefix>:<origin id>`, versions, redaction patterns written for both regex dialects, JSON Schema. Kotlin twin deferred with a clear trigger (only if an Android app stores sessions). | — |
| 6. Agent swarm data model (`agent-swarm`; `agent-swarm-fable-rebuild` 0/7 pending in Breakroom) | **rebuild** (the pending build; not duplicated) | The contracts agent@1, agent-skill@1, swarm-roster@1, swarm-state@1, swarm-job@1, swarm-run@1, swarm-report@1 live only inside the plugin (`web/swarm-core.mjs`): no framework registry, no JSON snapshot, no fixture in `framework/spec/fixtures`, no CI check of the contract, the run record is shared with agent jobs by convention only. **agent-card@1 reviewed OK** (one rules file, both validators, fixture, defaults, open enums, tokens-only renderer) and is taken out of the rebuild's scope. | Folded into `agent-swarm-fable-rebuild` (Breakroom): review note added; s1 rewritten (contracts → `framework/core/engines/swarm-rules.mjs`, one registry, `schemas/swarm.json`, JSON Schemas, fixture + `check-swarm.mts` in CI, swarm-run@1 shared with jobs, models through the policy; files + checks listed); s4 narrowed (agent-card@1 stays, avatar/card layout check only, 20 min). Still 7 steps, Fable s1–s6, Opus s7. It shows on the Fable rebuilds list through the Pending projection. Not started. |

## Also

- **Shared rule added** (`_claude/shared/rules/RULES.md`, "Before building anything"): Opus or Fable only, never Sonnet; Fable for
  foundation work; one registry (`model-policy.mjs`) every picker reads; Fable review first. claude-sync held RULES.md (changed
  on both sides): the local copy was a strict superset of the hub's (the hub still had the retired "Fable suggested, Opus chosen"
  rule), so it was kept and pushed with `claude-sync resolve --keep local`. `decisions.md` has the decision; `STATUS.md` a line.
- **THREADS.md** was held too: the hub had one row the repo lacked (Brett's "Fable launch", axHub #111); merged in, resolved local.
  Still held for Brett to pick (every one safe either way): the builds store + orchestrator exports (repo rev 77 is a superset of
  hub rev 14, nothing only on the hub), `STATUS.md`, four `changes/` entries, catalog/plan/tracker data files.
- **CI red fixed on the way:** three bare `<button>`s in the AmberX walkthrough player (`check-controls`) marked `data-fx-row`;
  `CLAUDE.md`'s console re-bake line now copies `libs` like CI does.
- **Rebake:** Walkthrough Studio re-baked (it was behind the framework); the console is re-baked by CI.

## Checks (all green)

| Check | Before | After |
|---|---|---|
| `node framework/spec/check-model-policy.mjs` | — | 12 (new, in CI) |
| `node framework/spec/check-builds-store.mjs` / `builds-store.mjs verify` | 34 / old-files only | 36 / store valid (248 records) + 5137 |
| `node framework/spec/check-ui-review.mjs` | 62 | 64 |
| ui-review `test.mts` / `test.py` | 23 / 155 | 23 / 155 (stamp pinned to Brett's zone) |
| `npx -y tsx framework/spec/check-job-type.mts` | 87 | 95 |
| `node apps/console-web/plugins/agent-swarm/test.mjs` | 80 | 80 |
| check-help / check-agent-card / check-session / check-agent-slots | 214 / 61 / 37 / 56 | same |
| `axf validate --framework` (472 assets), check-theme, check-controls, project manifests, project fixtures | green / green / **3 red** / green / green | green / green / green / green / green |
| console `tsc --noEmit` after a CI-style re-bake (core, react, ui, schemas, libs) | — | clean (exit 0) |

Plugin lifecycle checks for ui-review and agent-swarm: clean apart from untracked `sessions/archive/**` logs on this box.

## Known gaps / honest notes

- The model policy is enforced in JS readers. Python code that names models (feature-assist, session-checkin, mcp_server
  model lists) only labels or passes them through; it can read `schemas/model-policy.json` when it next changes.
- `framework/cli/plugins.mjs --check` still accepts `sonnet` on legacy tracker items (data, not a choice); the pending-core
  reader keeps parsing `[Sonnet]` prefixes as Opus for the same reason.
- Group ids: the store makes `g-<day>-<hex>` (collision-free when a group is renamed and its old name reused the same day),
  the core's stateless `groupId` makes `g-<day>-<slug>`. Both valid; documented in the schema header rather than unified.
- UI unchanged (no screenshots, no UI Review item): schemas, CLIs, data and rules only.
