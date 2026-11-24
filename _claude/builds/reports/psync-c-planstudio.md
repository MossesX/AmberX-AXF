# psync-c-planstudio: Plan Studio 2.0 reads its build live (part C of 4)

Hand build, branch `claude/psync-c-planstudio`. Covers steps s5 and s6 of `pipeline-sync-live-badges` and the later
notes that name Plan Studio 2.0 (build number, step unique id in its own column, merge line, clash options).
Only `apps/console-web/plugins/plan-studio-2/**` was changed (plus this report). No PR, not landed, CI not run:
the voice session combines the four branches.

## What changed

**Server (s5)**
- `GET /api/plugins/plan-studio-2/plans/<planId>/build` (op `plan-build`, plugin command `plan-build`, so REST, MCP
  and the CLI get it). Reads the builds store on every call and returns
  `{ plan, build: { id, number, title, status, label, pipelineView, split, clash, pr, branch, held, landed }, steps: [{ id, uid, row, title, text, model, modelBy, splitBy, status, label, minutes, done, waitsFor }] }`.
  `build` is `null` for a plan that was not sent. Nothing is written to the plan tree.
- Stale status fixed: a sent plan lists with its build's status (`active`, `done` once landed) and its build's steps in
  the tree view, `tree.mjs list`, and plans@1 (`building` / `done`). The stored plan keeps its own status and gets it
  back if the build is cancelled.
- CLI: `node apps/console-web/plugins/plan-studio-2/tree.mjs build-status <plan>`.

**Screen (s6)**
- Under each sent plan: `Build #<number>` (opens the orchestrator), the state badge from `pipelineView` (label, tone,
  icon), the plain status line, the waiting reason, the `Split by Fable on the VPS` badge, the merge line
  (`2nd to merge, waiting for build #38`), a rejected build's reason with its options (run all / defer steps, each
  deferred step naming the build it waits for), and the steps table: Step ID (the unique id, own column), Step, Split,
  Model (triage model, or "Model not assigned yet"), Status. On a phone each step is a block with the same five fields.
- Live: `EventSource('/api/builds/events')`, every `builds.updated` re-reads the watched plans and the tree; also on
  window focus / tab visible; closed when the last panel leaves the screen.
- The build's steps moved from tree rows into this table. Clicking a step still opens the read-only step editor with
  the orchestrator actions. The state looks from settings still apply to the table rows.

## Contract read from the siblings (and the fallbacks)

| Field | Fallback when absent |
| --- | --- |
| `build.number` | the build id is shown |
| `build.pipelineView { state, label, tone, icon, line, attempt, waitingOn, mergeLine { position, waitingFor } }` | taken from the store read; else `pipelineView()` from `framework/core/pipeline-status.mjs` if that export exists; else `null` and the raw status as a plain badge |
| `build.split { by, model, at, stepCount }` (also read from `pipelineView.split`) | no split badge |
| step `uid`, `splitBy`, `model`, `modelBy`, `status` | `-`, the build's split, "Model not assigned yet", plain label |
| `mergeLine.waitingFor` | accepts a number, a build id, or `{ number, buildId, title }` |

## Decisions and assumptions to check when combining

1. **Clash shape is my guess**: the brief gave no contract for it. The page reads `build.clash` (or
   `pipelineView.clash`): `{ rejected, reason, with: [build ref], options: [{ id: 'run-all' | 'defer', label, line, action, steps: [{ step, uid, title, waitsFor }] }] }`,
   and a step's `waitsFor`. If parts A/B/D named it differently, `clashOf()` in `web/live-core.mjs` is the one place to
   adjust.
2. **Clash option buttons post `orchestrate` with action `run-all` or `defer`**. The plugin server now lets those two
   through to `axf.build-dispatch@1 act()`. If the orchestrator does not implement them, the tap answers with its
   refusal; nothing else breaks.
3. **CLI is `build-status`, not `build`**: `tree.mjs build <item>` already means "send to build".
4. **The route reads the whole builds store per call** (required: live on every call). The page fetches once per sent
   plan and again per event burst (250 ms settle).
5. One existing assertion in `test.mjs` changed: setting a sent plan's status through plans@1 is still stored, but it
   now reads back as `building` while the build is under way (that is the fix).

## Verified

- `node apps/console-web/plugins/plan-studio-2/test.mjs`: 19 checks passed
- `node apps/console-web/plugins/plan-studio-2/live.test.mjs`: 18 checks passed (4 new: unlinked plan unchanged, linked
  plan returns the store's steps and status with nothing written to the tree, the display words for every contract
  field and fallback, the route / table / event stream wiring)
- `node apps/console-web/plugins/plan-studio-2/toolbar.test.mjs`: passed
- `python3 apps/console-web/plugins/plan-studio-2/server/test_orchestrate.py`: 20 checks passed
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: all pass
- `tsc --noEmit` in apps/console-web: no errors in plan-studio-2 (one unrelated error for the generated
  `src/control/inventory.json`, which `npm run build` creates); `npm run build` passes
- Screenshots, desktop and phone, from a fixture carrying the full contract: `/root/axf-builds/_shots/psync-c/`

## Open: UI Review not submitted

`review.mjs submit --console` needs `AXF_CONSOLE_URL` and `AXF_TOKEN`, and this headless session has neither. The shots
are ready in `/root/axf-builds/_shots/psync-c/` (6 for review: `sent-tree`, `build-waiting-rejected`, `sent-step`, each
desktop and phone). Submit them with the combined PR number:

```
S=/root/axf-builds/_shots/psync-c
node apps/console-web/plugins/ui-review/review.mjs submit --kind screen --name "Plan Studio 2.0: build panel under each sent plan" \
  --app console-web --screen plan-studio-2 --group "psync-c-planstudio - Nov 24 1:30 AM" \
  --shots $S/plan-studio-2-sent-tree-desktop.png,$S/plan-studio-2-build-waiting-rejected-desktop.png,$S/plan-studio-2-sent-step-desktop.png,$S/plan-studio-2-sent-tree-phone.png,$S/plan-studio-2-build-waiting-rejected-phone.png,$S/plan-studio-2-sent-step-phone.png \
  --build psync-c-planstudio --branch claude/psync-c-planstudio --pr <combined PR> \
  --single-option "The layout is set by the requirements" --console
```

## Not verified

- Against the real sibling code: `pipelineView`, `number`, `split`, `mergeLine`, `clash` and `/api/builds/events` do
  not exist on this branch, so they were exercised with mocks and fixtures only. The end-to-end watch test from the
  build's notes (a 5-step build followed from split to landed) needs the combined branch.
- `plugin-lifecycle check plan-studio-2` reports two "stale reference" lines, both in the launcher's untracked
  `.brief.md` in this worktree, not in the repo.
