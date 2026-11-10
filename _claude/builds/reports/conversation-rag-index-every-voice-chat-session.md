# Conversation RAG: index every voice/chat session with Brett (conversation-rag-index-every-voice-chat-session)

Brett (2026-11-10 16:50): "You better make some type of RAG database for this conversation."

## Result
New console plugin **Conversations** (`apps/console-web/plugins/conversation-rag`): a local RAG store of every
conversation with Brett, plus a rules ledger that every rules brief now carries.

- **Sources** (incremental, bounded per round, newest first):
  - Claude Code chats: `~/.claude/projects/*/*.jsonl` (root + axfbuild). Tool calls/results, thinking, system reminders
    and meta lines are dropped; secrets are redacted. Long structured user turns (briefs, pasted prompts) are indexed as
    `prompt`, and only Brett's quoted words inside them ("Brett said (verbatim)", `Brett: "…"`) count as his.
    Headless build runs are skipped (only their verbatim Brett quote is kept) unless `includeHeadless` is on.
  - claude.ai exports: `conversations.json` in `<dataDir>/imports/` or `POST import`.
  - Session recordings (AmberX recorder + faster-whisper): through a new capability service
    `axf.session-transcripts@1`, which output-recorder now provides (read-only, ~15 lines). Hits carry the offset in
    seconds of the matching segment.
- **Index**: SQLite in the plugin's data folder. Passages of a few turns (~900 chars, one-turn overlap), tagged by date,
  topics and build ids (matched against `_claude/builds/store.json`). FTS5/BM25 candidates reranked with a 256-dim local
  hashed embedding (stems, word pairs, char trigrams) + exact-phrase and recency boosts; prefix fallback for typos.
  No model, no key, no tokens. On this VPS: ~1–4 s per 40 MB slice, catches up in 15 s slices, then every 10 min.
- **Rules ledger**: sentences in Brett's own words that state a rule / decision / request, scored; pin, hide, edit, add
  by API. Published as `conversation-ledger@1` to `/projects/_shared/_data/claude/conversation-ledger.json`.
- **Every brief loads it**: `framework/cli/rules-brief.mjs` `loadForLaunch()` appends the ledger as the last rules brief
  (`compose` / `preview`, and `headless-context.mjs rulesFor()`, which the orchestrator uses for every dispatch). Being
  last, the brief character cap trims it first; never stored in the rules-briefs document. Pinned/manual entries first,
  then rules and decisions over `minScore`, newest first, capped at `briefMaxChars` (1800).
- **AI**: only `GET context` can call a model (`axf.llm@1`), behind the `ai` setting, off by default.

## API (all four the same, plugin-commands@1 auto: REST, MCP tools, CLI, voice)
REST `/api/plugins/conversation-rag/…`: `status`, `reindex`, `search`, `find-session`, `context`, `sessions`,
`session/{id}`, `ledger`, `ledger/add`, `ledger/{id}`, `import`, `settings` (GET/POST). Deep link: console view
`conversation-rag` (`console_open conversation-rag`); the settings are Settings → Plugins → Conversations.
Other plugins: `axf.conversation-search@1` (search, find_session, ledger, context).

## Tests
- `python3 apps/console-web/plugins/conversation-rag/test.py`: 27 checks (embedding, redaction, extraction,
  chunking, three sources, headless skip, search/filters/offsets, find-session, ledger publish/hide/pin/switch,
  incremental and full reindex, rules-brief carries the ledger). Added to CI (android.yml web tests).
- output-recorder `test_transcripts.py` 20 ✓; build-orchestrator `test.mjs` 33 ✓, `pipeline.test.mjs` 38 ✓.
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-plugin-pages, plugin-lifecycle check,
  plugin-commands check: all ✓. `tsc --noEmit` clean.
- Trial on the real Claude history: Brett's line "You better make some type of RAG database for this conversation."
  is the top hit for "RAG database".

## Gaps / decisions
- **No UI Review shots yet**: Playwright isn't installed in this worktree, so no desktop/phone captures were taken. The
  page needs shots and a UI Review submit before the PR is called ready.
- "The new search plugin" doesn't exist yet, and Search everything has no plugin search hook: the plugin provides
  `axf.conversation-search@1` for it, and has its own search page meanwhile.
- `session-transcripts-api` (the recorder's own transcript API and deep link to a moment) is still pending; the
  recording link here opens the recorder page (`output-recorder?rec=<id>`), the time is in `offset`.
- Ledger extraction is pattern-based (zero tokens), so a few complaints read as rules; Hide removes them from every brief.
- AmberX voice-agent chats that aren't recorded by the output recorder aren't a source yet.
- No Android twin (no new Kotlin work).
