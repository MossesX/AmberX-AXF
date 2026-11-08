<!-- memory-chunk@1 source=_claude/memory/docs/build-steps.md tokens=438 -->
## Where the steps live

- **Pending items** (`framework/plan/pending.json`): the sub prompts *are* the steps: `subPrompts[] = { text, at, estimate?, done?, doneAt? }`.
  Tick one off with `pending_change(action="step", id, index, done=true)` (MCP), `{action:'step', id, index, done}` on
  `POST /api/pending`, or the checkbox in the console's Pending builds view. `pending_steps(id)` lists them numbered
  with the time left. `update` takes `subPrompts` to replace the whole list (re-splitting).
- **Build-queue steps** (`framework/plan/build-queue.json` → `steps[epicId]`): `estimate?` and `steps?: [{ text, estimate?, done?, doneAt? }]`.
  Edit with `build_steps(id, …)` (MCP), `POST /api/build-queue/steps`, engine-rpc `build-steps`, or
  `stepsAction` in `build-queue-core.mjs`. The queue view carries `estimate`, `steps`, `stepsDone`, `minutesLeft`,
  `needsSplit`, `splitReasons` per step and `minutesLeftByModel` + `unsplit` overall.
- **Validator**: `splitCheck(entry)` / `needsSplit(entry)` in `pending-core.mjs` (works on a pending item or a queue
  record) = estimate over 30 min with no steps, a step over 30 min, or a step without an estimate on a big build.
  `stepsProgress(entry)` = done/total + minutes left. Console rows show "needs splitting" and "n/m steps · time left".
- **CI** (`android.yml`, node job): `node framework/spec/check-build-steps.mjs` (40 core checks, fails),
  `node framework/cli/pending.mjs --check-steps` and `node framework/cli/build-queue.mjs --check-steps` (list what is
  unsplit; warn only, `--strict` fails).
- Plan epics that mirror a pending item (`x.assets.designer/browser/templates`) carry the same steps as the item;
  tick them in one place (the pending item) and mark the epic built at the end.
