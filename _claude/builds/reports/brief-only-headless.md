# Report: brief-only-headless (Headless sessions get the brief only)

Branch `claude/brief-only-headless`, Opus. Contract: headless-context@1 (`framework/core/headless-context.mjs`, CLI
`framework/cli/headless-context.mjs`). Brett: "Headless builds must NOT load CLAUDE.md, the CLAUDE.md chain, memory
folders, rules files or any auto-loaded context. The ONLY input is the brief the orchestrator writes."

## Measured (Claude Code 2.1.319, Opus 5.5, this worktree, Nov 8 2026)

`node framework/cli/headless-context.mjs measure --profile full|brief --brief <file> --first-only`: one real request,
stopped after the first one, with this build's own orchestrator brief (3 KB) as the prompt.

| Run | Start tokens | Start cost | Tools | MCP servers | Skills + commands |
|---|---|---|---|---|---|
| Before (full chain, what headless runs load today) | 74,847 | $0.31 | 47 (20 MCP) | 4 (claude.ai axHub, Docs, Hostinger ×2) | 164 |
| Brief only, Claude Code default tool set | 13,402 | $0.03 | 22 | none | 0 |
| **Brief only, as shipped (6 built-in tools)** | **11,199** | **$0.03** | 6 | none | 0 |

- **−85% start tokens** (74.8K → 11.2K). The brief's ~31K estimate was low: on this VPS the chain is ~75K (CLAUDE.md
  chain + hub CLAUDE.md + the SessionStart hook dumping ~125 KB of claude-sync output, the skills list, claude.ai
  connectors' tool schemas).
- A trivial "say ok" run: $0.49 → $0.02 (full vs brief only, first run, cold cache).
- What's left (~8.6K) is Claude Code's own system prompt + the 6 tool schemas; `--bare` would cut more but never reads
  OAuth logins, and every build runs on a Claude subscription login, so it can't be used.
- The "before" row is slightly low for real launches: those also got the axHub MCP server whenever a token was at hand
  (none on this host today).

## What changed

**Launch (deploy/claude-headless.sh → `headless-context.mjs plan`):**
- env `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (no CLAUDE.md / rules / @imports at any level), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`,
  `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
- `--setting-sources ""` (no user / project / local settings files), `--settings <lean file>`: the reporting hooks
  (change log, activity, archive, check-in) keep running; SessionStart / UserPromptSubmit hooks run with their output
  thrown away; `claude-sync start` (a pure context loader) is dropped. Verified: a test run's muted UserPromptSubmit hook
  still opened its change-log entry.
- `--strict-mcp-config` + `--mcp-config` only for servers the job names (`Needs MCP: axhub` in the brief, or Claude
  settings); default none. Verified with a stdio probe server that MCP tools survive `--tools`.
- `--disable-slash-commands` (no skills list), `--tools=Bash,Read,Edit,Write,Glob,Grep` (+ `Needs tools:` in the
  brief), `--disallowedTools=Agent,Workflow` (no sub-agents). `=` forms on purpose: both flags are variadic and swallowed
  the prompt in the first test.
- The log's `# context: brief only · … tools … · MCP … · hooks quiet · brief ~N tokens` line says what loaded; the stream's
  init event is summarised on the meter (`context.loaded`).
- Off switch: Claude setting `headless.briefOnly` (owner-only) or `AXF_BRIEF_ONLY=off` for one launch = the old full chain
  (and the old always-axHub MCP block).

**Self-contained briefs:**
- `orchestrator.mjs brief <id>` now writes a `## Rules for this job` block in: the rules brief (rules-briefs@1, saved
  snippets by condition: core / UI / plugins) plus every rule bullet whose tag (`<!-- axf-plugin:x -->`,
  `<!-- axf-build:x -->`) the brief names. `build-orchestrator` / `codebase-changes` tags are never picked by name (every
  brief names them in its tick line; the core rules brief covers them). `--no-rules` = bare.
