# approval-source — who asked, on every approval (Nov 1 2026, Opus, headless VPS)

Brett: "every approval just says vps.run". Now every held/confirm request says **who** asked (source + name) and
**what** it is (the reason title first, the tool as a small chip). axHub decision 109. Branch `claude/approval-source`
in both repos.

**Number:** built as decision 108; while it ran, AXF main got the AmberX recorder citing axHub decision #108, so this one
is **decision 109** (renumbered in both repos before the push).

## axHub (server)

- Core model: `CallSource` (`kind` claude_ai | claude_code | headless | console | agent | system | unknown,
  `session`, `client`, `clientVersion`, `auth`, `oauthClient`) on `Caller.source` and `Confirmation.source`; zod schema +
  drift check. The hub re-checks it against the schema before storing (`confirmationSource`); callers it makes itself
  (CLI, not `mcp`) are `system`. Stored inside the JSON row: no migration.
- Front door (`packages/server/src/call-source.ts`): `X-Axhub-Session` (strict `^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$`,
  else dropped; `agent:<name>`, `build:<name>`, `console` set the kind) → OAuth sign-in = claude.ai (only
  claude.ai/claude.com may register; the OAuth client name is kept) → clientInfo (`claude-code` + a session name =
  headless, without = interactive Claude Code; console/AXF clients = console; claude.ai clients) → unknown. clientInfo
  is read after `initialize` (`server.getClientVersion()`). The caller's word: shown, never used for access.
- API: `source { kind, label, who, session?, client?, clientVersion?, auth?, oauthClient? }` on every approvals view
  (grid, one request) and the `approvals.json` feed; approvals log gets `source`, `sourceSession`, `sourceClient`;
  veto pushes carry `from` and the held/shelved ntfy line starts "From Headless · approval-source.".
- Docs: decision 109 in `axhub-planning.md`, context, `docs/veto.md` §5, roadmap, CLAUDE.md status.
- Tests: 477 → **487 pass** (Node 22; new `call-source.test.ts`, an end-to-end MCP test with clientInfo + header,
  feed/grid assertions).

## AXF

