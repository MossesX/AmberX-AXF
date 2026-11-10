# Priority tags

Brett, Nov 5 2026 (voice): "Put a priority tag on everything in your building. And when you click on it, it shows everything waiting for it."

## What it is

Every build has a priority: **Urgent, High, Normal, Low** (P0-P3, the same levels Plan Studio uses). A small coloured chip shows it on the Build manager, Builds page, Build orchestrator, Build queue, Pending builds, Crew, Codebase changes, Plan Studio's build link, the Home build card, the agent queue and the merge queue. It reads `High · 3 waiting` when things wait on the build.

Tap or right-click the chip: change the level, and see **Waiting on this**. Each row opens and flashes the thing it names; a PR opens on GitHub.

## How it works

- **Stored:** optional `priority` on a build in the store. Unset means worked out on read: Urgent when the id or title says urgent or hotfix, the build is in the Urgent profile, or its brief shouts URGENT / HOTFIX or has a line opening with the word; otherwise Normal. There is no migration write. Rule and waiting-on logic: `framework/core/build-priority.mjs`.
- **Agent queue:** levels are boss, urgent, high, normal, low (`framework/cli/agent-slots.mjs`). The launcher takes the level from the build's tag; `--priority` beats it. Changing a tag moves its waiting entries at once. Same level stays first in, first out. Move up marks the entry `moved`, so a later tag change leaves it where Brett put it.
- **Merge queue:** order is Brett's manual order, then PRs already in the stack, then priority, then the old order. A new priority changes who joins next and never throws away a stack that is testing (that CI is paid for). A manual move still rebuilds it.
- **The host rule:** the merge queue's folder runs with node built-ins only, so it has its own copy of the default rule (`buildPriority` in `merge-queue-core.mjs`); `merge-queue.test.mjs` holds it equal to the core.
- **Waiting on this:** builds behind it in the agent queue (all waiters when it holds a slot), builds that depend on it (plan dependencies), PRs stacked on its branch, PRs behind it in the merge queue, its UI Review items, and linked plans. The console gathers these through capabilities (`axf.agent-slots@1`, `axf.merge-queue@1`, `ui-review@1`, `plans@1`) and hands them to the CLI.

## Use it

```bash
node framework/cli/build-priority.mjs list --open
node framework/cli/build-priority.mjs get skins
node framework/cli/build-priority.mjs set "banner widgets" urgent
```

Run from a shell, the CLI sees only the store, the agent queue and plan dependencies. The full list comes from the console: `GET /priority`, `GET /priority/<build>`, `POST /priority {builds, priority}` on the Build orchestrator's server part, which are also the plugin commands `priority-list`, `priority-get` and `priority-set` for voice and MCP.

Bulk: on the Builds page, select steps and use **Set priority…**; it applies to the builds those steps belong to. `set` and `POST /priority` take many builds.

## Not done

- Steps have no priority of their own; a step follows its build.
- Builds have no stored dependency field, so "depends on it" comes from plan dependencies only.
- Android: recorded as deferred in `framework/spec/PORTING.md`.
