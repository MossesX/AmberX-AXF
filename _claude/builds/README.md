# Build tracker (orchestrator@1)

`orchestrator.json` is the build orchestrator's tracker: every build broken into steps of 30 minutes or less, each
pinned to **Fable** or **Opus**. Consecutive same-model steps are a *phase*; a phase that switches model waits for
Brett's approval. It lives in the repo (and syncs with the hub through `claude-sync`) so any session, on any machine
or Claude account, can pick a build up where the last one stopped. <!-- axf-plugin:build-orchestrator -->

## Levels

Build → **category** (`category`) → **phases** (step `phase` label; a new phase starts where the label or the model changes) → **groups** (step `group` label, consecutive steps) → **steps**. Only a model change between phases needs Brett's approval. In the console, Builds shows a Grid (one row per build, sortable, expands to the card) or a List, filtered by category. <!-- axf-plugin:build-orchestrator -->

## One builds store (builds@1, since Oct 31 2026)

Every build of every profile is ONE record in `_claude/builds/store.json`, owned by the orchestrator (core
`framework/plan/builds-store-core.mjs`, IO `framework/cli/builds-store.mjs`). A build's profiles are a field
(`profiles: [...]`, `order` per profile); Pending is a status; the build queue is the order of plan-epic builds. Every
step is its own record (`uid` never changes; `title` = rename). Every write is versioned: store `rev`, record `rev`,
and a journal line in `_claude/builds/journal/<YYYY-MM>.jsonl` (each changed build before and after; moving to the
hub data store, see *The journal leaves git* below).
`orchestrator.mjs`, `pending.mjs`, `build-queue.mjs`, the console, the MCP tools and the Builds page read and write
projections of it. The per-profile `orchestrator.json` files and `framework/plan/**/{pending,build-queue}.json` are
read-only exports regenerated after every write; a direct write by an old-style session is taken in newer-only.

```bash
node framework/cli/builds-store.mjs                     # rev, builds and % per profile
node framework/cli/builds-store.mjs verify              # every build, step, note and status of the old files is in the store
node framework/cli/builds-store.mjs history <id>        # every journal revision of a build
node framework/cli/builds-store.mjs restore <id> <rev>  # put it back as it was (itself versioned)
node framework/cli/builds-store.mjs demo <id>           # demo-build@1: is it a demo (throwaway) build? exit 1 if not
```

**Demo builds (demo-build@1, since Nov 17 2026, build `guided-live-demo-test-watch-orchestrator`):** the guided live
demo plays on throwaway builds whose id starts with `demo-`; the store tags them `demo: true` on read (no migration:
older records load unchanged, a `demo-` id gets the tag, nothing else ever does). Every projection, the dispatcher, the
auto-lander, alerts, builds-live commit lines and the console rows mark them demo-only, and a demo action (a write with
`demo: true` in its meta, `set-status … --demo`) on any build without the tag is refused whole. Spec:
`framework/spec/BUILDS.md` → Demo builds; core `framework/core/demo-build.mjs`.

The Builds page (console and AmberX: Builds → Builds) shows it: Builds and Steps views, rename, drag to reorder,
divide, harvest / split into N, Restore default, a draft until Apply, live progress bars. <!-- axf-plugin:builds-page -->

## The journal leaves git (builds-journal@1, designed Nov 17 2026)

Build `stop-auto-lander-committing-tracking`, step s1 (Fable): the design and migration contract. Steps s8–s10 of the
same build implement it; until they land, the journal is still the repo folder described above. Contract text:
`framework/spec/BUILDS.md` → *Journal home*.

**Why.** The journal is 911 MiB in 13 parts (`2026-11.jsonl`, `-p2` … `-p12`), all committed. Every live status commit
rewrote an 80 MiB part, every clone and worktree carries the lot, the auto-lander kept committing the parts into build
branches, and a PR's checks pulled 70 MiB files it never read. The journal is history data, not code: it belongs on the
hub data store with the rest of the shared data (`persist.mjs`), and the repo keeps only a pointer and checksums.

