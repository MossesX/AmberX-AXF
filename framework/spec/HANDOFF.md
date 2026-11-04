# Session sync — `handoff@1` and `session-link@1`

Brett, Nov 4 2026 (voice): "Is there a way to have two sessions working on the project at the same time without
building stuff that's gonna conflict with the other one?" … "Let's scratch the whole handoff system as we know it and
create one based on spec." … "Make it so that when I type /sync ses or /sync amberx, it will automatically write a file
on the repo that each project can read and jump in." … "Now delete all the old handoff section entirely."

This spec replaces the threads log and the handoff notes (`_claude/THREADS.md`, `_claude/handoff/`, handoff notes,
the Claude handoff plugin). None of those exist any more; `node framework/spec/check-no-threads.mjs` fails CI when
one comes back. Only the two contracts below live in the framework (`framework/core/engines/handoff.mjs`, snapshot
`framework/schemas/handoff.json`, fixture `framework/spec/fixtures/handoff.json`, check `framework/spec/check-handoff.mjs`);
everything else — the console button, the Sessions panel, the join dialog, the helper widget, the `/sync` command,
the CLI, the hook, the REST / MCP / CLI commands — is the **Session sync** plugin (`apps/console-web/plugins/session-sync`,
`plugin@1`, `forFramework: true`), installable in any app and removable completely. Kotlin twin: deferred (PORTING.md).

## 1. Words

