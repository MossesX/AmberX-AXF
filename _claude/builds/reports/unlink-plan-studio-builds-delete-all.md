# Unlink Plan Studio from builds; delete all Plan Studio plans

Build `unlink-plan-studio-builds-delete-all` · Opus · branch `claude/unlink-plan-studio-builds-delete-all`

## Brett said (verbatim)

> I want to delete all the plans and um, I no longer want build to automatically make a plan studio plan or sync with them... I don't want this plan studio to be linked to the build at all

## Result

- **Plans deleted.** On Nov 12 every plan in the hub store (`/projects/amberx-axf/_data/plan-studio/`) was deleted:
  249 ids are in `deleted.json`, and their history is kept, so `api restore` can bring any one back. The three seed plans
  (Docs Studio, AmberX Selling It, ClipX) were removed from the plugin, so a reinstall does not bring them back.
- **Three plans made after the wipe were kept:** `amberx-framework-and-console-pgv4` (console),
  `plugin-review-what-to-disable-8i0h` and `vision-doc-amberx-axf-explained-px6z` (voice). Brett created them on
  Nov 12 after the deletion. None of them has a build link. Remove them with `plans.mjs delete --all` if they should go too.
- **No build link remains.** Builds never create, sync or update plans:
  - build-plan@1 per-build plans and the plan-studio-backfill-12h output are gone.
  - `sync-builds` / `build` ops and Turn into a build are gone.
  - Build priority no longer pulls plans.
  - The build-hook comment and the rule "every build goes to Plan Studio" are gone.
  - plan@1 keeps `build: null` only so older files still validate.
  - build-todo-sync never landed, so there was no code to remove.
- **Delete is reachable everywhere** (it did not exist before):
  - REST: `POST /api/plugins/plan-studio/delete` with `{id}` or `{all: true, status?}`, and api ops `delete` / `delete-all`.
  - MCP / CLI plugin command: `plan-studio delete`.
  - control@1: `remove planner.plans <id>`.
  - CLI: `plans.mjs delete <id>… | delete --all [--status s]`.
  - Capability: `plans@1 delete / delete_all`.
  - Voice: "delete this plan" and "delete all plans", each with a yes/no confirm.

## Steps

| Step | Commit |
| --- | --- |
| s1 delete plans, delete action, unlink builds, tests | `Plan Studio: delete all plans, unlink from builds (s1)` |
| s2 clear remaining build links (docs, lifecycle mentions) | `Plan Studio: clear the last build links from docs (s2)` |
| s3 tests, report, THREADS, PR | this commit |

## Tests

- plan-studio: `test.py` 21 server checks, then `test.mjs` 27 checks on Node 22. These include: deleting all plans
  empties the store; a whole build life (add, step, finish) creates no plan; no builds-side code reaches the plan store.
- build-orchestrator `test.mjs`: 34 checks pass. `check-build-priority` passes (8), token-control passes (21),
  shipped-features passes (10, Node 22).
- check-theme, check-controls, check-toolbars and check-chrome-assets all pass. `plugin-lifecycle check plan-studio`
  only flags the git-ignored local `.axf-focus.json`.
- Both plan-studio and build-orchestrator suites now run in CI (`android.yml`).

## Open items

- **Merge conflicts:** main is 866 commits ahead and conflicts in `plan-studio/plans.mjs`, `server/__init__.py` and
  `web/plan-core.mjs`. Main added a content `find` op and route (`GET /find`) after this branch was cut. Keep it when
  resolving, and drop only `sync-builds`, `build` and the Turn into a build code.
- **Old comments on main:** baked `build-hook.mjs` copies in `apps/axhub-web` and `apps/molly` (added on main after the
  branch point) still mention "Turn into a build" in a comment. The next framework re-bake fixes them.
- **UI Review:** no shots were taken. The UI change is only a removal (the Turn into a build panel and the build progress
  badge in the editor). Shots of this stale branch would not match the merged screen. Take desktop and phone shots of
  Plan Studio's editor once the merge queue resolves the conflicts.