**Where it lives.** One home: `<data root>/builds/journal/<YYYY-MM>[-pN].jsonl`, i.e. `/projects/amberx-axf/_data/builds/journal/`
where `/projects` is mounted (VPS sessions, worktrees, `/opt/axf`, the console container). Same file names, same 80 MiB
parts (`journalPart`), same one-line-per-write format, append-only. Every writer appends under one lock shared across
checkouts (`<journal dir>/.lock`, same `lock()` helper as the store, 30 s stale), so two worktrees never interleave a
line. New files take the folder's owner and mode (`deploy`, 0664, like `writeKeepingOwner`), never root-only.

**What the repo keeps.** `_claude/builds/journal.json` (builds-journal@1), committed, next to the store:

```
{ $axf: 'builds-journal@1', home: 'hub', dir: 'builds/journal', updatedAt, storeRev,
  parts: { '2026-11-p3': { bytes, lines, sha256, sealed: true, firstAt, lastAt },
           '2026-11-p12': { bytes, lines, sha256, sealed: false, firstAt, lastAt } } }
```

A **sealed** part is full (`journalPart` moved on): its entry is final and its checksum is exact forever. The **open**
part's entry is a floor: the hub file must be at least that long and its first `bytes` bytes must hash to `sha256`
(append-only makes a prefix hash sound). The live publisher refreshes the pointer in the same status-only commit as the
store (hashing only a part whose size changed); it merges newer-wins per part through the `axf-builds` driver (higher
`lastAt` wins, keys unioned), is in `BUILDS_PATHS` and in the lander's tracking-paths list (s2), and is the only
journal file main ever carries. No journal line goes to main again.

**Reads.** `journalDir()` resolves the home in this order: `AXF_BUILDS_STORE` set → `<store>.journal/` (tests,
unchanged); `AXF_BUILDS_JOURNAL=<dir>` → that folder; `persistRoot()` non-null (hub mounted, or `AXF_DATA_DIR` scratch)
→ `<root>/builds/journal`; otherwise the local **spool** `_claude/builds/journal/` (git-ignored). `history <id>` and
`restore <id> <rev>` read the home (newest part first) plus any spool lines not yet drained; when the home is the spool
they say so (`journal home not reachable: N local line(s) only`) and `restore` refuses a revision it cannot see.
`verify` adds the journal: every part in the pointer exists on the hub, sealed parts hash exactly, the open part meets
its floor, and every line of the spool is on the hub. Home not mounted = `verify` reports `journal: not checked (hub
not mounted)` as a warning, not a failure; CI (s10) runs the checks on a fixture journal under `AXF_BUILDS_STORE`.
`build-hooks.mjs journalEvents()` defaults to `journalDir()` instead of the repo path.

**Writes without the hub.** A checkout without `/projects` (laptop, claude.ai, CI) appends to the spool. The live flush
drains it: `POST /journal/append` on the build-orchestrator plugin (plugin-commands@1, so REST, MCP `journal-append`,
`axf build-orchestrator journal-append`, voice), which appends on the hub under the same lock and returns the part it
landed in; lines stay in the spool until the hub (direct or API) took them, then the spool file is truncated. No hub and
no console = the lines wait, exactly like the live outbox; `builds-live.mjs status` shows `journal spool: N line(s)`
and the systems check item *Builds reach main live* turns amber after 15 min. The API also offers `GET /journal/history/{id}`,
`GET /journal/verify` and `POST /journal/restore` so history and restore work from the console, MCP, CLI and voice
without a checkout. Nothing a build writes in a worktree is ever staged on its branch (s4/s5 cover the store; the spool
is git-ignored).

**Migration (s9, `builds-store.mjs journal migrate [--apply]`), once, on the VPS.**
1. For each repo part: union (`mergeJournalText`, line set) of the repo copy, the hub `_data` copy if any, and the stale
   claude-sync copy under `/projects/amberx-axf/_claude/builds/journal/` (325 MiB, partial), written to the home.
