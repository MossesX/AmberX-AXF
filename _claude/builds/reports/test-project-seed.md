# Test project `test-sandbox`

A throwaway project for trying the multi-project system (projects@1). Made and seeded by
`framework/cli/project-seed.mjs`. Everything in it is test data.

## What is in it

| Store | Where | Seeded |
| --- | --- | --- |
| Project registry + build profile | `/projects/amberx-axf/_data/framework/plan/{projects,profiles}.json` | `test-sandbox` (Test Sandbox), its own build profile; active project left on AmberX AXF |
| Hub folder | `/projects/test-sandbox/{_claude,_data}` | `_data/project.manifest.json` (project-manifest@1, passes project-validate with the Standards rules: 0 errors, 0 warnings) and the `_claude` skeleton (rules, instructions, memory) |
| Builds | builds store, profile `test-sandbox` | `test-sandbox-sample-shipped-build` (complete, all steps done) and `test-sandbox-sample-pending-build` (pending), both titled `[TEST DATA] …` |
| Plans | `/projects/amberx-axf/_data/plan-studio/projects/test-sandbox/` | 2 plans: website relaunch, garden season |
| To-dos | `/opt/axf/.axf-console/plugins/todo-manager/projects/test-sandbox/store.json` | 2 lists, 8 groups (4 levels deep: list → Design → Home page → Hero section), 10 to-dos: open, in progress, blocked and done; 2 due today, 2 overdue; every one tagged `test-data` plus topic tags |
| Notes | `/projects/_shared/_claude/project-notes/test-sandbox/` | 5 notes (some in folders: meetings, ideas, garden) |

The pending sample build has steps with no estimates on purpose: the pipeline never splits it (it has steps) and
never auto-queues it (it "needs split"). Don't queue it by hand.

## Switching projects in the console

The picker is the **Project** chip on the banner (left side). Tap it to open the project list, then tap a project to
switch. The same list opens from:

- the app menu: **Builds → Project…** (and **New project…**)
- the right-click menu: **Project…**
- **Settings → Plugins → Projects** (also turns the banner chip on or off, and "Reload the console after switching")

A switch applies to every device and session. Builds that are running or queued in another project keep running.

Without the console:

- CLI: `node framework/cli/projects.mjs select test-sandbox` · `… select amberx-axf` · `… current`
- API: `POST /api/projects {"action":"select","id":"test-sandbox"}`, or the plugin route
  `POST /api/plugins/project-switcher/switch {"project":"test-sandbox"}`
- Voice (AmberX): "switch to project Test Sandbox"

## Deleting the test project

**Everything, in one go (recommended):** on the VPS, from the repo,

```
AXF_TODO_DIR=/opt/axf/.axf-console/plugins/todo-manager node framework/cli/project-seed.mjs purge --confirm test-sandbox
```

It removes the two sample builds (they stay in the builds journal), deletes the project and its build profile
(switching back to AmberX AXF first if it is active), and removes its plans, to-dos, notes and `/projects/test-sandbox`.
The sample build's Shipped features record (`_claude/builds/shipped/test-sandbox-sample-shipped-build.json`) is a repo
file. Delete it in a normal PR.

**From the console:** open the project list (banner chip), pick Test Sandbox, type `test-sandbox` in the confirm box and
tap **Delete**. This only takes it off the list: its builds, notes, to-dos and plans stay on disk (create a project with
the same id to get them back). Run the purge above afterwards to clear the data too.

CLI equivalent of the console delete: `node framework/cli/projects.mjs delete test-sandbox --confirm test-sandbox`.

## Checks run

- Scratch run (scratch data dir, scratch hub, builds-live off): seed, a second seed that changes nothing, status,
  purge, then seed again after purge. All clean.
- Live, with the console's own store code under each project:
  - AmberX AXF: 0 of its 790 builds and 0 of its plans are from test-sandbox; its to-do manager and notes are untouched
    (its own 1 list and 17 notes).
  - Test Sandbox: only its 2 builds, 2 plans, 10 lists and groups with 10 to-dos, and 5 notes.
- Live switch: `projects.mjs select test-sandbox`, then the running console's `GET /api/projects` reported Test Sandbox
  active; `select amberx-axf` and it reported AmberX AXF again. It stayed on Test Sandbox for about two seconds.
- `framework/spec/check-projects.mjs` (29 passed) and the to-do manager self-test (61 passed).

## Found along the way

**Steps doubled on a build added from a worktree.** The pending sample build reached main with its 3 steps twice (6
steps, the extra uids made about a second after the add). Here is the order of events, from the journal: this worktree
added the build and exported `framework/plan/profiles/test-sandbox/framework/plan/pending.json` to the hub. Another
checkout that shares the hub took that export in as a foreign write (`builds-store.mjs` absorbForeign →
`absorbPending`) and made its own copy of the build, with new step uids. builds-live then merged the two copies and kept
both sets of steps. I removed the three duplicates with `orchestrator.mjs act remove-step` and main shows 3 steps again.
This can happen to any build that is filed with steps from a worktree, whatever its profile. It needs a fix in the
builds store: for example, skip a foreign `$export` item whose build id another checkout made, or match steps by text
before uid when merging. I left that out of this PR because it is a builds-store engine change.

**Shipped manifest.** Marking the sample build complete made the orchestrator write
`_claude/builds/shipped/test-sandbox-sample-shipped-build.json` on main (Shipped features). It says it is test data. The
purge command can't remove it because it is a repo file: delete it in a normal PR when the project goes.

**Registry ownership.** `projects.mjs` and `profiles.mjs` save their registries with write-and-rename. Run as root (the console container, host
CLIs), that leaves `/projects/amberx-axf/_data/framework/plan/{projects,profiles}.json` owned by root with mode 644,
where they were `deploy:deploy` 664. After the switch test I put both back to `deploy:deploy` 664. Nothing that writes
them today runs as `deploy`, so nothing is broken yet. The builds store already hands its files back to the hub owner,
and these two writers could do the same.
