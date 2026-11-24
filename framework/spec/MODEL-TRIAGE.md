# Model triage (model-triage@1)

Brett, Nov 21 2026: "The orchestrator stops choosing models. It only sends builds to the VPS; a VPS-level gate decides
which model each build/step runs on." Every lane goes through the gate: orchestrator steps after the split, emergency
builds, hand builds and the lander's fix sessions. Nothing else picks a model, and the console holds no logic: it shows
what the VPS answers and sends edits to it.

The flow: Plan Studio designs and sends → the orchestrator splits into the real steps and writes them to the builds
store → **the VPS triage gate assigns the model per step** → the dispatcher runs the steps on the slots → Plan Studio
checks them off live.

| Part | File |
| --- | --- |
| Engine (pure): rules, `decide`, `applyEdit`, `normConfig`, `normDecision` | `framework/core/model-triage.mjs` |
| VPS side: rule store, measured facts, decision log, CLI | `framework/cli/model-triage.mjs` |
| Conformance + fixture | `framework/spec/check-model-triage.mjs`, `framework/spec/fixtures/model-triage.json` |
| Console tab (display and edits only) | VPS Configuration → Model triage <!-- axf-plugin:gate --> |

## The decision

`decide(work, config, ctx)` → model-decision@1 `{ model, rule, why, lane, facts, at, [from], [held, wanted], [suggested] }`.

1. **Explicit overrides win** (`rule: override`), in this order: a `pin` on the step (Plan Studio's model on a planning
   step, `model-triage.mjs pin`), a brief or step that names its model (`Model: Fable`, a leading `[Opus]`, "run it on
   Fable", a title ending `(…, Fable)`; `defaults.briefWords`), the build-wide model Brett set (Claude settings
   `builds.defaultModel` = Opus or Fable; "per step" = the rules decide).
2. **The rules, in order; the first that is on, covers the lane and matches decides.** The decision names it.
3. **No rule matched:** `defaults.model` (starts as the model policy's "unsure" = Fable).
4. **A hand launch's own model** (`defaults.handRequest`): `floor` (default: the gate may raise it, never lower it;
   `rule: requested` when the floor decided), `pin` (an override) or `ignore`.
5. **"Fable upgrades need my approval"** (Claude settings `builds.fableUpgradeApproval`, default off = upgrades run
   without waiting). On: a rule that would raise the work above the model it already has is held (`held: true`,
   `wanted`), the lower model stays. An override is Brett's own word and is never held.

The gate off (`enabled: false`): every lane gets `defaults.model`; overrides still win.

## The rules (Fable profiling, Brett, Nov 19 2026)

Measurable, tunable, starting numbers. Every one has an on/off switch, the model it sends work to, the lanes it covers
and its settings (`RULE_FIELDS`); the order is editable.

| Rule | Fires when | Starts at |
| --- | --- | --- |
| `ci-fix` | a lander fix for red CI or failing build rules, or the text says so | phrases list |
| `merge-clash` | a lander fix for a code conflict, or the text says so | phrases list |
| `second-try` | sessions of this step that ran and ended in an error (not a launch that never started, not a usage limit) | 1 |
| `contracts` | a file under a contract path, or a contract word | `framework/spec/`, `framework/schemas/`, `framework/core/`, `framework/plan/`, the builds store, `*.schema.json` |
| `blast-radius` | tracked files that name the step's files (measured on the VPS with `git grep`) | 10 |
| `size` | lines changed (when known), files touched, estimated minutes | 400 lines, 8 files, minutes off |
| `cross-cutting` | areas touched (one plugin, one app, one framework folder), or an architecture word | 3 areas |
| `designer` | the splitting stage judged the step (Fable stands; its Opus stands too while `keepOpus` is on); a model that only came with an older record raises, never lowers | on |
| `fable-words` | the model policy's Fable word list (`model-policy@1`, never a second copy) | on |
| `simple-work` | the model policy's Opus word list → Opus | on |

## Where each lane asks

- **Orchestrator steps** (`pipeline2.mjs`): at the split (so a waiting build already shows its models) and again at
  `assigning-models`, where the gate also measures the blast radius. The step keeps `model` and `triage` (the
  decision); the build's note lists them. A step whose session failed asks again before it is sent back out. The
  splitter's model per step is a suggestion (`suggestedBy: splitter`), not a pin. The older one-session pipeline's
  split (`pipeline.mjs splitBuild`) asks the same way.
- **Emergency builds**: the same code path, lane `emergency`.
- **Hand builds** (`deploy/claude-headless.sh`, so axHub `vps.build_start` and console launches): before the launch
  gate, the launcher asks `model-triage.mjs launch --name --brief --model <asked>` and replaces `--model` with the
  answer. Launches that were assigned already (`AXF_SURFACE=pipeline | lander | agent-job | swarm | agent`,
  `AXF_MODEL_TRIAGED`) are not asked again. A gate that cannot answer changes nothing.
- **Lander fix sessions** (`deploy/lander/fix-session.mjs`): lane `lander-fix`, kind `ci-red | clash-main | rules`.

The launch gate (`framework/cli/model-gate.mjs`) still refuses a launch above the model on the step's record.

## Store, log and reach

Store folder: `AXF_MODEL_TRIAGE_DIR`, else beside a scratch builds store, else the hub mount
(`/projects/amberx-axf/_data/model-triage`, shared by the host dispatcher and the console), else `~/.axf/model-triage`.
`config.json` (absent = the starting rules), `history.jsonl` (every rule change: who, when, what, why),
`decisions.jsonl` (one line per decision: build and step or session, lane, model, rule, why, facts).

| Reach | Read | Change |
| --- | --- | --- |
| CLI | `node framework/cli/model-triage.mjs status \| decisions \| history \| decide --text "…"` (`axf gate model-triage …`) | `rule <id> on\|off \| model <m> \| set <key> <value> \| lanes <a,b> \| move <n>`, `defaults …`, `gate on\|off`, `reset`, `pin <build> <step\|all> <opus\|fable\|none>` |
| REST | `GET /api/plugins/gate/model-triage`, `…/decisions`, `…/history`, `POST …/decide` | `POST /api/plugins/gate/model-triage {op, …}` | <!-- axf-plugin:gate -->
| MCP | `vps_model_triage`, `vps_model_triage_decisions`, `vps_model_triage_history`, `vps_model_triage_decide` | `vps_model_triage_set` |
| Voice / actions | `vps.model-triage.status`, `vps.model-triage.open` | `vps.model-triage.rule:<id>:on\|off`, `vps.model-triage.default:<model>` |
| console-control@1 | `setting:vps.modelTriage.enabled \| default \| handRequest \| <rule>.enabled \| <rule>.model \| <rule>.<setting>` | the same, `set` |
