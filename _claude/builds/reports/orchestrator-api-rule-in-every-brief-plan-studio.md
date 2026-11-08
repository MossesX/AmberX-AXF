# Orchestrator: API rule in every brief + Plan Studio stepped plans, always in sync

Build `orchestrator-api-rule-in-every-brief-plan-studio` (profile all, Opus), branch `claude/orchestrator-api-rule-in-every-brief-plan-studio`.

## Brett said (verbatim)
> Now I want to make sure he makes the orchestrator is going to include in the briefs, everything comes with an API. It also needs to make the stepped plan in Plan Studio for the build. And it needs to update any plan in the Plan Studio. So the Plan Studio needs to be uh, somehow synced with future builds.

Note on the build (Nov 8): the plan's steps must match the orchestrator's split exactly (ids, order, text, estimates,
models), a check fails and notifies on any mismatch, and every build already pending gets its plan.

## What changed

**1. The API rule is in every brief.** `API_RULE` in `build-orchestrator/web/orchestrator-core.mjs` (`brief()`, which the
pipeline dispatcher's `briefFor` and `orchestrator.mjs brief` use) and in `build-manager/web/orchestrate.mjs`
(*Start build now* briefs): anything with a UI gets a deep link, readable state and every action and setting through
REST, MCP (console actions, plugin commands, control@1), the CLI and voice; a UI-only feature isn't done, and the PR
says how each piece is reached. `_claude/builds/BRIEF-TEMPLATE.md` says the same.

**2. Every build gets its stepped plan in Plan Studio (build-mirror@1).** Plan Studio is now a build-hook@1 listener
(`plugin.json` → `buildHooks: build-sync.mjs`). Every builds store write (created, split, re-split, step ticked,
status / phase change, PR opened or merged, addendum, failure) mirrors the build into its plan: plan id = build id,
steps = the build's steps (same ids, order, text, minutes, model, done; skipped steps count as done), status mapped
(pending → parked, queued → ready, running / waiting / blocked / failed / built → building, complete → done,
archived → dropped), priority, Brett's words (`origin`), build / PR / branch links, progress. What a build doesn't
carry (the body, requirements, comments, features, a category set in Plan Studio) stays the plan's own.
Pure core: `plan-studio/web/build-mirror.mjs`.

**3. Plan Studio edits flow back.** Saving a build's plan in Plan Studio (page, API, AI, bulk; not the mirror itself)
writes the difference into the builds store through the orchestrator projection (`pushToBuild`): step text, model,
estimate, tick done, new steps (next `s<n>`), removed open steps (kept in `removedSteps`), title. Done steps are never
rewritten or removed from the plan side. The store write fires the hook, and the mirror brings the plan back in line,
so both converge on the one record. `AXF_PLANS_WRITEBACK=off` turns it off.

**4. Turn into a build writes the store.** `turnIntoBuild` used to write the orchestrator export file directly; it now
adds the build through `withStore` (projection + absorb), so it is journalled, fires the hook and goes live.

**5. Drift is caught.** `plans.mjs check-builds` (exit 1 + every mismatch) / API op `check-builds`, and a systems
check item *Plan Studio plans match the builds* (red + pushed, auto-fix *Re-mirror the plans* =
`plans.mjs mirror-builds`). `syncBuilds` (the page's live progress on load) is now the mirror.

**6. Backfill.** `plans.mjs mirror-builds` ran on the hub: 176 plans made for open builds, 28 existing ones brought
in line; `check-builds`: every build has its plan, steps in sync. Finished (complete / archived) builds aren't
backfilled; a replay of old hook events never makes plans for them either.

## Commands
- `node apps/console-web/plugins/plan-studio/plans.mjs mirror-builds [<build id>…]`
- `node apps/console-web/plugins/plan-studio/plans.mjs check-builds [--all]`
- API: `POST /api/plugins/plan-studio/api {op: "mirror-builds" | "check-builds"}`

## Tests
- `plan-studio/test.mjs`: 26 → 27 checks (new: build-mirror@1 end to end on a scratch store: new build → plan with the
  same steps, tick + status + re-split reach it, Plan Studio edit → store → back in sync, removed step kept, hand
  drift fails `check-builds`, backfill skips finished builds; turn-into-build now asserts the store). Tests now run on
  a scratch builds store (they used to be able to touch the real one through the orchestrator file).
- `plan-studio/test.py`: 15 → 17 (health probe + auto-fix).
- `build-orchestrator/test.mjs` 33 passed (brief carries `API_RULE`), `build-manager/test.mjs` 129 passed,
  `pipeline.test.mjs` 27 passed.

## Gaps
- No UI change: the plan page already shows build links and progress. A "Mirrored from build" badge could come later.
- The listener runs where the store is written (VPS checkout / console container); a session's own scratch store fires nothing.
