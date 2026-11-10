# Conversation RAG amendment: store only short key/value entries (conversation-rag-amendment-store-only-short-key)

Brett (2026-11-10 16:51): "I don't need the whole entire session quoted and plugged in, that costs me a shitload of
money. Just a brief summary of what you don't do. A two field RAG format, an entry and a value, that's it."

Amends `conversation-rag-index-every-voice-chat-session` (PR #461, not merged yet: this branch is built on top of it).

## Result
- **Two fields.** Each ledger item is now `entry` (the rule, mistake or decision, ≤ 60 chars) and `value` (one line,
  ≤ 160 chars: what not to do, what to do instead). Example from Brett's own line:
  `session quoted and plugged in: Don't: session quoted and plugged in, that costs me money. Do instead: a brief summary of what you don't do.`
- **Plain-rules extraction, zero tokens.** Rules (`never`, `always`, `I don't need`…), mistakes (new kind: `you didn't`,
  `you forgot`, `you keep`…) and decisions. A following "Just …" / "Instead …" / "Only …" sentence becomes the
  do-instead half. Lead-ins and intensifiers are dropped; a sentence with its own subject ("the kiwi banner must…") is
  kept whole.
- **AI only behind its switch.** With `ai` on and `axf.llm@1` installed, up to 20 new entries per round are tidied;
  the model sees one sentence per entry, never a session.
- **No stored sessions.** New setting `passages`, off by default: session text is not stored (only a row per session:
  title, dates, link). Switching it off deletes stored passages (and VACUUMs). Trial on the real history: 184
  sessions, 96 entries, 0 passages, 224 KB.
- **Briefs pull only matching entries.** The published file (`conversation-ledger@1`) now holds
  `entries: [{entry, value, pinned?}]`. `framework/cli/rules-brief.mjs` `loadForLaunch(task)` adds pinned entries plus the
  entries whose words match the task (shared stems, entry key weighted; `ledgerText`/`matchEntry`), 12 at most,
  ~1200 chars. `headless-context.mjs rulesFor()` passes the brief, so every orchestrator dispatch matches on its own
  task. An older file without entries falls back to its `briefText`.
- **Context pack** (`GET context`) is the matching `entry: value` lines only, never passages.
- UI: the Rules ledger tab is now **Entries** (entry/value shown, Add with two fields, Edit/Pin/Hide); search shows
  entries (passages only when stored); settings gain "Also store whole-session passages".

## API (plugin-commands@1 auto: REST, MCP tools, CLI, voice — all the same)
REST `/api/plugins/conversation-rag/…`: `ledger` (GET), `ledger/add {entry, value, kind}` (or `{text}`, distilled),
`ledger/{id} {entry, value, kind, pinned, hidden}`, `search`, `find-session`, `context`, `session/{id}` (now its entries),
`settings` (`passages`, `briefMaxEntries` new). Deep link: `console_open conversation-rag`; settings in Settings → Plugins →
Conversations. `node framework/cli/plugin-commands.mjs check conversation-rag`: 10 reads · 5 commands.

## Tests
- `python3 apps/console-web/plugins/conversation-rag/test.py`: 43 checks ✓ (two-field extraction of Brett's quote,
  mistakes, caps, matching, no session text in the db or published file, search/context are entries only, passages
  on/off and purge, AI switch off = no call / on = single sentences, rules-brief carries pinned + matching only).
- build-orchestrator `test.mjs` 33 ✓, `pipeline.test.mjs` 42 ✓. check-theme, check-controls, check-toolbars,
  check-chrome-assets, check-plugin-pages, plugin-lifecycle check, plugin-commands check ✓. `tsc --noEmit` clean.

## Gaps / decisions
- No UI Review shots: Playwright isn't installed in this worktree (same as #461). The page needs desktop/phone shots
  and a UI Review submit before the PR is called ready.
- `conversation-ledger@1` kept its id: the file is new (only #461 writes it) and the reader falls back to `briefText`, so
  no version bump; stayed on Opus.
- Matching is word overlap (no model): an entry reaches a brief only when its words appear in the task. Pin an entry to
  send it everywhere.
- Plain-rules wording is rough on some sentences; Edit fixes an entry, or the `ai` switch tidies them (costs tokens).
- No Android twin (no new Kotlin work).