2. Seal every part that is full or belongs to a past month; hash each; write `journal.json`; `verify` must pass.
3. `git rm --cached _claude/builds/journal/*.jsonl`, `_claude/builds/journal/` into `.gitignore`, the
   `journal/*.jsonl merge=axf-builds` line out of `.gitattributes`, `journal.json` in; one commit on the branch.
4. Prune the stale `_claude/builds/journal` copy on the hub (a hub delete: veto call through axHub with a reason) and
   make sure claude-sync never carries the spool there again.
5. Dry run first (`--dry` prints parts, line counts, bytes and which copy contributed what); the apply refuses to run
   while the pointer already says `home: 'hub'`.

**Not in this build.** Git history still holds the 911 MiB in old commits; a history rewrite needs a force push and a
re-clone of every checkout and worktree, so it is Brett's call (Pending item `shrink-git-history-drop-old-builds`). A per-build index for fast
`history` (today a full scan of every part) is a deferred gap noted in the spec.

## What Brett said (build-origin@1, since Nov 3 2026)

Every build record may carry `origin` (`framework/core/build-origin.mjs`): `said` (Brett's words, verbatim), `at`,
`source` (voice / chat / console / code), `session`, `link`, `by` (who launched it), `brief` (the full brief text),
`verbatim` (false = backfilled from older text, "may be paraphrased"), `from` (brief / detail / notes when backfilled)
and `addenda` [{said, at, source, by}]. Briefs carry it in a `## Brett said (verbatim)` block (template:
`BRIEF-TEMPLATE.md`); `deploy/claude-headless.sh` records it through `framework/cli/build-origin.mjs capture`.
His words are never replaced: a different verbatim quote is refused (add an addendum); backfilled words give way to
real ones. Every merge unions it (`mergeOrigin`: store writes, the live publish, the git merge driver), and
`origins.json` next to the store keeps a copy keyed by build id that older code never touches, so a write from a
session on code from before build-origin@1 can't drop it: the next read heals the records. Commands:
`build-origin.mjs get <id> | set <id> --said … | addendum <id> --said … | missing | backfill [--apply] | block`, and
the build-orchestrator plugin's `GET /origin/{id}`, `POST /origin/{id}`, `POST /origin/{id}/addendum` (REST, MCP and
`axf build-orchestrator …` through plugin-commands@1). <!-- axf-plugin:build-orchestrator -->

## Live on main (since Nov 3 2026; one snapshot per landing since Nov 21 2026)

The store is the live copy: the console, the banners and every session read it, and a write shows there at once. Main
only holds a **projection** of it for history. Until Nov 21 2026 every store write was pushed to main as its own
status-only commit; that put 896 `Builds live: … [skip ci]` commits on main in 24 hours (audit finding B4-06), so main
moved about every 90 seconds and every PR was always behind it. Now (`framework/cli/builds-live.mjs`):

- every store write that changes a build is **queued** in the outbox next to the store: no commit, no push. With a file
  store the console's checkout (`/opt/axf`) takes the changed builds at once as a file copy; on the tables it has them;
- the outbox goes to main as **one** status-only commit (`Builds live: … [skip ci]`) when a build in it reaches
  `landed`, when it has held changes for a day (the daily snapshot, `AXF_BUILDS_LIVE_SNAPSHOT_HOURS`, default 24) or
  when it has grown past `AXF_BUILDS_LIVE_OUTBOX_MAX_MB` (default 16); `builds-live.mjs flush` or `sync --now` publish
  on demand. `sync` without `--now` (session start, the reconciler) only takes main's newer builds;
- a publish is what it was: fetched main + this checkout's changed builds, merged per build and per step **newer wins**
  (`framework/plan/builds-merge-core.mjs`), journal lines appended, one line per change in THREADS.md's **Live build
  log**, orchestrator exports regenerated, pushed (rebase-retry when main moved, never forced). Main's newer builds then
  come back into the checkout and into the console's checkout;
