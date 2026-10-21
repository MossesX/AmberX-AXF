# Queue activity log + session archive (Oct 21 2026, Opus)

Brett: "keep a detailed log of the build queue and changes to it … all moves and rearrangements, additions, removals,
why and what prompt caused it" and "an equally powerful session archive … all sessions with what system, user, app,
browser or device ran it, number of prompts, each prompt's cost, input and output cost, the changes the prompts made,
what features they touched, and a detailed cost record for the Build manager — retroactively for every session in the
AmberX Framework and axHub projects". Built together (same who/prompt/cost plumbing), browsed in the console under
**Builds → Build manager → Activity** and **Sessions**. <!-- axf-plugin:build-manager -->

## Queue activity log — queue-log@1

- **What:** every change to the pending list, the build queue and the plan: added, removed (with what it was),
  moved (#from → #to; only items that really changed place), status, model, title, details, estimate, priority, wave,
  effort, epic, dependencies, steps (added / removed / done / reopened / edited), notes, completed, reopened, rework.
- **Who / why / prompt:** each write is a batch with `by`, `surface` (console, mcp, cli, claude-code, claude-code-cloud …),
  `op` (the engine op), `reason` (a request's `reason`/`why`, or `AXF_QUEUE_REASON`), `changeId` + `prompt` (the
  Claude Code session's open Codebase changes entry and its `asked`), `session`.
- **Outside the tools:** axHub direct writes (claude.ai), git syncs and hand edits are caught by comparing each list with
  the last snapshot (`state.json`) before every write and when the log is read: logged as source `outside`, who
  unknown. Anyone can add the why afterwards (Activity tab → Add why, `queue-log.mjs why <batch> "<reason>"`).
- **Where:** shared data `framework/plan/queue-log/<YYYY>/<MM>/<YYYY-MM-DD>.json` (hub: `/projects/amberx-axf/_data/…`),
  added to the root manifest's `data.shared`.
- **Code:** `framework/plan/queue-log-core.mjs` (pure: snapshots, diff, moves via longest kept run, describe, filters,
  item history, summary), `framework/cli/queue-log.mjs` (recorder: `logged(kind, doc, write)` wraps `savePending`,
  the build queue's `saveQueueState` and every plan write; CLI), engine-rpc ops `queue-log`, `queue-log-why`,
  `queue-log-sweep`; the console server passes `AXF_QUEUE_SURFACE` (`mcp` for the MCP server) to every engine call.
- **Browser (Activity tab):** totals (changes, moves, steps, outside), filters (lists, kinds of change, period, made with
  the tools / outside, who), the top search bar, timeline by day → batches (time, where, who, op, change entry link,
  why with Add/Edit why, the prompt that caused it) → events (tap an item for its whole history; removed/added items
  and edits expand to before/after).

## Session archive — session-archive@1

- **One record per session** (`sessions/archive/<YYYY>/<MM>/<id>.json`, hub `/projects/amberx-axf/_data/sessions/archive/`):
  project (amberx-axf, axhub, build-pilot, other), title, start/end, minutes, **system** (host, container, OS, app +
  version, entrypoint, surface, device, how he got there: Moshi / ssh / tmux), user, models, **prompts** (time, text cut
  to 600 characters with secrets hidden, model, tokens in / out / cache read / cache write / thinking, cost, seconds,
  tools used, commands, files changed, change entries, features, the reply's start), totals (and Claude Code's own
  reported total when the transcript has it), files, change entries, features, subagents, cost source.
- **Costs:** Claude Code transcripts carry real token counts per reply (streamed replies counted once), priced with
  `framework/schemas/model-pricing.json` (a model without a price, e.g. Haiku, is flagged "part unpriced"). claude.ai
  chats have no counts: estimated from text (`CHAT_HEURISTIC`: 4 characters a token, 12k tokens overhead a turn, every
  turn re-reads the chat so far), marked estimated everywhere.
- **Linking:** a prompt is linked to the change entries it wrote (changes.mjs commands, axHub `memory_write` of
  `changes/…/<id>.json`, the hook's "Entry … was opened" line, ids in the prompt); listings it only read don't count.
  Features: files under paths a plan feature lists or a build entry's `areas`, console plugin folders, ids named.
- **Cost record (Sessions → Cost by build):** each prompt's cost goes to the entries it worked on (else the last one its
  session named), each entry's to its build (`buildRef`), with the estimate and over/under; unlinked prompts are a
  bucket of their own. `session-archive.mjs costs`, engine-rpc `session-costs`.
- **Recording from now on:** Claude Code: `node framework/cli/session-archive.mjs hooks install` (Stop + SessionEnd →
  `hook` ingests the transcript; `deploy/claude-pick.sh --install` runs it). claude.ai (no shell): write the chat to the
  inbox, see below. **Backfill:** `ingest-dir ~/.claude/projects --host … --container …` (VPS host + every container,
  Oct 21 2026); claude.ai chats read by helpers and written through the inbox.
- **Code:** `framework/plan/session-archive-core.mjs` (pure: `parseTranscript`, `fromChat`, `redact`, `surfaceOf`,
  `projectOf`, `matchFeatures`, `costRecord`, `summary`, `filterSessions`, `aggregate`),
  `framework/cli/session-archive.mjs` (store, ingest, inbox, hooks, CLI), engine-rpc `session-archive`, `session-show`,
  `session-costs`; Build manager server `GET queue-log`, `POST queue-log/why`, `GET sessions`, `GET sessions/{id}`,
  `GET costs` (console token, 404 when off, never on MCP).
- **Browser (Sessions tab):** totals (sessions, prompts, cost with the estimated part, tokens), totals by project / where
  it ran / app or device / model / source / day, filters, search; each session expands to its system facts, totals and
  every prompt (tap for tokens, cost, tools, files, change entries, features, reply).

## claude.ai sessions: record a chat (inbox)

Any claude.ai chat (any project) records itself or others it can read with `axhub.memory_write`:
project `amberx-axf`, area `data`, path `sessions/archive-inbox/<chat id>.json`, content:

```json
{"id": "<chat id>", "url": "https://claude.ai/chat/<chat id>", "title": "…", "project": "axhub", "startedAt": "ISO", "endedAt": "ISO", "model": "",
 "messages": [{"role": "human", "at": "ISO or ''", "text": "≤300 chars, no system reminders", "chars": 1234},
              {"role": "assistant", "at": "", "text": "≤300 chars", "chars": 5678, "toolChars": 9000, "tools": {"name": 2}, "files": []}]}
```

The archive takes the inbox every time the Sessions tab loads (or `session-archive.mjs ingest-inbox`).

**One-time backfill prompt for another claude.ai project (e.g. axHub):**

> Archive every chat in this project into AmberX's session archive. List all chats with recent_chats (page with
> `before` until done), read each whole chat with read_conversation (use subagents if you can, a few chats each), and
> for each write the JSON described in AmberX-AXF `_claude/memory/docs/session-archive.md` → "claude.ai sessions:
> record a chat" with axhub.memory_write (project amberx-axf, area data, path sessions/archive-inbox/<chat id>.json,
> "project": "axhub"). Never copy secrets. Reply with how many chats you archived.
