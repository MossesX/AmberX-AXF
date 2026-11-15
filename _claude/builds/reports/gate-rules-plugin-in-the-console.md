# Gate & rules plugin in the console

Build `gate-rules-plugin-in-the-console`. Brett, Nov 15 2026: "Where is the gate and rules plugin, open it on my screen."

There was no gate plugin to open: the gate today is spread over the push banner's lander settings, the merge queue's
control document and the UI Review hold route. This build gives it one schema (`gate-rules@1`, `lander-state@1`), one
reference engine (`framework/core/gate-rules.mjs`), one tool contract (`framework/spec/GATE.md`) and, in phase 2, one
console plugin (`apps/console-web/plugins/gate/`) with Rules, Auto-lander and History tabs.

## s1. Design note: what becomes a gate rule, and where molly takes over

### What exists today (read Nov 15 2026)

Lander code: `apps/console-web/plugins/push-banner/land/` (`land-core.mjs`, `land.mjs`, `merge-queue-core.mjs`,
`merge-queue.mjs`), run by the `axf-auto-land` cron every 3 minutes (`land.mjs run`). The build orchestrator
(`build-orchestrator/pipeline.mjs`) does not gate anything itself: it hands finished builds to the lander
(`isCandidate`), keeps the dispatch gate (`dispatch-gate.mjs`, one session per build) and ships manifests after a landing.

Settings, all in the push banner's `config.json` (its `lifecycle.dataDir`):

