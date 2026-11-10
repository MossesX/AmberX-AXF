# Build manager (retired Nov 10 2026)

The Build manager console plugin was removed on Nov 10 2026 (build `retire-build-manager-the-orchestrator-is-the-onl`,
Brett: "Get rid of build manager. ... The only thing that browses or manages builds is the orchestrator.").
The Build orchestrator (`apps/console-web/plugins/build-orchestrator`) does all of it now:

| Build manager did | Who does it now |
|---|---|
| Remaining list (pending, queue, plan items), needs split, time left | Orchestrator tabs Pending and Queue (split as soon as filed; each Queue card lists its steps, planned model and account) |
| Start build now (`build-manager.start`) | `build-orchestrator.start:<id>` = put it in the Queue; the dispatcher starts it when its turn comes (the only launcher) |
| Live: what is building now | Orchestrator tab Active (account that took it); Crew live for every agent session on every machine |
| Built: finished builds with time and cost | Orchestrator tab Complete (headless run costs on each build in All builds); Shipped features / What's shipped |
| Banner while a build runs | Builds page banner (profile progress, animated while a build runs) |
| Search providers, context menu, app menu | Orchestrator search provider `build-orchestrator.builds`, context menu "Open in Build orchestrator", Builds menu entries |
| Actions `build-manager.open / live / built` | `build-orchestrator.open[:<build or tab>]`, `build-orchestrator.tab:<tab>` |

The screenshots under `_claude/memory/docs/build-manager/` are kept as history.