- `AXF_BUILDS_LIVE_PUSH=every` restores a push per write (the checks use it; not for production).

Code still goes through the branch and its PR. The console's auto-update skips the rebuild when only `_claude/` changed.

- **Status:** `built` = every step done, the build's PR not merged yet ("Built · awaiting merge"); `complete` once the
  PR merged (`mergedAt`) or when the build has no PR.
- **Reconciler** (`framework/cli/builds-reconcile.mjs`): open and merged PRs and `claude/*` branches matched to builds
  (branch/PR field, branch name = build id or id-prefixed, PR title/body/commits naming the build's steps as done);
  fills blank branch/PR, ticks steps a PR names (step note = the PR), records merges, lists orphans. Runs at session
  start (`.claude/settings.json` hook), every 10 min on the VPS (cron `axf-builds-reconcile`), and by hand.
- **Merging a branch:** the builds files merge newer-wins through the `axf-builds` git driver (`.gitattributes`,
  registered per clone by `builds-live.mjs install`); a PR that conflicts only there: `builds-live.mjs heal <branch>`.
- **Broken:** a publish that can't reach main keeps the outbox and says why (`builds-live.mjs status`: `stuck`, last
  error). Changes waiting for the next landing are normal (`queued`, `due` empty), not a fault.

```bash
node framework/cli/builds-live.mjs sync [--now]         # session start: take main's newer builds (--now: publish first)
node framework/cli/builds-live.mjs status | flush       # outbox, last publish, last error / publish now
node framework/cli/builds-live.mjs link <id> --branch <b> --pr <n> [--merged]
node framework/cli/builds-reconcile.mjs [--apply]       # dry run / write what it is sure of + the report
```

## The pipeline: Pending → Queue → Building (since Nov 8 2026)

Brett: "what I say, send a build to the orchestrator … he sends everything to the pending. And I have to send them from
pending to queue … If he has slots open, he grabs the next build in the queue and starts the headless session."

- Every build gets its id in the store and, when it has no steps, a split by the orchestrator (one Opus call, ≤ 30-min
  steps, Fable only where needed; `apps/console-web/plugins/build-orchestrator/pipeline.mjs intake`). It sits in **Pending**.
- **Pending → Queue** is Brett's move: the Pipeline tab's *Queue*, `pipeline.mjs queue <id>`, the plugin command
  `pipeline-queue` (MCP / voice). *Launch builds without asking* ON (owner-only Claude setting) queues split builds by itself.
- The **dispatcher** (`pipeline.mjs tick`, cron `axf-pipeline` every minute) reads the Claude accounts (which have Fable,
  how many run on each, limits), the agent slots and the Queue, and starts the next build when a slot and an account for
  its next phase's model are free: `deploy/claude-headless.sh --account <acct>` in `/root/axf-builds/<id>`. Status
  `queued` → `running` (**Building**). It never starts a session right away.
