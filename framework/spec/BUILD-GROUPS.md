# Step groups: one build over several slots (step-groups@1)

Brett, Nov 16 2026: "We need to wire the orchestrator to be able to do that. Any build that's over 30 minutes, split
the steps up for multiple slots."

A build whose estimate is over the threshold (setting `splitOverMin`, default 30) is split into **step groups**. Each
group is a run of steps that must stay in sequence (they touch the same files, or one says it depends on another).
Groups that share nothing run at the same time, each in its own slot, session, sub-branch and worktree. When a group's
steps are all done it waits for its turn in the **merge order** and is merged onto the build branch; when every group
is merged the build lands as one PR, as today.

Not to be confused with `build-groups@1` (`apps/console-web/plugins/build-orchestrator/groups-core.mjs`): those are
the custom groups and tabs on the builds board. This spec is about splitting ONE build's steps.

## Contract (`framework/core/build-pipeline.mjs`, section step-groups@1)

Step fields on a builds@1 step, all optional:

| field | meaning |
|---|---|
| `group` | id of the group the step runs in; `''` = not grouped yet (the implicit group) |
| `dependsOn` | step ids in the same build that must be done first; an explicit edge on top of the ones the engine derives from `files` (`normDependsOn`: unique ids, at most 30) |
| `files` | the files the step touches (an existing step field): two steps that share a file are in sequence |

`groups[]` on the build (one `BuildGroup` each, in merge order):

| field | meaning |
|---|---|
| `id` | `g1`, `g2` … from the engine; a hand-made id may be any short slug (`groupId`) |
| `steps` | step ids in run order; every step is in exactly one group |
| `state` | `planned` → `ready` → `running` → `ready-to-merge` → `merging` → `merged`; `conflict` and `failed` on the side (`GROUP_STATES`) |
| `dependsOn` | group ids that must be merged before this one starts |
| `slot`, `account`, `session` | its run; blank unless the group is live (`running`, `merging`, `conflict`) |
| `branch`, `worktree` | its sub-branch `<build branch>--<group id>` (a ref beside the build branch: `<build branch>/<id>` can't exist next to it) and the worktree `<worktrees>/<build id>--<group id>` on it (`step-groups.mjs`) |
| `mergeOrder` | its place when the groups land, 0-based; `normGroups` sorts by it and renumbers |
| `startedAt`, `endedAt`, `mergedAt`, `note` | timestamps of its life and one plain line |

### Unset = one sequential group

A build without `groups` is not changed on read or write. `groupsOf(build)` answers one implicit group, `g1`, holding
every step in step order, with a state read from the steps (`groupStateOfSteps`: nothing done = `planned`, some done =
`running`, all done = `ready-to-merge`; a merged build = `merged`). Every build from before step-groups@1 therefore reads
the same, the dispatcher has one code path, and the store's exports stay byte-stable.

`isSplit(build)` is true only when `groups[]` holds more than one group. `groupOfStep(build, id)` finds a step's group
(its `group` field first, then the group that lists it). `readyGroups(build)` lists groups whose dependencies are all
merged and that have not started, in merge order: what a free slot may take.

### Persistence (builds@1)

`normBuild` keeps `groups` (through `normGroups`) and each step's `dependsOn` (through `normDependsOn`); both are left
out of the record when empty, like `origin` and `pipeline`. They are part of the record's content, so every group write
bumps the build's `rev` and lands in the journal before/after like any other field. The orchestrator@1 projection
carries them both ways (`ORCH_BUILD_KEYS`, `ORCH_STEP_KEYS`), so an orchestrator write never drops them.

## Engine (`framework/core/build-groups.mjs`, `planGroups`)

Pure. In: a build (steps with `files`, `dependsOn`, `estimate`) and options `{ splitOverMin }`. Out: `{ split, groups,
mergeOrder, minutes, reason }`.

1. The build's minutes = the sum of its open steps' estimates (a step without one counts as the step cap, 10 min).
   At or under `splitOverMin`: one group, `split: false`, `reason` says why.
2. Edges: step B depends on step A when A comes earlier and they share a file, or when B's `dependsOn` names A. A
   `dependsOn` that names a later step, an unknown step or makes a cycle is refused (`error` set, no groups written).
3. Groups = the connected components of that graph, each with its steps in step order. A component is one sequential
   run; components are independent and may run at once.
4. Merge order: topological over the component graph, ties by the first step's position. Steps that depend on a step
   in another component make that component a `dependsOn` of theirs.

Golden cases: `framework/spec/fixtures/build-groups.json`, run by `framework/spec/check-build-groups.mjs`.

## Later steps of the same build (open, nothing here constrains them)

Splitter prompt fills `files` and `dependsOn`; group worktrees and sub-branches; dispatcher fan-out of ready groups;
headless launch per group (`--group`); group lifecycle and merge-back in order; landing as one PR; server-gate rule
`parallel-groups`; setting `Split builds over (min)`; per-group progress panel and group actions in the UI; REST under
`/api/plugins/build-orchestrator/groups`, MCP / CLI / voice commands `orchestrator-groups-*`; tests.

## Porting

Pure engine in `framework/core`; the Android twin (Kotlin) is a deferred gap recorded in `framework/spec/PORTING.md`
when the engine lands.

## Landing and the gate (build rule `parallel-groups`)

The build branch of a split build reaches GitHub once, after its last group is merged (`step-groups.mjs
pushBuildBranch`); the build's `after` rules then open the one PR from it (`pr-open-link`), and the merge queue takes it
as one entry. Sub-branches (`--g<n>`) never get a PR: the push banner's autoPr and Open PR skip them, and so does
`pr-open-link`. Build rule `parallel-groups` (build-rules@1, doer `vps`, phase `gate`, check `fixer:parallel-groups`)
holds a PR whose build still has a group that is not merged; sessions never merge groups themselves.