| Word | Meaning |
| --- | --- |
| **session** | one Claude session (Claude Code on any machine, a claude.ai chat or voice, a headless build, the console itself) working on one project, identified by `session` (its own id) and `account` (whose Claude account runs it). Every session runs **as a crew agent** (agent-pick@1, `claude_session_start`): its name and avatar come from that agent, never from a bare id. |
| **link** | the one `session-link@1` document per project: who is on, who is primary, the claims, the offers, the assigned work, the event log. The console server owns it; every surface reads and writes it through the plugin's commands. |
| **primary** | the session that ran `/sync` first on the project (Brett's main account) or the one Brett made primary. It **owns the orchestrator**: only it (and Brett) creates, queues, orders, re-models, splits, offers and takes back work. |
| **secondary** (helper) | every other session. It can read everything, talk, **take** what the orchestrator offers, work on what it was given, mark its own steps done or blocked, and accept / reject / hold / release its assignments. Nothing else, enforced server-side. |
| **claim** | a lease on an area (`terminal`, `banner`, `kernel`, …) or on path globs, held by one session with a heartbeat and an expiry. Edits, commits and builds outside a session's claims are refused. |
| **offer** | the orchestrator proposing work to a helper: a whole build, or steps split out of a build (as a child build). |
| **assignment** | an offer the helper accepted: the work now sits on that helper's list (`assignedTo` on the build and its steps), with its claims. A helper has a **work list, never a build profile**: its console shows *Managed by orchestrator*. |
| **sync file** | `_claude/sync/<project>.json` (+ `.md` rendered from it), `handoff@1`: the snapshot `/sync` writes to the repo so any session on any account can read it and jump in. |
| **Sessions channel** | the Breakroom group chat's `sessions` channel (swarm-chat@1 messages with `channel: "sessions"`). There is no second chat. |

## 2. `handoff@1` — the sync file

Written by `/sync <project>` (Claude Code command), `session-sync sync` (CLI), `POST /sync` (REST), MCP
`session-sync_sync`, the console's **Sync session** button, or by voice ("sync AmberX"). Always committed and pushed
on its own status-only commit (`[skip ci]`, the one exception to "every change through a PR", like builds-live).

```json
{
  "$axf": "handoff@1",
  "project": "amberx-axf",
  "writtenAt": "2026-11-04T19:00:00Z",
  "writtenBy": { "session": "s-1", "account": "brett", "agent": "rio", "client": "code" },
  "freshForSec": 1800,
  "link": { "console": "https://console.amberxai.com", "channel": "sessions", "join": "session-sync_join" },
  "primary": { "session": "s-1", "account": "brett", "agent": "rio", "since": "…" },
  "sessions": [ { "id": "s-1", "account": "brett", "agent": "rio", "role": "primary", "status": "working", "doing": { "build": "x", "step": "s3", "note": "…" }, "lastSeenAt": "…" } ],
  "claims": [ { "id": "c-1", "session": "s-1", "kind": "path", "paths": ["framework/core/**"], "build": "x", "expiresAt": "…" } ],
  "work": {
    "running": [ { "id": "x", "title": "…", "steps": [ { "id": "s3", "text": "…", "model": "Fable", "done": false } ], "assignedTo": null } ],
    "queued": [ { "id": "y", "title": "…", "estimate": "2 h", "touches": ["apps/console-web/plugins/foo/**"] } ],
    "offers": [ { "id": "o-1", "build": "y", "steps": null, "mode": "whole", "to": null, "status": "offered" } ],
    "assigned": [ { "id": "a-1", "build": "z", "steps": ["s2", "s3"], "session": "s-2", "status": "working" } ]
  },
  "prs": [ { "number": 321, "title": "…", "branch": "claude/x", "state": "open", "ci": "green" } ],
  "attention": [ { "kind": "ci-red", "ref": "main", "text": "…" } ],
  "decisions": [ { "at": "…", "text": "…" } ],
  "rules": [ "CLAUDE.md", "_claude/shared/rules/RULES.md", "_claude/rules/RULES.md" ],
  "next": [ "…" ]
}
```

- **Fresh** = `writtenAt` is younger than `freshForSec` (default 30 min). A session that joins through a stale file
  refreshes it first (it asks the console for the live link, writes, commits, pushes), then joins.
- The `.md` is a rendering of the `.json` (`renderSync`): the JSON block first (fenced, so `parseSync` reads it back),
  then the sections a human reads on the phone: who is on, what each one is doing, claims, work, PRs, attention, next.
  Nobody edits the `.md` by hand; the `.json` is the record.
- Every project's `CLAUDE.md` carries one line: *On start, if `_claude/sync/` exists, read it* — so a session joins
  even without the command. The plugin's installer adds the line (`<!-- axf-plugin:session-sync -->`).
- Secrets never go in: the writer redacts with session@1's `redact` rules and the check refuses a file with a token.

## 3. `session-link@1` — the live document

One per project, owned by the console server (dataDir `link.json`, every change versioned in `journal.jsonl`,
audit in `audit.jsonl`). Readers: the plugin's `GET /state`, the CLI, MCP, the Sessions panel, the join dialog, the
helper widget, the hook. Writers: the plugin's commands only. Fields:

| Field | What |
| --- | --- |
| `rev`, `updatedAt` | every write bumps `rev` and appends an event |
| `primary` | `{ session, account, agent, since }` or `null` before the first `/sync` |
| `sessions{}` | `id → { id, account, agent, client, role, status, doing, startedAt, lastSeenAt, endedAt, pause, cursor, machine, branch, capacity }` |
| `claims{}` | `id → { id, session, kind: area \| path, area?, paths[], reason, build?, step?, since, expiresAt, heartbeatAt }` |
| `offers{}` | `id → { id, build, steps: null \| [stepId], mode: whole \| steps-new-build, childBuild?, to: session \| account \| null, from, reason, at, expiresAt, status, response? }` |
| `assignments{}` | `id → { id, build, steps, session, account, agent, offer, status, order, since, updatedAt, claims[], backAt?, reason? }` |
| `events[]` | `{ seq, at, type, id?, session?, data }`, bounded (default 2000, newest kept); `seq` never reused |
| `stats{}` | `account → { offers, accepts, rejects, holds, released, stepsDone, msPerStep[] }` (helper reliability) |
| `settings` | `enforce, claimTtlSec, heartbeatSec, idleSec, lunchSec, offlineSec, slotSplit, sendDefault, askOnSend, hideDisconnected, eventLimit` |

### Roles

- **Primary** = `primary.session`. A session of the same **account** as the primary is also primary (Brett's other
  windows). Everyone else is secondary. Brett's own signed-in console click is always allowed (it is Brett, not a session).
- `gate(role, action)` is the one table (§ 7). A refused write answers `{ ok: false, code: "secondary", message:
  "secondary sessions can't do that: <action>" }` (HTTP 403), is audited (`audit.jsonl`: who, action, what) and is
  posted nowhere else (no chat spam for refusals).
- A secondary's reads are **scoped**: `GET /state?for=<session>` and every list (builds, steps, queue, pending, Home
  cards, API / MCP / CLI reads through the plugin) return only its assignments and the offers open to it, plus the
  roster and claims (it must see who holds what).

