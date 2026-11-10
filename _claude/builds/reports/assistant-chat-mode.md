# Fast talk: chat mode for Gizmo and the console assistant

Build `assistant-chat-mode` (runs r1 to r4). Branch `claude/assistant-chat-mode-r4`.

## Result

A plain message now reaches its first word in about a second, down from about 8 seconds, and costs about a tenth as much.

| Turn | First word | Whole reply | Tokens in | Cost |
|---|---|---|---|---|
| "hi", full session (`toolMode: tools`, 4 runs) | 6.7-15.6 s, median 7.9 s | 9.7-18.9 s | 55,669 | $0.070 |
| Plain talk, chat mode (8 runs) | 0.92-1.17 s, median 1.0 s | 1.1-2.0 s | 797 | $0.007 |
| Tool turn, one group loaded ("read the README") | 2.5 s | 2.6 s | not captured | not captured |
| Same message, full session | 8.9 s | 9.7 s | not captured | not captured |
| Plain-looking message the model escalated | 4.3 s | 40 s (3 tool calls) | 104,880 | $0.37 |

Token and cost figures for the first two rows come from one turn each (the CLI's `result` usage, cache reads included).

## How it was measured

Real turns through the plugin's HTTP route and `run_turn`, with the real Claude Code CLI on `claude-opus-5-5`, in this worktree.
Raw rows: `assistant-chat-mode/measure-after.json`.

- "Before" is forced `toolMode: tools`, which is the unchanged full-session code path, not a run of the old commit.
- Run on the VPS outside the console container, with no agent attached, so it shows the path and not Gizmo's persona or memory.
- Not measured on the phone or through AmberX's proxy. Expect network time on top.
- The escalation row ran the marker end to end on the real model, not only the fake CLI in the tests.

## What changed

- **Provider:** lean Claude Code call (no CLAUDE.md, settings, hooks, skills or session file; no tools; low effort; empty folder). Usage limits now raise a real error, so the fallback chain and the credit check see them. No sampling parameters on Claude 5 models.
- **Router (`server/chatmode.py`):** action words, live words, then the model's `[[tools]]` marker. Tool groups come from agent skills. The next message drops back to chat.
- **assistant@1:** optional `toolMode` on settings and on a turn, `defaultToolMode` on status, `mode` and `firstWordMs` on events and meta, `turnModeLabel`. Spec in `framework/spec/ASSISTANT.md`. Fixtures regenerated, four apps re-baked. Kotlin has the settings key only, the rest is a recorded gap in PORTING.md.
- **Gizmo:** Chat / Tools chip, "When Gizmo loads tools" setting, per-chat mode, reply footer with mode and first-word time, spoken errors.
- **Console:** same chip, per-chat select, Behaviour section (default mode, model, history, cache, word lists, escalation).

## Fixed in review of the unpushed r3 work

r3 had the chip and settings written but not tested. These were wrong:

1. Gizmo's setting never reached the server, so the chip could say Chat only while the turn ran Auto. The turn now carries it.
2. New chats were stamped `auto`, so the force setting could not change them. Only a chip tap writes to a chat now.
3. The console chip ignored the configured default. Status reports it now.
4. "The default" in the console could not clear a chat's mode (`undefined` is dropped from JSON).
5. The word-list boxes ate commas as they were typed, so a second word could not be added. They save on blur.
6. In talk mode, a turn refused for budget or a failed create was silent and left talk mode waiting. It is spoken and listening resumes.
7. A non-numeric saved number crashed `normalize`.
8. Gizmo's reply footer ran the model and mode together and wrapped on a phone. It is one clipped line.

## Tests

- `apps/console-web/plugins/ai-assistant/test.py`: 203 passed, six new.
- `framework/python/axf/contracts/test.py`: 9 passed. `assistant_host/test.py`: 58 passed. `check-web-client.mts`: 616 passed.
- `tsc --noEmit` on console, AmberX and axHub web; Molly was not type-checked here (no node_modules in this worktree).
- Theme, controls, toolbars, chrome, help coverage, plugin lifecycle, plugins, tracker, project validation, model policy, shared assets: pass with CI data settings.
- The full CI workflow runs on the PR. `theme-swap` and the Android build were not run locally.

## Known gaps

- The first-word time depends on the CLI starting, which is most of the second. It will not get lower on this path.
- Escalation costs one extra call, and that call's usage is not counted, because the stream is stopped as soon as the marker appears.
- Tool turns outside an agent have repo reading only, no shell. The measured escalation said so in its reply. Gizmo has its agent's tools.
- A chat turn keeps agent and memory for `cacheSec` (10 minutes), so memory recalled on the first message is reused and not searched per message.
- `Button size="sm"` is short on a phone: the chip is about as tall as Send. Same theme token, not changed here.
- **Not from this build:** on a 412 px phone in the test harness Gizmo's composer sits below the fold behind the bottom nav until you scroll (`.axp-companion` height ignores the banner and nav). Worth its own fix.

## Shots

`assistant-chat-mode/shots/`, desktop and phone, from a mocked API. The reply text is mock data, the UI is the real build.