| Key | Default | Read by | Meaning |
| --- | --- | --- | --- |
| `autoLand` | `false` (off since 0.7.1, Nov 4) | `land.mjs` round | the builds round: clean worktree, merge main in, push, open the PR |
| `landWaitUi` | `true` | `land-core.blockReason`, `merge-queue.readQueueConfig` (`waitUi`) | a PR whose UI Review is waiting / changes / rejected / unknown does not land |
| `mergeQueue` | `true` | `readQueueConfig` | the merge queue runs in every round |
| `queueMode` | `batch` (`stack` kept) | `readQueueConfig` | batch = one combined commit on `queue/batch`; stack = `queue/pr-<n>` chain |
| `queueDepth` | `3` (max 6) | stack mode | PRs tested at once |
| `batchSize` | `8` (max 20) | batch mode | PRs per batch; red batch bisected |
| `autoLander.enabled` / `autoLander.mode` | `true` / `serial` | `auto-lander-core.readLander` (branch of #705, not landed) | the one On/Off the cron reads first; serial = the queue one deep |

Control documents (hands): `auto-land-control@1` (`holds`, `now`, `after`), `merge-queue-control@1` (`order`,
`removed`, `kicked`, `added`). State documents: `merge-queue@1` (`items`, `waiting`, `kicked`, `merged`, `batch`,
`stack`), `auto-lander-run@1` / `auto-lander-status@1` (#705), and `landing-line@1` (`framework/core/landing-line.mjs`,
reference engine landed Nov 14, runner not yet switched).

Checks a PR must pass today, each written in a different place:

| Check | Where it lives today | Verdict words |
| --- | --- | --- |
| CI green on the PR head (or on the queue commit) | `land-core.blockReason` (`ci`), `merge-queue-core.notReady` (`its PR checks are red / still running / have not run yet`) | success / failure / running / none |
| Tests after generated files were resolved | `land-core.landTests()` from `framework/spec/generated-files.json` | the manifest's `tests` list |
| `check-theme`, `check-controls`, `check-toolbars` | CI jobs in `.github/workflows/android.yml` only | part of "CI green"; no separate verdict |
| UI Review hold | `push-banner/server ui_hold` through `ui-review@1`, read when `landWaitUi` | '' / waiting / changes / rejected / unknown |
| Code clash with main | `land-core.planConflicts` + `classifyPath` (builds, union, union-json, generated resolve by themselves; `code` needs a person) | conflict files; agent job for code |
| Held by hand / taken out / kicked | the two control documents | `held`, `removed`, `kicked` |
| Only the merge queue merges | shared rule (Nov 4); `autoLand` off, auto-merge off, no update-from-main outside the queue | not checked anywhere, only written down |

### What becomes a gate rule (gate-rules@1)

One rule set document (`gate-rule-set@1`) with one record per rule (`gate-rule@1`: `id`, `kind`, `enabled`,
`settings`, `severity`, `owner`). The default set, in the order the gate reads them:

| Rule id | Kind | Severity | From today's key / check | Settings |
| --- | --- | --- | --- | --- |
| `merge-queue-only` | `custom` | block | the Nov 4 shared rule; `mergeQueue`, `autoLand`, `queueMode` | `{ mode: batch\|stack\|serial, autoLand, directMerge: false }` |
| `ci-green` | `ci` | block | `blockReason` `ci` / `notReady` red-running-none | `{ on: head\|queue-commit, redJoins (batch), noRunMin: 10 }` |
| `tests` | `tests` | block | `landTests()` (`generated-files.json` → `tests`) | `{ commands: [...] }` |
| `theme` | `theme` | block | CI job `check-theme.mjs` | `{ check: 'framework/cli/check-theme.mjs' }` |
| `controls` | `controls` | block | CI job `check-controls.mjs` | `{ check: 'framework/cli/check-controls.mjs' }` |
| `toolbars` | `controls` | block | CI job `check-toolbars.mjs` | `{ check: 'framework/cli/check-toolbars.mjs' }` |
| `ui-review` | `ui-review` | block | `landWaitUi` (`waitUi`) | `{ holdOn: [waiting, changes, rejected, unknown] }`; `enabled` = `landWaitUi` |
| `clash` | `clash` | block | `planConflicts` / `classifyPath` | `{ autoResolve: [builds, union, union-json, generated], fileFix: true }` |

`severity` is `block` (holds the PR), `warn` (lands, says so in History) or `info`. `owner` is who runs the rule:
`console` now, `axf-molly` once the container owns the gate; a rule is never evaluated by both. Holds by hand
(`holds`, `removed`, `kicked`) are not rules: they stay control state and show up in `lander-state@1` waiting reasons.

`evaluate(rules, prSnapshot)` takes one PR snapshot (`{ number, head, ci, failing, checks, ui, conflicts, draft,
fork, tests, landHeld, queue }`) and answers one verdict per enabled rule with the reason in plain words, plus the
overall `pass` / `held` and the first blocking rule. It is pure, like `blockReason` and `notReady`, so the lander,
the console, the CLI, MCP and molly all give the same answer for the same snapshot.

`lander-state@1` is the record the Auto-lander tab, `lander.status` and voice read: `status` (running / paused / idle /
off), `paused` (with `why`, `by`, `at`), `mode`, `lastRuns` (the last N `auto-lander-run@1` records), `landing` (the PR
in flight) and `waiting` (every PR not landing, each with the rule id that holds it and the reason). It is built from
today's `merge-queue@1` + control + runs, and later from `landing-line@1`, without changing its shape.

`migrate(config)` reads today's `config.json` keys and produces the default rule set with `enabled` and `settings` set
from them (`landWaitUi` → `ui-review.enabled`, `queueMode` / `autoLander.mode` → `merge-queue-only.settings.mode`, …).
No key is removed from `config.json` in this build: the lander keeps reading its own keys until the gate plugin's store
adapter (s7) becomes the one writer.

### Where molly takes over

Brett's final layout (notes on both coordinating builds, Nov 15): the gate rules, merge queue and auto-lander logic run
in the private container `axf-molly` together with the orchestrator; axHub only routes (credentials, MCP tools,
approvals), with no new axHub screens; the console keeps the screens.

- **Now (this build, phase 2):** the console gate plugin evaluates the rules itself through two adapters,
  `plugins/gate/gate-store.mjs` (rule set + history, written to the plugin's `dataDir`, mirrored into the push banner's
  `config.json` keys above so the cron lander obeys the same switches) and `plugins/gate/lander.mjs` (status, waiting,
  runs, land now, pause, resume through `land.mjs lander …` / `queue …` as capability services, never a direct merge).
- **Later (move-build-orchestrator-to-axhub, re-planned):** molly runs `framework/core/gate-rules.mjs` and the lander
  inside `axf-molly`, owns the rule set and `lander-state@1`, and answers the `gate.*` / `lander.*` tools. The console
  plugin swaps only its two adapters for calls to molly over the internal Docker network; the schema, the fixtures,
  the GATE.md contract, the REST routes, the CLI, the MCP names and the voice actions do not change. The `owner` field on
  each rule records the hand-over per rule, so it can move one rule at a time.
- **axHub:** routes `gate.*` and `lander.*` to whoever owns them (console today, molly later), applies the
  veto / confirm policy on `gate.rules_set`, `gate.rules_reset`, `lander.land_now`, `lander.pause`, and never evaluates a
  rule itself.

### Coordination

- `auto-lander-controls-in-the-gate-plugin` (#705, branch not landed) adds `autoLander.enabled` / `mode`,
  `auto-lander-run@1`, `land.mjs lander …`, REST `/lander/*` on the push banner and an Auto-lander tab inside the build
  orchestrator plugin. This build's schema takes those keys and the run record as its lander input; the gate plugin's
  Auto-lander tab calls the same push-banner routes through a capability service, and the orchestrator's tab becomes a
  link to it once both are on main. No duplicate settings key is introduced.
- `move-build-orchestrator-to-axhub` (waiting, re-plan required) gets the hand-over seam named above: the two adapter
  files plus the `owner` field. Its re-plan can drop every "axHub screen" step and keep the molly backend steps.