- **Senders** (`framework/python/axf_server/hub_session.py`): the console's GitHub link and the build manager send
  `console`; agents calling `axhub_call` send `agent:<name>` (context variable around the call, so the GitHub link inside
  an agent's turn says the agent too); headless builds: `deploy/claude-headless.sh` exports `AXF_SESSION` = the `--name`
  slug and, when an axHub token is at hand (env, else the console's env file), adds an `axhub` MCP server
  (`--mcp-config`) whose requests carry `X-Axhub-Session: ${AXF_SESSION}` (the token stays a `${AXHUB_TOKEN}`
  placeholder). **Also fixed:** the launcher never passed `GIT_CONFIG_*` into tmux, so headless builds had no git auth;
  secrets now go through a 0600 file the inner run sources and deletes (not tmux's command line).
- **lib-hub:** `source.ts` (`parseSource`, labels, tones, icons, `sourceText`, `sourceSortKey`); feed entries keep
  `title` + `source` when the hub sends them; `HubSourceBadge`; AmberX's hub view cards (`HubApprovalList`) show the
  title first, then badge · who · tool chip.
- **lib-approvals** (the Waiting for approvals dropdown in every app): `ApprovalItem.source`, held calls keep when they
  were asked, `rowTimes`; each row: title first, then badge · who · tool chip · "3 min ago" · countdown. Re-baked into
  console-web, axhub-web, amberx-droid, walkthrough-studio (Patches paused: skipped).
- **axhub-web:** Approvals is a lib-datagrid grid: Source, Who, What (title + tool chip, title truncates first),
  Requested, Countdown, Decide (Deny / Approve now, held bar). Header sorts, column menu hides, source filter chips are a
  dataset transform; "Waiting on you" / "Earlier" groups; rows expand to what it does, code, who/when, other actions.
  Keyed rows + replies kept per row → updates in place. Request page: `SourceLine` under the title.
- Console banner pending rows: who + title first (minimal touch; menu-approve edits that file too).
- Framework controls (Chip, Button, Icon, DataGrid) and tokens only; theme check green.

## Tests (AXF)

- `check-approvals.mts` 83/83 (+18), `apps/axhub-web/test.mjs` 259/259 (+21), `axf_server/test.py` 398, agent-manager
  176, build-manager 42; axhub-web typecheck clean; theme check green.
- CI block (every non-Gradle step of `android.yml`, run in a scratch copy on the VPS; Gradle needs the Android SDK, CI
  compiles that):
  - **Pass:** framework validate, project manifests + fixtures, plugin catalog, axf-server, build steps, profiles,
    feature matrix, orch-sync, pending/build-queue step checks, lib-github, libraries, **theme check** (after taking the
    `#` out of "decision 109" in comments: the checker read `#109` as a colour), controls, plugin pages, project wizard,
    deploy helpers, add-ons, plugin lifecycle, **console / axhub-web / amberx-droid / walkthrough-studio re-bake +
    build**, **theme swap**, alerts + MCP + axf_server fixtures, library templates, every plugin `test.mts` (Node 22).
  - **Fail on untouched origin/main too (pre-existing, not this build):** `tracker.mjs --check`, `plugins.mjs --check`,
    the Python API smoke (build queue reads the hub's `/projects` data on this VPS), one plugin Python check ("POST
    /session lists running changes…"; same failure list as main).
  - **Environment only:** session check-in (passes in a clean container), template sweep (`shellcheck` missing inside
    it here), AmberX `cap sync` (needs Node 22; the AmberX web build itself passed).

## After merging origin/main (AXF)

- Merged cleanly (agent swarm, recorder). Re-ran: framework validate, manifests, fixtures, plugin catalog, axf-server,
  lib-github, libraries, theme, controls, plugin pages, add-ons, all four app builds, theme swap, alerts/MCP/axf_server
  fixtures (17/17), plugin `test.mts` 11/11 + agent-card 61 (tsx), check-approvals 83, axhub-web 259 + typecheck, Python
  suites. axHub: 487/487 after the renumber.
- **Fixed on the way:** main's recorder commit wrote `#108` in three comments (`output-recorder/web/core.ts`,
  `amberx-droid/.../monitor/web/core.ts`), which the theme check reads as a colour: main's theme step was red. Took the
  `#` out.

## Second merge: menu-approve + flicker landed (Nov 1, ~01:40)

- The application menu's **Waiting for approvals** list (menu-approve, `framework/libs/approvals/menu.ts`) now shows
  who asked too: live menu rows gained two optional fields, `MenuItem.tag` (the source badge, framework Chip with its
  tone) and `MenuItem.chip` (the tool), passed through `core/engines/appmenu.ts` and drawn by `AppMenu` `LiveRow`
  before the second line; that line is now "approval-source · 1 min ago · docker ps". Title stays first, Deny /
  Approve stay on the row. Android twin recorded in PORTING.md (deferred). `check-approvals-menu.mts` 57/57 (+4).
- The flicker fix kept: unchanged rows keep the same object (same JSON), the grid's cells are memoised;
  `scripts/refresh-check.mts` now finds grid rows and loads `.css` imports as empty modules: 15/15 (no "Reading the
  hub" flash, no row remount, countdown ticks only its number).
- Re-run on the merged tree: engine steps, theme, controls, plugin pages, add-ons, lifecycle, all four app builds,
  theme swap, alerts/MCP/axf_server fixtures (incl. axhub-web test 263 + refresh-check), plugin `test.mts` (Node 22):
  green. Same pre-existing tracker/plugins check failures as main.

## Third merge (watch-live, shots-tab)

- `deploy/claude-headless.sh`: watch-live's preview watcher and `--name` pass-through kept together with this build's
  env file and `axhub` MCP config.
- **Fixed main's red AmberX build:** watch-live made the approvals banner (also loaded in AmberX) import
  `@console/watchLive`, which AmberX couldn't resolve (`vite build` failed on untouched main too). AmberX now maps it to
  a local shim (`src/console/watchLive.tsx`, renders nothing: previews need the console token), like
  `@console/pluginLifecycle`. All four app builds pass again.

## Not done / blocked

- **Push (resolved at ~01:30):** for most of the run this VPS had no working GitHub credential. The console's `GITHUB_TOKEN` (helper `axf-git-cred`) and the gh
  token answer 401, and the brief's `GIT_CONFIG_*` never reached this session (the launcher bug above). axHub calls
  from this session aren't permitted, so the hub's GitHub service couldn't push either. The token was fixed around 01:30 (auth
  retried every minute); axHub then landed on main (648b11b) and AXF after the merge below. The dead token is the systems check's existing GitHub item.
- menu-approve hadn't landed by the end of the 40-minute wait (same push problem); it landed later and is merged
  (section above).
- UI Review screenshots not taken (headless, no signed-in hub to render real approvals).
- Pre-existing on main, not this build: `tracker.mjs --check` and `plugins.mjs --check` fail on untouched origin/main
  too (also in a clean node:22 container).
