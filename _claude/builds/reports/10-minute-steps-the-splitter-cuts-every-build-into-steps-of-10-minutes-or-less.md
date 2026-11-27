# 10-minute steps — report

Build `10-minute-steps-the-splitter-cuts-every-build-into-steps-of-10-minutes-or-less` · branch
`claude/10-minute-steps-the-splitter-cuts-every-build-into-steps-of-10-minutes-or-less` · Opus, one headless session · Nov 13 2026.

## What changed

- **10-minute steps (was 30).** `web/orchestrator-core.mjs` has `STEP_MINUTES = 10`, `maxStep(rules)` and `stepLimit(step, rules)`.
  The splitter prompt (`splitPrompt`), Claude's answer check (`parseSplit`, now up to 60 steps), the rules fallback
  (`rulesSplit`, 10 min per step including the closing step), `needsSplit`, `splitCheck` and the brief all use them.
  `DEFAULT_RULES.maxStepMinutes` is 10 in both cores (`framework/plan/builds-store-core.mjs` too).
- **10 is a ceiling.** The Largest step rule can lower it but never raise it. The stored rule (`rules.all.maxStepMinutes: 30`
  in the live store) reads as 10, so the live store did not need a write. The `rules` action clamps to 1–10.
- **Existing builds are not re-split.** Steps written before `TEN_MINUTE_STEPS_AT` (2026-11-14T00:00Z) keep the 30-minute
  limit, so builds already in Pending or the Queue are not flagged "needs split" and auto-queue keeps working. To make this
  work, the step's `createdAt` now passes through the store projection (`orchStep`) and `normStep`. A re-split
  (Split button / `pipeline.mjs split`) produces 10-minute steps.
- **Steps are checkpoints inside one session.** The phase brief has a new `CHECKPOINT_RULE` line, and the dispatcher's
  launch prompt (`pipeline.mjs briefFor`) says: work through every step of the phase without stopping; after each one,
  commit on your branch, push, then tick; never ask for a new prompt or relaunch per step. A session that dies is picked
  up at the first open step on the same branch. The splitter prompt says the same, so Claude cuts fine-grained steps.
- **Every place the limit is stated** now says 10: Rules field (1–10, shows the effective value, with a checkpoint note),
  the add-step placeholder, the Split button title, plugin.json, help.json, the glossary, the AmberX "add build" voice prompt
  and the `framework/core/build-pipeline.mjs` doc.

## API

The step-size rule existed before this build and keeps the same surfaces, with the new ceiling:
- REST: `GET /api/plugins/build-orchestrator/state` (rules readable), `POST …/act {"action":"rules","rules":{"maxStepMinutes":8}}`.
- MCP: the plugin's auto commands for the same two routes (`commands.auto`).
- CLI: `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act '{"action":"rules","rules":{"maxStepMinutes":8}}'`.
- Deep link: `#/build-orchestrator` → Rules tab.
- Split on demand: `pipeline-split` command / `pipeline.mjs split <id>`.
- Voice: no dedicated phrase for the rule. AmberX's "add build" phrase asks for 10-minute steps.

## Checks

- `apps/console-web/plugins/build-orchestrator/test.mjs`: 35 passed (new: ceiling, legacy limit, createdAt kept, rules clamp, checkpoint brief)
- `pipeline.test.mjs`: 45 passed (prompt, parse limit 10, rules split 10 min, needsSplit legacy, e2e brief checkpoint wording)
- `check-builds-store` 40, `check-builds-live` 62, `check-build-limit` 52, `check-build-origin` 21, `check-build-priority` 8, `check-model-policy` 18
- `check-theme`, `check-controls` pass; console-web `tsc --noEmit` is clean for the plugin.
- `plugin-lifecycle check build-orchestrator` reports stale references in `framework/spec/check-projects.mjs`. That file is
  unchanged by this build, so the findings were already there.

## Not done / notes

- The request title was cut off at "Update the splitter prompt, the". I read it as: update the splitter prompt and every
  place that states the limit.
- `framework/cli/build-queue.mjs` and `framework/cli/pending.mjs` `--check-steps` (legacy plan queue / pending.json) still use 30.
  They check the old plan files, not orchestrator builds.
- `plan-studio/web/plan-ai.mjs` still says plan steps are 30 minutes. Plan Studio is a separate plugin with its own step concept.
- UI change is text plus a field range (Rules tab). No UI Review shots were taken in this headless run.
