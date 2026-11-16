# Claude mode for the wake listener (design note)

Build `voice-listener-use-claude-when-connected`, Nov 14 2026. Brett: "can we have a setting to make it use Claude if
Claude's connected". Builds on the wake listener (PR #643, branch `claude/console-app-wake-word-voice-listener`); this
branch is stacked on it until it lands.

## What exists today (scripted path)

- `core.mjs`: settings, wake phrase matching, the state machine (`hear`).
- `catalog.mjs`: the voice command catalog (built-ins, every plugin-commands@1 registry command, control@1 targets,
  the page's actions), `matchCommand` (template and word-overlap matcher), the spoken wizard (`startWizard` /
  `answerWizard`), `requestFor`, `speakResult`.
- `web/flow.ts`: `handleCommand(host, text)`: the floor (wizard or approvals review) first, then the matcher, then the
  console's own voice intents.
- `listener.mjs`: the store (`settings.json`, `state.json` in the data folder) and the CLI. `server/__init__.py` serves
  it over REST. There was no history store; this build adds one (`history.jsonl`).

## How "Claude is connected" is worked out

The Claude badge sends one tiny request through `axf.llm@1` and is green when the reply came from a Claude model
(`claude-badge/server`: `state == ok` and the model name starts with Claude). The listener must not read another
plugin's data by folder name, so it keeps its own copy of the same test:

- `axf.llm@1` missing → `no-llm`.
- Every understand call is itself the probe. A reply whose `model` is not a Claude model → `not-claude`; an error →
  `error` (`no-credit` when the text says out of credits), a timeout → `timeout`.
- The last result is kept in memory and in `claude.json` in the data folder. After a failure, Claude mode is skipped
  for 60 s (straight to scripted, no delay on every command); then the next command tries again. A success marks it
  connected. `GET /state` returns `claudeConnected` and `lastFallbackReason`.

## Where the Claude path plugs in

`web/flow.ts` `handleCommand`, after the floor check for approvals and before `matchCommand`:

1. The approvals review with the floor, the approval built-ins (`approvals.*`) and anything matching the explicit
   approve / deny words never reach Claude (s7). Spoken approvals keep their own path through lib-approvals.
2. Setting `useClaude` off → scripted, no request at all (Brett's note: OFF means no speech text is sent to Claude).
3. Setting on and connected → `POST /api/plugins/wake-listener/understand { text, context, pending? }`.
   - `{mode:'claude', command, args}` → run the catalog entry through the existing `runEntry`.
   - `{ask}` → speak the question; the next utterance goes back with `pending` (the tool call so far). A Claude
     floor sits next to the wizard floor.
   - `{confirm:true}` → speak the summary; only a spoken yes (`YES`) runs it, a no cancels.
   - `{mode:'offline', reason}` → the same transcript goes to the scripted matcher and wizard, unchanged.

## Catalog fields → tool schemas

`server/claude_tools.py`, from the catalog entries (`listener.mjs catalog --json`):

| Tool field | From |
| --- | --- |
| `name` | the entry id made safe for tool names (`[a-zA-Z0-9_-]{1,64}`), with a map back to the id |
| `description` | title + first spoken form + group, ≤ 300 chars |
| `parameters` | JSON schema from `fields`: `string` / `number` / `boolean`, `enum`, `required` = the non-optional fields; `duration` is a string ("two hours"); each field's `ask` is its description |
| `destructive` | `effect == destructive`, `confirm`, or the destructive word list (delete, remove, purge, reset…) |
| `personOnly` | the deciding word list (approve, deny, reject, veto, shelve, decide, sign-off) or the approvals group |

personOnly tools are never offered. The catalog has about 960 entries, too many for one request, so each request sends
the built-ins, the phrasebook entries and the best 40 registry entries by word overlap with the transcript (≤ 64 tools).

## The call

`llm.complete(messages, system, tools, params={max_tokens: 400, temperature: 0})` in a worker thread with the timeout
setting (`claudeTimeoutSec`, default 8 s). The system prompt: pick exactly one command, fill fields from what Brett said,
ask one short question for a missing required field, never invent values, answer in a JSON line when tools are not
available (`{"command","args","ask"}`; the Claude Code CLI provider has no tool bridge for plain completions).
A reply naming an unknown or personOnly tool is refused and falls back (`refused`).

## Fallback reasons

`off` (setting), `no-llm`, `not-claude`, `cooldown`, `timeout`, `error`, `no-credit`, `no-command` (Claude picked none),
`refused`, `approvals` (approval words stay scripted). Each is recorded on the history entry and in `GET /state`.