### Sessions and status

- `join` creates or refreshes a session (`id`, `account`, `agent`, `client`, `machine`, `branch`); the first join on a
  project with no primary makes it primary. A later join from a **new account** needs one owner approval (Brett's
  console click or an axHub approval) before it is `active`; until then it is `pending` and can only read.
- `heartbeat` every `heartbeatSec` (default 60) carries `doing` (`build`, `step`, `note`) and renews that session's
  claims. Status is derived, never stored (`sessionStatus(session, now, settings)`):
  `working` (seen within 2 × heartbeat and `doing.step` set) · `idle` (seen within `idleSec`) · `lunch` (paused on
  purpose with `pause: { reason, until? }`, out of usage, or quiet past `lunchSec`) · `offline` (past `offlineSec`)
  · `ended` (`endedAt` set).
- `end` ends a session: releases its claims, gives its assignments back (status `released`, the orchestrator reacts),
  writes a closing summary line in the Sessions channel and the sync file, and marks it `ended`. Ending the primary
  hands primary to the oldest active session of the same account, else to nobody (`primary: null`, the next `/sync` takes it).

### Claims (no conflicts, enforced)

- A session **must hold a claim** covering a path before it edits, commits or builds there (when `settings.enforce`).
  `claim { kind, area | paths, reason, build?, step?, ttlSec? }` answers the claim, or `409 { code: "claimed", by:
  { session, agent, account }, until }` when another live session's claim overlaps. The caller then waits, asks over
  the channel, or takes another task; nothing is queued silently.
- **Overlap**: two area claims overlap when the area is the same; two path claims overlap when one glob matches the
  other's literal prefix (`a/b/**` overlaps `a/b/c.ts`, `a/**` and `a/b/**`; `a/b/**` does not overlap `a/c/**`);
  an area claim and a path claim overlap when the area's registered paths overlap (§ 8).
- Leases expire (`claimTtlSec`, default 20 min) unless renewed by heartbeat or `claim` again; an expired claim is gone
  on the next read. `release` drops one or all of a session's claims.
- Builds carry `touches` (areas / globs). The orchestrator never runs two builds with overlapping `touches` at once
  (replan, § 6), and a build offered to a helper takes its claims with it.
- The Claude Code hook (`PreToolUse` on Edit / Write / MultiEdit / NotebookEdit) refuses an edit outside the session's
  claims with the holder's name; `session-sync check-commit` (pre-commit and CI) fails a commit that touches files
  outside the committing session's claims. Disabled plugin = no enforcement, and every build runs with a visible
  warning (`enforce: false` → the banner chip and the hook say so).

### The Sessions channel

- Every handover, claim, step start / finish, commit, push, CI result, blocker, question and answer is posted
  automatically (`kind`: `session`, `handover`, `claim`, `report`), with the agent's name, the step, files touched,
  diff summary and links; free-form lines from both sessions and Brett are `session` lines. Filters: all / handovers
  / blockers / my steps.
- Delivery to a Claude session: the hook (`UserPromptSubmit`, `PreToolUse`) injects the unread channel lines and
  claim changes since the session's `cursor`, so a session sees the other's moves within one step, no polling.
- `send { text, kind?, build?, step?, files? }` posts for the calling session (as its agent); `inbox` reads unread
  lines and moves the cursor.

## 4. Handovers (primary → helper)

1. **Offer**: the primary (console: *Send to helper*; CLI / MCP `offer`; voice) offers a whole build (`mode: whole`)
   or selected steps as a new child build (`mode: steps-new-build`: the child build keeps `parent`, the parent's
   steps show `withHelper: <child>`, dependencies copied). `request-work { time?, areas?, model? }` from a helper makes
   the orchestrator pick what to offer (§ 6): whole queued jobs or steps split from builds in progress, balanced by
   areas, model fit and dependency order, with a one-line why in the channel.
