# clash-fix-console-app-tabs-2 (Clash fix + console app tabs, Nov 25 2026)

Build "Clash fix + console app tabs". Model: Fable. Branch `claude/clash-fix-console-app-tabs-2`, one PR for both
parts. Brett: "Send the clash fix and the tabs as one build; the VPS splits it when it starts."

It takes the place of three archived builds: `clashes-never-block-pull-main-fix`,
`clash-answer-run-all-defer-buttons-plus` and `console-app-tabs-small`.

## Part A: clashes never block

Before: a build that touched files another build had not landed yet was "Rejected (clash)". It sat at Split until a
person answered run-all or defer, Queue refused it with "answer it first", and there was no button or command to
answer with (the server's action list left the two answers out). A step whose main pull conflicted failed and retried
until it gave up.

Now:

| Where | Change |
| --- | --- |
| `framework/core/build-clash.mjs` | `autoAnswer` (the pipeline answers `run-all` itself, `auto: true`, answeredBy `pipeline`, the reason says "Clash:" not "Rejected:"), `canAnswer`, and a hand answer that replaces the pipeline's own; a person's answer stands |
| `build-orchestrator/pipeline2.mjs` intake | the clash goes on the record already answered; the build takes its turn like any other. `nextToActivate` no longer skips it, the "answer it first" refusal on `queue` is gone |
| `pipeline2.mjs` `answerOldClashes` | every record left unanswered by the old gate is answered on the next pass, so the builds stuck that way (`landing-frees-slot-autoqueue`, `watchdog-catches-lander-prs-stuck-ci` and the others) move on by themselves once this lands |
| `pipeline2.mjs` `cutWorktree` / `pullMain` | a main pull that conflicts no longer fails the step: the merge stays open in the worktree, the files go on the step (`clashFix`), and the step's own session resolves them first (a "First: the clash with main" section in its brief: resolve, run the checks, commit, then build the step) |
| `pipeline2.mjs` `actBuild` | `run-all` / `defer` are answers by hand. `defer` holds back only steps that have not started; `run-all` also undoes a defer |
| `framework/core/pipeline-status.mjs` | the view shows an ordinary waiting build with the clash line ("It carries on by itself…"), `clash: { rejected: false, reason, answer, auto, canAnswer }`; `waitsFor`, `alsoWaitsFor`, `clashFix` are step fields of the contract. Schema and fixture updated |
| Lander | unchanged: a PR that conflicts with main already gets a fix session (`clash-main`), and steps that conflict with each other already split (`clash-steps`) |

### Answering by hand

| Way in | Call |
| --- | --- |
| Console | Build orchestrator → a build's row → the clash line with **Run all** / **Defer** (`ClashRow` in `web/StatusTable.tsx`); Plan Studio 2.0's build panel has the same two buttons |
| REST | `POST /api/plugins/build-orchestrator/pipeline/clash-answer { id, answer: run-all \| defer, why? }`; read: `GET …/pipeline/clashes`; `pipeline/act` takes the two answers too |
| MCP / voice | plugin commands `pipeline-clash-answer` and `pipeline-clashes` (voice lines in their descriptions: "run all on the landing build", "which builds clash") |
| CLI | `node apps/console-web/plugins/build-orchestrator/pipeline2.mjs act <build> run-all\|defer`, `… clashes [--json]` |
| Deep link | the build's row in the orchestrator (`row:<build>`), buttons `clash-run-all-<build>` / `clash-defer-<build>` |

## Part B: console app tabs

A small strip under the page in the console app (`apps/console-droid`): **+** opens a new tab on the start screen,
tapping a tab switches to it, **x** closes it. Each tab is its own console WebView, so it keeps its own screen and
scroll.

| Where | Change |
| --- | --- |
| `TabRules.java` (pure) | the list and every rule: open (at most 8), switch, close; closing the tab on screen shows its neighbour, closing the last leaves one fresh tab; labels (the screen's name), deep links, the strip's safe-area padding, the state JSON |
| `TabStrip.java` | the native strip: colours and sizes from the console's tokens (`ShellTheme`), scrolls sideways when full, + stays at the end |
| `WebHost.java` | one WebView per tab; what moves between the app and the expanded overlay is the page on screen plus the strip. The bridge, safe area, deep links, back and content update follow the tab on screen |
| `Insets.java` | the strip keeps clear of the navigation bar and keyboard; the page above it gets `--fx-safe-bottom: 0` |
| `NativeBridge.java` | `tabs(verb, arg)`, feature `tabs`, a `tabs` event to the page after every change |
| Console `src/native/` | action `native.tabs:<state\|new\|switch\|close>[:<id or link>]`, tabs in `native.state`, help entry |

How each is reached: the console action `native.tabs` (so REST and MCP `console_control`, the CLI `axf console`, and
voice, all the same), the bridge `window.axfNativeHost.tabs`, and the deep links `axf-console://tab/new` and
`axf-console://tab/<id>`. Table in `apps/console-droid/README.md`.

Placement: the strip is at the bottom because the expanded overlay docks the floating toolbar top-left; attached
things never overlap.

## Tests

- `test/p2-sync.test.mjs` 79/79 (the clash section rewritten: never held, Queue never refused, hand answers, an old record answered by the pipeline)
- `test/p2-clash.test.mjs` 15/15, new, in CI: real git, a conflicting main pull stays open and is named, the brief puts the fix first, a resolved merge pulls clean
- `p2-actions` 33, `p2-flow` 56, `p2-parallel` 24, `p2-triage` 45, `p2-status-contract` 53, `emergency` 42, `land-clash` 6, `test-pipeline-sync` 105
- `framework/spec/check-pipeline-status.mjs` 273 (fixture regenerated), `check-pipeline-2` 96, `check-done-means-merged` 417
- Plan Studio `live.test.mjs`, `nativeRules.test.mjs`, `status-table.test.mjs` pass; plugin Python tests pass (89 + 26)
- Console `tsc --noEmit` clean; `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `check-console-control`, `axf validate --framework` pass
- Console app: there is no Java toolchain on the VPS, so the whole app and its tests were compiled with a JDK 17 container against Android 14 classes: no errors. JUnit: 92 run, 90 pass, every `TabRulesTest` among them; the 2 that fail are `PhoneConnectRulesTest` cases that read repo files by relative path and only failed because of where this run started. CI's Gradle job is the real build.

## Not done

- **Not run on a phone.** The tab strip compiles and its rules are tested, but nobody has seen it on a device: layout, the keyboard pushing the strip up, and switching tabs inside the expanded overlay are unverified until the APK from CI is installed.
- **No screenshots, no UI Review options.** The clash row and the tab strip have no pictures and no three look options (no console or phone to capture from in this session).
- **`versionName` stays 0.2.0.** The console pins that line in a test; the shell says it has tabs through the `tabs` feature instead.
- **Background tabs get the safe area when shown**, not while hidden. A rotation while a tab is hidden reaches it on the next switch.
- **Kotlin twin** of the build-clash / pipeline-status change: deferred, recorded in `framework/spec/PORTING.md`.
- **Feature status** (`framework/catalog/status.json`) not touched.

## Related queue items

- `landing-auto-resolves-generated-files-no` (Pending, Fable): the lander's generated-file conflicts. Separate code (`deploy/lander`), not built here; no overlap with this change.
- `one-build-time-always-split-to-fill` (Pending, Fable): touches the same pipeline file. It will see this change as a clash record and carry on.