- A session end moves the build on (`nextStatusOnExit()` in build-pipeline@1): every step done = built / complete. Its
  **phase done with steps left = back to the Queue at its place** (reason `phase-done`, journalled "phase <n> done,
  requeued for <model>"), and the next phase **launches by itself**: `claude-headless.sh` reports the exit
  (`pipeline.mjs exit <id> --kind phase-done|crash|stopped --phase <p>`, under the cron's lock) and that runs one
  dispatcher tick at once, no wait for the cron. A crash = the Queue again until 3 crashes, then Pending (Errors tab).
  **Pending only when Brett is needed**: the crash limit, an upgrade he has not approved (while that setting is on), the
  session said it needs him, or it stopped mid-phase. Builds the old rule parked in Pending after a finished phase:
  `pipeline.mjs requeue-stuck [--apply]` (also every `builds-reconcile.mjs --apply`, REST `POST /pipeline/requeue-stuck`,
  MCP / voice `pipeline-requeue-stuck`). Nothing running while the Queue has work = one phone alert (`pipeline.idle`).
- Contract: `framework/core/build-pipeline.mjs` (build-pipeline@1, the `pipeline` record on a build). Rules:
  `apps/console-web/plugins/build-orchestrator/pipeline-core.mjs`. Report: `reports/pipeline-rebuild.md`.

## When a build gets stuck: the watchdog recovers it (since Nov 17 2026)

Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking …
Never wait for Brett to notice."

- Every run's end is evidence: `claude-headless.sh` writes exit code, signal, exit kind, a usage / login stop, account
  and time onto the build (`pipeline.runEnd`, `builds-live.mjs run-end`, live) and into `<slots dir>/runs/<build>.json`
  the moment claude exits, even when it was killed.
- The **watchdog** (`apps/console-web/plugins/build-orchestrator/watchdog.mjs`, cron `axf-watchdog` every minute) probes
  every build marked running (`agent-slots.mjs alive <build>`: claude pid, tmux, heartbeat) and decides by build-watchdog@1
  (`framework/core/build-watchdog.mjs`). Killed 143, OOM 137, failed 1, tmux or claude gone, a stale heartbeat (hung:
  killed first) = **retry**: the step reset, the slot, worker claim and build lock freed, back in the Queue at its place.
  A usage limit or dead login = retry on the **next worker account**. A missed clean end = the normal exit transition.
- **At most Max retries (3)** since the build last ticked a step; then **Pending**, Errors tab, a systems check banner item
  with **Requeue**, and an alert. Brett's requeue starts the count again. A live or just-started build is never touched.
- Every fix is a `recoveries[]` record on the build (watchdog-recovery@1: when, step, cause, exit, action, attempt,
  account, notified; journal action `watchdog-recover`) and a phone FYI (`watchdog.fix`, batched per pass), then the
  dispatcher ticks while slots are free and the Queue has work (idle slots with Queue work = an `idle-slots` fix).
- See it: Build orchestrator → **Watchdog** (and each build's Recoveries); settings in Settings → Plugins → Build
  orchestrator → Watchdog; `axf watchdog status|scan|run`, REST `watchdog/*`, MCP `watchdog-*`, voice `watchdog.run`.
  The systems check's **Build watchdog** item goes red when no pass ran for 3 minutes (Auto fix reinstalls the cron).
- A session never recovers builds by hand: the watchdog does it, under its locks, with the record.

## Own Claude login per build (since Nov 5 2026)

Every headless build runs on its own copy of a Claude login (`deploy/claude-login.mjs`, build `build-own-login`):
`deploy/claude-headless.sh` (and the agent swarm runner) snapshot the active saved account (`~/.claude-accounts`, or the
live login) into `<build folder>/.axf-claude/<session>/` (0700, git-ignored) and run `claude` with `CLAUDE_CONFIG_DIR`
pointed at it; an inherited `CLAUDE_CODE_OAUTH_TOKEN` is dropped unless the account has a saved token. Logging the VPS
out, switching or adding accounts never touches a running build; its token refreshes stay in its copy, which is deleted
when the session ends. Pick an account per launch with `--account <name>` (or `AXF_CLAUDE_ACCOUNT`); the log's
`# login …` line, the tmux tag `@axf_login` (Terminal `login` field) and a note on the build say which one it ran on.
`AXF_OWN_LOGIN=off` = the shared login. Test: `node deploy/claude-login.test.mjs`. Report: `reports/build-own-login.md`.

## Build profiles

Each build profile (build-profiles@1, `framework/cli/profiles.mjs`) is a field on the builds in the store. The
registry is `framework/plan/profiles.json`; `orchestrator.mjs` works on the active profile's builds; check it with
`node framework/cli/profiles.mjs current` (or run one command on another profile with `AXF_BUILD_PROFILE=<id>`).
Console: banner chip / **Build profiles** dialog.

**One profile for the work (Nov 7 2026, Brett: "combine every build profile into ONE new profile on main and delete the
others"):** `current`, `urgent`, `angel`, `big-dog`, `breakroom` and `refactor` were merged into **`all`** (229 builds,
`node framework/cli/profiles.mjs merge-all`, safe to re-run). Every build kept its id, status, steps and step states and
gained `fromProfile` (its old profile); Urgent's builds got `priority: 'P0'`, so urgency is a per-build priority tag, never
a profile. The base `main-framework` stays. A retired id anywhere (`AXF_BUILD_PROFILE=urgent`, an old brief, a Plan Studio
plan's build link, the hub registry until its next save, a live merge from older code) reads as `all`
(`resolveProfile` / `RETIRED_PROFILES` in `framework/plan/builds-store-core.mjs`, mirrored in
`apps/console-web/server/build_profiles.py`); creating a profile with a retired id is refused.

**`main-framework` folded in too; `all` is the base (Nov 7 2026, Brett approved, build `profiles-all-finish`):** the old
base's 189 builds joined `all` (175 moved with `fromProfile: main-framework`, 14 were in both already), so the store has
one profile. `all` is now `BASE_PROFILE` and keeps the original paths (`_claude/builds/orchestrator.json`,
`framework/plan/{pending,build-queue,plan}.json`, `framework/catalog/status.json`, `_claude/builds/matrices.json`) and
the framework's catalog; `main-framework` is a retired id that reads as `all`. The old profile folders
(`_claude/builds/profiles/*`, `framework/plan/profiles/*`) are gone from the repo and the hub, and nothing writes them
again: exports cover registered profiles only, the builds-live publisher takes any profile export left on main off it
(`staleProfileExports`), the batch resolver (`/opt/axf-batch/resolve.py`) drops retired-profile files from a merge, the
manifest no longer syncs `framework/plan/profiles/`, and `profiles.mjs merge-all` prunes any leftover folder (repo + hub;
run it once after this lands, when the deployed console no longer reads `framework/plan/profiles/all/` on the hub).

## Carry a build on

```bash
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs              # every build, steps, time left, what's next # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next         # the next step (or the approval it waits on) # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief <id>   # paste-ready brief: the current phase only # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step <id> <stepId> [undo] # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs request-upgrade <id> <phase>  # at a model UPGRADE: ask Brett, then stop # axf-plugin:build-orchestrator
node framework/cli/model-gate.mjs audit                                                     # upgrades approved so far, and by whom # axf-plugin:build-orchestrator
```

Every tick goes live to main by itself (see *Live on main*); never trust a branch's or main's export alone: run
`builds-live.mjs sync` (the session-start hook does) before reading. Console: **Builds → Build orchestrator** (tabs Builds,
Approvals, Rules).

## Token rules (on every build, editable in the Rules tab)

- Stay in **one session**; a step marked *new session* is the only reason to start another.
- **No sub-agents** unless a step is marked *sub-agent ok*.
- A brief carries **only the current phase**; read only the files its steps list.
- Stop at the end of a phase. A phase that switches to a **lower** model (Fable → Opus) just goes on (recorded). A phase that switches to a **higher** model (Opus → Fable) is Brett's call only (Nov 3 2026): run `request-upgrade`, tell him, and stop. Never `act approve` an upgrade yourself (it is refused for sessions, agents and headless builds anyway); he approves in the console or on axHub.

## Which model a step gets

- **Fable:** cross-port contracts, kernel/engine internals, schema + migration design, heavy refactors, anything that
  changes how GUIs work across apps.
- **Opus:** everything else (plugin UI on the framework, servers, routes, tests, docs, wiring, security work).

Order steps to keep switches few: all Fable work of a build first where the dependencies allow, then Opus.

## Pending builds

Pending is a status of a build in the store, not a copy: the Pending list is the profile's projection of the store
and a Pending change is absorbed back into it (`framework/cli/pending.mjs`). The orch-sync bridge is retired. <!-- axf-plugin:build-orchestrator -->
