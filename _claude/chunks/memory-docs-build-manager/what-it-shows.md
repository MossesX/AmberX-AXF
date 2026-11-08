<!-- memory-chunk@1 source=_claude/memory/docs/build-manager.md tokens=625 -->
## What it shows

**Everything still to build, one list** (one row per build, nothing counted twice):

| Source | What's listed | Steps / estimate read from |
|---|---|---|
| Pending | pending items not complete (pending, unsafe, broken, failed); Fable ones are the Fable rebuilds | item `estimate?`, sub prompts `{text, estimate?, done?, doneAt?}` |
| Queue | build-queue steps not done (queued, in progress, blocked, needs rework) | `StepRecord.estimate?`, `StepRecord.steps?: {text, estimate?, done?, doneAt?}[]` |
| Plan | unbuilt plan features no epic covers (`feature.epic` / `epic.catalog`) | optional `estimate` / `steps` on the feature |

A pending item linked by `planId` replaces the queue step or plan feature with that id (the row keeps the queue position).
Each row: title, source badge, model chip, status, **time left** (its estimate, else its steps added up, minus done steps;
"no estimate" badge when there's none), steps bar (n of m), **needs split** when over 30 min with no steps (rule "Small
steps for big builds"), and a drop-down with details and every step (estimate + tick). Filters: model, status, source,
needs split. Sort: build order, time left (shortest first), model. **Totals by model**: time left on Fable / Opus / Sonnet + all.

**Live tracker** at the top: activity-feed items (capability `axf.activity@1`: GitHub runs, console update, assistant
replies, VPS jobs, Claude Code reports) plus builds marked in progress (plan status `in-progress`, elapsed since its
"Build started" history line). A run is linked to its build by branch `fable/<id>`, `rebuild/<id>` (also `<id>-fable`),
`harvest/<plan id>` (dots = dashes), `pilot/<…>`, or a report naming the id. Each entry: elapsed vs estimate (amber when
over), current step, progress bar, link to the item and the run. Finished entries linger 4 s, then leave.

**Banner** (order 4.5, right after the Activity banner) only while a build from the list is in progress or just
finished; tap opens the Build manager at that item; ✕ hides it until something new starts.

**Settings → Plugins → Build manager**: banner on/off, default sort, which sources; About (totals, tick status); Install & uninstall.

**Hooks**: action `build-manager.open[:<row key | id | planId>]`, `build-manager.refresh`; search provider
`build-manager.items` (every build); default context menu; context target `axf-build-item` on rows; "Open in Build
manager" on Pending builds rows (`axf-pending-item`) and Plan features (`axf-plan-feature`).