2. **Response** (helper, its only job write): `accept` → assignment `queued` (then `working` when its first step
   starts), the claims move, every store that tracks status is updated in one transaction (§ 5), the channel says
   "taken by <agent>"; `reject { reason }`, `hold { reason, backAt? }`, `release` → the orchestrator **reacts**
   (§ 6): take it back, re-offer later, re-split, reassign, or wait (holds). Rejects / holds / releases count in `stats`.
3. **Steps**: the helper marks its own assigned steps `done` or `blocked { reason }`; everything else about the
   build stays the primary's.
4. **Take back** (primary): `take-back { assignment | build, steps? }` — queued work any time; working work only with
   `confirm: true` (the helper is told, stops, WIP stays on its branch). Claims come back, the orchestrator replans,
   the channel posts, undoable (`undo <event seq>` within the journal).
5. **Dedupe**: every job from any account registers with the orchestrator before work starts (`claim-job`). A job
   that matches a queued or pending one (same id, same normalized title, or step / brief similarity ≥ 0.6 — `matchJob`)
   archives the duplicate, links the two, shows "being done by <agent>" and posts in the channel; a pushed branch
   `claude/<name>-acct2` or an unregistered PR counts as the claim with a warning.

## 5. One handover transaction

On every send, accept, reject, hold, release, take-back and step done the plugin updates, under one lock and one
journal entry: the link; the builds store (`assignedTo` on the build and its steps, `touches`, `withHelper`, child
build and `parent`); the orchestrator exports (projections of the store); the agent-slots queue; pending / plan /
tracker exports; the claims; the crew job card (booking on the helper's agent through `axf.crew@1`); the requests
ledger and Codebase changes (one audit line each through their capabilities when present); the model-thinking review
state; the brief / notes in the worktree (`_claude/builds/briefs/<id>.md` addendum line); the git / PR linkage
(`builds-live link`). Then it emits one `handover` event, so every open screen patches at once (§ 9). The consistency
check (`session-sync consistency`, a Systems-check row with Auto fix, CI) verifies all those places agree for every
handed-over build and step and fixes drift from the link (the link wins).

## 6. The orchestrator's smarts (pure, `handoff.mjs`)

- `pickOffers(builds, link, request)` — what to hand a helper that asked: queued builds first (oldest, fitting the
  requested time / areas / model, whose `touches` overlap nothing the primary holds), then steps split out of running
  builds (undone, not running, not depending on an undone step the primary keeps), balanced by areas and model.
- `react(link, change)` — the decision for every helper status change: `reject` → `take-back`; `hold` → `wait`
  (`backAt` or 1 h); `release` → `take-back` then `re-offer` to the next helper if one is free, else back to the
  primary's queue; `blocked` → `take-back` that step, note the reason; `done` → `replan`. One line of why each.
- `replan(builds, link, opts)` — the whole picture on both sides: pinned builds stay (Brett's manual order), a build
  whose `after` or `touches` depends on an undone one goes after it, a build overlapping a helper's live claims waits,
  model / thinking fit groups Fable steps before Opus steps that depend on them, slot capacity (`slotSplit`) caps how
  many run per session; **a running step is never moved**. Answers `{ order, helperOrder, moves: [{ id, from, to,
  why }] }`; `dryRun` previews it (MCP / CLI `replan --dry-run`), the applied one posts the moves ("moved X above Y
  because Y needs X's schema").
- `matchJob(job, builds)` — the dedupe match (§ 4.5).
- `slotSplit(maxAgents, sessions, split)` — the fair share of the global agent cap per session (configurable
  `settings.slotSplit`, default equal; the primary never gets less than one).
- `helperStatus(session, now, settings)` — the widget's icon: `none` (not connected) · `idle` (connected) · `working`
  (animated; tooltip = current step) · `lunch` (paused / out of usage / idle past `lunchSec`; tooltip = why and when back).

## 7. Role gate

| Action | Primary | Secondary | Brett (console click) |
| --- | --- | --- | --- |
| read state, roster, claims, channel, scoped lists | ✓ | ✓ (scoped) | ✓ |
| join, heartbeat, end own session, sync file write | ✓ | ✓ | ✓ |
| claim / release (own work only for a secondary) | ✓ | ✓ | ✓ |
| send to channel, inbox | ✓ | ✓ | ✓ |
| request-work | – | ✓ | ✓ |
| respond: accept / reject / hold / release own assignment | – | ✓ | ✓ |
| step done / blocked on own assigned step | ✓ | ✓ | ✓ |
| create / add / queue / start / reorder / edit / cancel / re-model builds, steps, plans, profiles | ✓ | ✗ | ✓ |
| offer, assign, take-back, replan apply, claim-job for others | ✓ | ✗ | ✓ |
| settings, make primary, approve a new account, revoke | – (Brett) | ✗ | ✓ |
| axHub policy, approvals, passes | ✗ | ✗ | ✓ (axHub) |

A secondary's console hides what it can't do **and** the server refuses it; the UI is never the only gate.

## 8. Areas

Named areas map to paths (open registry, `AREAS` in the engine; a project may extend it in its sync settings):
`terminal` → `apps/console-web/plugins/console-terminal/**`; `banner` → `framework/react/components/Banner*.tsx`,
`apps/console-web/plugins/*-banner/**`; `kernel` → `framework/core/**`, `framework/android/axf-kernel/**`;
`plugins` → `apps/console-web/plugins/**`; `builds` → `_claude/builds/**`; `spec` → `framework/spec/**`,
`framework/schemas/**`; `console` → `apps/console-web/src/**`. A claim may name an area or globs; both overlap by paths.

## 9. Live push

Every link write emits one typed event (`type`: `link`, `session`, `claim`, `offer`, `assignment`, `message`,
`build`, `replan`, `handover`, `sync`); builds store writes seen through the file watcher emit `build`. `GET /events?after=<seq>`
is an SSE stream (`id:` = seq, `event:` = type, `data:` = the JSON); a client that reconnects asks from its last seq
and gets `gap` when the log was trimmed (then reloads state). Every open console / Molly / axHub web client patches
just that piece of its UI (the Sessions panel, the join dialog, the helper widget, the helper badges, the lists); a
small dot shows *live* / *reconnecting*; when the stream is down the client polls slowly (30 s). CLI and MCP writes
push the same events, since the server is the only writer. The hook delivers the same events to Claude sessions at
their next step.

## 10. Safety

- The link is scoped to one project; a session on another project never sees it.
- A new account's first join needs Brett (console click or axHub approval, confirm policy). Tokens are never pasted:
  a joining session uses its own axHub connector / console token.
- A secondary can't change axHub policy, approvals, passes, settings or the primary; every held call still goes
  through Vinnie's veto; the plugin never approves anything.
- Everything both sessions do is one audit line (`audit.jsonl`) and shows in the Requests ledger / Codebase changes
  when those plugins are on (capabilities, never folders).
- Disabling the plugin turns enforcement off cleanly: claims stop being required, builds run unrestricted, and the
  hook, the banner and the Build manager show a visible warning.

## 11. Commands (plugin-commands@1; REST `/api/plugins/session-sync/…`, MCP `session-sync_<id>`, CLI `axf session-sync <id>`, voice through Molly)

`sync`, `join`, `heartbeat`, `end`, `state` (read), `snapshot` (read: the join dialog's detail), `claim`, `release`,
`claims` (read), `send`, `inbox` (read), `messages` (read), `request-work`, `offer`, `offers` (read), `respond`,
`step`, `take-back`, `replan` (`dryRun`), `claim-job`, `consistency` (read, `fix`), `settings` (read / set, owner-only
keys), `approve-account` (Brett only), `events` (SSE, skipped in the registry), `audit` (read).

## 12. Fixture

`framework/spec/fixtures/handoff.json` replays: the role gate; claim overlap and expiry; two sessions racing for the
same area (the second gets `claimed`); offer → accept → step done → replan; reject → take-back; hold → wait; release →
re-offer; dedupe match; slot split; helper status; sync render / parse round trip. `check-handoff.mjs` runs it (CI).
