# agent-swarm — finished and live on main (Oct 31 2026)

**Build:** Breakroom `agent-swarm`, all 19 steps (Opus, headless, one session, no sub-agents). s1–s16 of the old
16-step list were already on the branch; main had re-planned the build to 19 steps (three new ID-card steps), so this
session merged, finished the new steps, fixed main's red CI and pushed to main.
**Branch:** `claude/agent-swarm` (PR #196) → `main`. **Asked:** Brett, "push to main" tonight (Oct 31, 04:12).

## Result in one paragraph

The agent swarm is complete: eight headless specialist agents with one-page skills and Amber's persona, a job planner
with file leases and overlap waves, Boss owning the shared files, a lease check before push, batch merge with a merge
fixer, a cost meter, statuses / suspend / rage-quit / rehire, salaries, crew cards, a group chat with a vibe ceiling,
and now **ID cards as real assets** (`agent-card@1`, four branded starters, a gallery with a default pick, a card
designer and per-agent identity). The Agents and Cost tables are now the framework's sortable, filterable grids. Main's
three red CI checks are fixed. Every local check is green.

## What was wrong, and what changed

| Thing touched | What was wrong | What changed |
| --- | --- | --- |
| Merge with `origin/main` (84 commits) | `THREADS.md` and the Breakroom orchestrator clashed; main had re-planned `agent-swarm` to 19 steps (new s1 card preview, s3 card designer, s4 `agent-card@1`) | THREADS keeps both sides; the orchestrator takes main's 19-step list and carries over the 16 steps already done (matched by step text, renumbered) |
| CI · Build engine sweep: plugin lifecycle | Brief named `plan-studio/web/voice.ts:56` (`'agent-voice'`) as a stale reference | Already fixed on main (the label moved behind the mic-lease registry). Clean run of every lifecycle plugin: 0 failures |
| CI · Build engine sweep: `tracker.mjs --check`, `plugins.mjs --check` | `framework/plan/profiles.json` now has `active: refactor` (set today 12:18), so the sweep read the Refactor profile, which has no `status.json`: 391 items with no status, plugin plan items "not in the plan". Also red on main | The engine job pins `AXF_BUILD_PROFILE: main-framework`, as the console job's self-tests already did (`.github/workflows/android.yml`) |
| CI · Web Dev Console build | `plan-studio/web/voice.ts:58` failed `tsc`: `who[0]` is possibly undefined (`noUncheckedIndexedAccess`) | `who.charAt(0)` |
| CI · Web Dev Console: plugin pure-part self-tests | `output-recorder/test.mts` failed on Node 22: `web/store.ts` imported `./core` with no extension, which Node's type stripping can't resolve | `store.ts` imports `./core.ts`; console `tsconfig.json` gets `allowImportingTsExtensions` (it already had `noEmit`, so the setting is allowed) |
| CI · menu-reach | The agent-swarm plugin had a page but no `web/menu.ts`, and its nav entry wasn't in the app menu | `web/menu.ts`: Builds ▸ Agent swarm, Plugins ▸ Agent swarm settings |
| CI · check-theme (scale rule from main) | 28 sizes in `swarm.css` were plain `calc(var(--fx-space) * n)` / font-size multiples | Moved onto the scale tokens (`--fx-dens-gap-*`, `--fx-type-scale-*`) |
| CI · check-controls | 5 bare `<button>`s (table sort headers, card open, feed link) | Sort headers are now the DataGrid's own framework headers; the card is a `data-fx-row` row; the feed link is `fx-btn` |
| Agent manager UI (Agents + Cost tabs) | Hand-made tables, sort only, no filter | Framework `DataGrid`: every column sortable (cycles up / down / off), column menu (hide / show), plus a text filter (name, role, specialty, note) and a status filter on Agents. Sort, filter and hidden columns are kept per device |
| s1 · card preview page | Not built | **ID cards** tab: every design (framework starters + saved ones) drawn with a real agent in the current theme; pick which agent to show |
| s4 · `agent-card@1` asset type | Not built | One rules file `framework/core/engines/agent-card-rules.mjs` (+ `.d.mts`) drives both validators (`core/validate.ts`, `cli/build-engine.mjs`), the schema, `normalizeCard`, `cardModel`, `employeeId`, `internalEmail` and the barcode bars. Registered in `asset-types.json` (before `uac-policy`), `types.ts` (optional, late-optional), `defaults.json` (`corporate-badge`), a shared appearance slot (axHub carries it to every app), never rolled. Starters: **corporate badge** (vertical, logo banner, barcode), **license** (horizontal, hologram watermark, "Issued" = hire date), **trading card** (big photo, foil border, stats on the back), **backstage pass** (dark, neon, big status). Web renderer `framework/react/components/AgentCard.tsx` + `.fx-idcard` in `axf.css`, tokens only (a theme swap rebrands every card), flip for the back. Fixture `spec/fixtures/agent-card.json`, check `spec/check-agent-card.mts` (61 checks, in CI). Apps re-baked (Patches skipped, paused) |
| s3 · card designer + default + per-agent | Not built | Designer: every enum (design, orientation, logo place, background, accent, finish, photo, code strip), fields per side with order and labels, live preview, **Save as new** (stored as an asset@1 envelope in the swarm state; never overwrites an existing id). **Make default** in the gallery; each profile has **ID card**: per-agent design and editable identity (name, role, specialty, photo link, employee ID, internal email, hire date, catchphrase, signature). Crew cards and profiles show the edited identity |
| Plugin tests | — | `test.mjs`: 66 checks (+1 for identity, per-agent design, default, save as new, remove, bad date / photo link refused) |
| Docs | — | `install_steps.md` Part I "How to set up the agent swarm" (hire agents, statuses, salaries, the chat switch, ID cards); plugin README "ID cards"; `PORTING.md` entry for `agent-card@1` |

## Checks (all green, run on a clean checkout of the pushed commit)

- **Engine sweep** (Node 22): validate --framework (465 assets), tracker, plugins, project manifests, fixtures, plugin
  catalog, axf-server, build steps, profiles, feature matrix, orchestrator sync, github, libraries, check-theme,
  check-controls, check-plugin-pages, session-checkin, project-wizard, deploy helpers, add-ons, **plugin lifecycle (every
  plugin)**, every template + boilerplate init, next-ts + web-fastapi-wall builds.
- **Console job:** console re-bake + build, axhub-web / amberx-droid / walkthrough-studio builds, **theme-swap** (every
  colour, transparency and size follows) + interface-scope-check, the whole web test block (Node parts on Node 22,
  Python parts in the console image), every plugin `test.mts` and `test.py`, library templates, Python API + MCP smoke.
- Not run here: shellcheck (not installed; `bash -n` passed) and the Android / Kotlin jobs (GitHub Actions compiles them).

## Decisions and known gaps

- **Fable steps built on Opus.** s1–s6, s14, s15, s18 are Fable-pinned; Brett's go-live brief said build on Opus. The
  parked rebuild `agent-swarm-fable-rebuild` now has a note listing every one (including the new `agent-card@1` contract).
- **Default card design:** `corporate-badge`. s1 says Brett picks from the preview first; this was a headless run, so
  he picks in **Agent swarm → ID cards → Make default** (one tap, posted in the chat).
- **QR code:** the `qr` strip shows the agent's page link as text. A real QR encoder isn't built (there's no QR library
  in the repo and no way to check one here).
- **Android renderer deferred** (Android on hold): Kotlin `AgentCardRules` + Compose `AgentCard` replaying
  `agent-card.json` are recorded in `PORTING.md`. The Kotlin validator reads the spec and accepts the new type.
- **No screenshots:** `rebuild-shots.mjs` needs the console API (uvicorn) on the host, and this VPS shell has no Python
  web stack. Worth a UI Review pass of the ID cards tab once the console redeploys.
- The orchestrator change went to the repo copy (`AXF_DATA_DIR=off`); the hub copy of the Breakroom orchestrator is
  held by claude-sync (changed on both sides), so Brett picks which copy to keep with `claude-sync resolve`.
