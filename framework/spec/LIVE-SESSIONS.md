# Live sessions — `live-session@1`

**Rule (Brett, Oct 18 2026):** every assistant in the framework keeps its sessions live. A session never closes
because a browser, app or phone closed; it runs on its host (axHub on the VPS) and any device can pick it up
again. These features belong to the **assistant plugin**; the kernel only carries the contract.

## Model

- A **live session** is a long-running conversation or job (assistant chat, agent run, terminal) owned by a
  **host**, never by the screen showing it.
- Viewers **attach** and **detach**. Detaching (closing a tab, losing the network, locking the phone) never stops
  anything. Reattaching **replays** every event after the last one the viewer saw.
- A session ends only when it is **closed on purpose**. Idle sessions sleep; they are never reaped by a timeout.
- Pauses for the user (an approval card, a PIN) put the session in `waiting` until answered, however long that takes.

## Contract

| Piece | Web (reference) | Kotlin kernel | Python (console plugins) |
| --- | --- | --- | --- |
| Types, reducer, log, host interface, placeholder, host registry | `framework/core/live-session.ts` | `ai.amberx.axf.kernel.live` (`LiveSession.kt`) | `plugins/ai-assistant/server/sessions.py` (log + reducer + local host) | <!-- axf-plugin:ai-assistant -->
| Conformance | `spec/fixtures/live-session.json` (from `gen-fixtures.mts`) | `LiveSessionConformanceTest` | `test.py` replays the same fixture |

- **States:** `idle` · `running` · `waiting` · `closed` (`closed` is final).
- **Reserved kinds:** `session.open`, `session.close`, `turn.start`, `turn.end`, `wait`, `resume`, `interrupted`.
  Only these change state. Every other kind (`text`, `tool`, `status`…) belongs to the owner and is replayed as-is.
  The set of kinds is open.
- **Event:** `{seq, at, kind, data?}`. `seq` starts at 1 per session and is never reused.
- **Log:** bounded (`limit`, default 4000, newest kept). `since(after, max)` returns:
  - `events` — seq > `after`, at most `max`;
  - `next` — the seq to ask from next time;
  - `gap` — events after `after` were already trimmed: reload the owner's full state (e.g. the conversation), then follow on;
  - `reset` — `after` is beyond the newest seq (the viewer saw a log the host no longer has): replay restarted from the oldest kept event;
  - `more` — more events are waiting beyond `max`.
- **SessionHost** (capability `axf.live-sessions`): `available`, `list`, `open`, `info`, `events`, `attach`
  (replay then stream; returns detach), `send`, `stop` (the running turn only), `close` (the only way a session ends).
- **Kernel:** registers the host registry (`SessionHosts`, Kotlin service `axf.live-hosts`) and declares
  `axf.live-sessions` as a typed placeholder. `PlaceholderSessionHost` answers `NotImplemented` and never
  pretends to work. A module registering a real `SessionHost` under the capability replaces the placeholder.

## Hosts

| Host | Where | Status |
| --- | --- | --- |
| `local` | inside the app/console that runs the assistant (the console's AI assistant plugin) | **built** (Oct 18 2026): turns run detached from the request, survive browser closes, replay on reattach; a console restart mid-turn marks that turn `interrupted` | <!-- axf-plugin:ai-assistant -->
| `axhub` | session workers on the VPS hub, reached from any app or device | **placeholder**: picked in Settings → Plugins → AI assistant → Sessions, answers "not available yet" until axHub's worker side exists | <!-- axf-plugin:ai-assistant -->

Future hosts register the same way (open registry); nothing in an app changes.

## Not yet

- axHub session workers (process supervision, restart with the hub, cross-device attach over AXPP).
- Android assistant UI on top of `SessionHost`.
- Resuming a turn mid-generation after a host restart (today it is marked `interrupted`; the conversation itself is kept).
