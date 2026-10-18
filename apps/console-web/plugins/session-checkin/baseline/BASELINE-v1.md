# Baseline build v1 (fixed reference task)

**Never changes.** Every session check-in quotes this task's cost per model × effort so numbers stay comparable
across sessions, models and price changes. A new version (`BASELINE-v2.md`, tag `baseline-v2`) starts a new
calibration; v1 is never edited.

Run it only to calibrate, in a throwaway worktree at tag `baseline-v1`, and never merge or push the result:

```bash
git worktree add /tmp/axf-baseline baseline-v1 && cd /tmp/axf-baseline
claude --model <fable|opus|sonnet>      # set the effort level, then paste the task below
# afterwards: node apps/console-web/plugins/session-checkin/checkin.mjs calibrate --model … --effort … --input … --output … --cache-read … --wall … --tool-calls …
git worktree remove --force /tmp/axf-baseline
```

## The task (paste exactly)

> Read `framework/core/engines/layout.ts`, `framework/spec/PORTING.md` and `framework/schemas/asset-types.json`.
>
> In `framework/core/engines/layout.ts`, add and export a pure function
> `compareSlots(a: CompiledSlots, b: CompiledSlots): { added: Record<SlotRegion, string[]>; removed: Record<SlotRegion, string[]>; changed: SlotRegion[] }`:
> - for every region in `SLOT_REGIONS`, `added[region]` = types in `b[region]` not in `a[region]`, `removed[region]` = types in `a[region]` not in `b[region]`, both sorted alphabetically;
> - `changed` = the regions where `added` or `removed` is non-empty, in `SLOT_REGIONS` order;
> - a region missing from either input counts as an empty list; inputs are never mutated.
>
> Add `framework/core/engines/layout.compare.test.mts` with these five tests (plain `node:assert`, run with `npx -y tsx`):
> 1. identical slots → no changes;
> 2. a type added to `toolbar` → `added.toolbar` has it, `changed` = `['toolbar']`;
> 3. a type removed from `nav` → `removed.nav` has it;
> 4. a region missing from `b` → all of `a`'s types for it are removed;
> 5. the inputs are unchanged afterwards (deep-equal to copies taken before the call).
>
> Then run `npx -y tsx framework/core/engines/layout.compare.test.mts` and `npx tsc --noEmit -p apps/console-web`
> (or the nearest tsconfig that includes `framework/core`) and make both pass. Don't change anything else.

## What gets measured

Input, output and cache-read tokens (Claude Code's usage/cost output, or the API `usage` fields on an API key),
tool calls, wall time, and pass/fail (both commands pass, nothing else changed). Record it with `checkin.mjs calibrate`.
