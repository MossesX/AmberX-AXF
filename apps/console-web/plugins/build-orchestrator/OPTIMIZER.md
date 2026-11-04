# Build optimizer (build-optimize@1)

**Optimize builds** takes every waiting step and repacks the steps into the fewest builds. It moves the steps over and combines the builds. Before anything changes, a dialog lists the new package of builds, each one with all of its steps.

It shares its combining code with *Package builds* (build-package@1). The waiting-step candidates, estimates, areas and dependency rules come from `web/packager-core.mjs`, so that logic exists in one place only.

## Where

- **Button:** the Builds toolbars (Build manager, orchestrator, pending, queue; slot `builds.toolbar`). It is also in the Builds menu and on the right-click menu of every build list (`axf-build-item`, `axf-orchestrator-build`, `axf-pending-item`).
- **Voice / actions:** `build-orchestrator.optimize[:auto|deep|basic|<preset>]` and `build-orchestrator.optimize-fable`.
- **MCP / REST** (owner-only on the primary): `optimize` (POST `/optimize/plan`), `optimize-state`, `optimize-apply`, `optimize-undo`, `optimize-move` and `optimize-settings`. For example, "optimize just the Fable work in Main framework" becomes `optimize` with `filter: { models: ['Fable'], profiles: ['main-framework'] }`.
- **Settings:** Settings → Plugins → Build optimizer.
- **CLI:** `node apps/console-web/plugins/build-orchestrator/optimizer.mjs plan | apply | undo | runs | move | settings | preset`.

## Modes

- **Basic** is plain code with no AI and zero tokens. It is always there and it is the fallback.
- **Deep (AI)** is the default whenever an AI connection (`axf.llm@1`) is available. The CLI gathers the evidence (`optimizer.mjs evidence`): every waiting build's brief, Brett's words and addenda, each step's text and files, where those names appear in the code (`git grep`), merged PRs, reports and finished builds. The AI's review covers names, moves, hidden dependencies, duplicate or already-built work, and model, thinking or split notes. That review is checked by code (`applyAi`) before it is shown. Anything that doesn't check out is listed as rejected, and model upgrades remain suggestions only.
- **Auto** runs Deep when AI is there and Basic otherwise. The token estimate is shown before a Deep run. A run over the budget, an AI error, a timeout or an unreadable answer runs Basic instead and says why.

## The plan (Basic)

1. **Scope:** the packager's candidates, which never include the step a running build is on. Pinned builds are left out. Running builds are left out too when *Pull from running builds* is off. The filters then apply: profile, category, model, thinking, agent, status, area, tags, age, Fable candidates, and include / exclude.
2. **Units:** a build's steps form one chain. A build is never split just to fit a cap.
3. **Partitions:** these never share a build: Fable vs Opus (a build that has both stays whole and is marked Mixed), build profile, and urgent vs the rest.
4. **Grouping:** related units merge first, by weighted rules: shared areas (claims), the same app or plugin, the same category, and cross-build dependencies. After that:
   - **Fewest** fills what fits.
   - **Balanced** evens the work out over the slots.
   - **Fastest** keeps unrelated work apart so it can run side by side.
5. **Order:** inside a build, steps follow their source order with dependencies first. Builds are ordered by dependencies, and two builds that claim the same area run one after the other.
6. **Flags:** steps that look like another waiting step or like done work are flagged. With *Untick in the dialog* they start unticked.
7. **Summary:** X builds become Y, emptied builds, and the time and cost saved (build overhead × builds fewer).

A group that holds only one build's own steps stays as it is.

## Apply and undo

**Apply** happens in one store write (`applyOptimize`):

- Each new build gets the steps moved over. Each step keeps its uid, and `origin.how = 'optimized'` links it back to its old build.
- Each new build carries the sources' verbatim words in `origin.said`.
- Emptied builds are archived (or deleted, as the setting says).
- Every source gets a note.
- A run record holds the pre-images of the changed builds.

The exports, the queue and the pending lists follow from the store, and the write goes live to main.

**Undo** (`undoOptimize`) removes the new builds and puts every changed build back. It is refused once work has happened since.

## Drag steps between builds

Any step row on the orchestrator page can be dragged onto any build's step list. That works in the same view, in another tab or pane, in a floating window, or in another console or Molly window, through the shared payload `application/x-axf-build-steps` (`build-steps@1`). To drag several steps at once, shift- or ctrl-click their grips. The drop position sets the order in the target build.

Running steps never move. If a moved step needs steps that would stay behind, a question asks whether to move those prerequisites too. Each move is one store write with one undo (`moveSteps`), and every open window reloads.

## Notifications and schedule

- **Optimizer notifications:** *Only when AI isn't available* (default), *Every run* or *Off*. Each notification is a console alert, a banner chip and a phone push (web push / ntfy).
- **Schedule:** manual, after every new build, or nightly. A scheduled run only makes the plan and notifies. Nothing changes until Brett confirms it.
