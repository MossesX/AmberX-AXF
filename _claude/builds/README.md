# Build tracker (orchestrator@1)

`orchestrator.json` is the build orchestrator's tracker: every build broken into steps of 30 minutes or less, each
pinned to **Fable** or **Opus**. Consecutive same-model steps are a *phase*; a phase that switches model waits for
Brett's approval. It lives in the repo (and syncs with the hub through `claude-sync`) so any session, on any machine
or Claude account, can pick a build up where the last one stopped. <!-- axf-plugin:build-orchestrator -->

## Carry a build on

```bash
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs              # every build, steps, time left, what's next
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next         # the next step (or the approval it waits on)
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief <id>   # paste-ready brief: the current phase only
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step <id> <stepId> [undo]
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act approve <id> <phase>   # only after Brett approves (card)
```

Commit `orchestrator.json` with the work after every step. Console: **Builds → Build orchestrator** (tabs Builds,
Approvals, Rules).

## Token rules (on every build, editable in the Rules tab)

- Stay in **one session**; a step marked *new session* is the only reason to start another.
- **No sub-agents** unless a step is marked *sub-agent ok*.
- A brief carries **only the current phase**; read only the files its steps list.
- Stop at the end of a phase. When the next phase switches model, ask Brett with a card, then `act approve`.

## Which model a step gets

- **Fable:** cross-port contracts, kernel/engine internals, schema + migration design, heavy refactors, anything that
  changes how GUIs work across apps.
- **Opus:** everything else (plugin UI on the framework, servers, routes, tests, docs, wiring, security work).

Order steps to keep switches few: all Fable work of a build first where the dependencies allow, then Opus.