- A brief without the block (any launcher path) gets the same block appended at launch; an empty template heading
  doesn't count as a block.
- Budget: `headless.briefBudgetChars` (24,000 chars ≈ 6K tokens, brief + rules). Over it: still launched, warning in the
  log and a note on the build; `orchestrator.mjs brief` says so on stderr / `budget` in JSON. This build's brief with
  rules: 6.6K chars.
- `_claude/builds/BRIEF-TEMPLATE.md`: `Needs MCP:` / `Needs tools:` lines and the rules section explained.

**Measure and show:**
- Meter (`deploy/claude-meter.mjs`, headless-meter@1) adds `start` {tokens, cache read/write, cost, warning over
  `headless.startTokenWarn`}, `context` {briefOnly, loaded} and `build`; no phantom CLAUDE.md chain on brief-only runs.
- Console: the Terminal's headless tab tooltip shows `start 11.2K tokens ($0.03) · brief only · 6 tools · MCP none`;
  each run ends with a note on its build (`Headless run …: brief only · start … · cost …`), and the Build orchestrator's
  build view lists them under **Headless runs**.
- API / MCP / voice: `GET /api/plugins/build-orchestrator/headless/{build}` = command `headless-runs` (plugin-commands, so
  MCP and Amber get it); CLI `headless-context.mjs runs [--build id]`, `show`, `budget`, `compose`, `measure`, `summary`.
- Settings: Claude settings → **Headless sessions** group (collapsible section; brief only, built-in tools, MCP servers,
  tools never given, hooks, brief budget, start tokens warning). Same keys through `claude-settings.mjs get|set`,
  `claude_settings_get/set` (MCP) and the console.

## Reused from the unlanded branches

- `claude/token-optimize` (PR #360): `framework/core/rules-brief.mjs` and `framework/cli/rules-brief.mjs` taken as they
  are; `framework/schemas/rules-briefs.json` taken with two paths globbed (`apps/console-web/plugins/*/orchestrator.mjs`,
  `…/*/review.mjs`) so the framework names no plugin folder (plugin-lifecycle check) — a small conflict with #360 on that
  one file. **Superseded by this build:** its `lean_setup` (CLAUDE_CODE_DISABLE_CLAUDE_MDS only + `--append-system-prompt`)
  and the meter's `lean` flag. **Not taken (still #360's):** the token log (token-turn@1), the API-run gate, the Rules
  briefs editor UI and token log viewer in Claude settings.
- `claude/md-chain-control` (PR #362, built on #360): chain-control@1 (fresh session per step, output caps, step budgets)
  is a different axis and is not superseded; its launcher changes will conflict with this branch's in
  `deploy/claude-headless.sh` and need a rebase onto it. Its "33K at session start with no chain" matches what the
  default tool set + system prompt cost before the tool trim here.

## Tests

- New `framework/spec/check-headless-context.mjs` (38 checks, in CI): plan, settings cleaning, variadic `=` forms, lean
  hooks (muted keep stdin), MCP needs / skipped without token, init summary, start tokens, budget, rules by tag, empty
  template heading, run-note parsing, CLI line protocol, launcher wiring.
- Real runs: measure full vs brief (above); an end-to-end `deploy/claude-headless.sh` launch in tmux (log line, meter
  `start` + `context`, hooks fired); MCP-with-`--tools` probe.
- Unchanged and green: check-theme, check-controls, check-toolbars, check-chrome-assets, glossary catalog --check,
  tracker --check, claude-settings test.mjs (47) + test.py (21), plugin-commands test.mjs (41) + server (53),
  check-plugin-commands (57), check-headless-tabs (63), build-orchestrator test_upgrade (12), console `tsc --noEmit`.

## Gaps

- The live launcher in /opt/axf picks this up only after merge (the merge queue).
- Per-build start tokens are read from build notes in the console (the meters live on the VPS host); a structured field
  on the build record would need a builds@1 change (normBuild drops unknown fields).
- Kotlin twin: none needed (launcher / CLI only, no engine).
