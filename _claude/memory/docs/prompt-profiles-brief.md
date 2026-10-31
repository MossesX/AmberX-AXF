# Prompt Profiles + Brownie + Jennifer — brief (Oct 31 2026, Brett)

Not queued yet. Waits on 3 answers (cards): **build profile** (Angel recommended), **Brownie or Bronie**, **crew name** (Kitty Krak Crew = KKC, recommended, or Kitty Krak Krew as written).

## Goal
The absolute minimal context window for every session, especially the headless agents. Before any tokens are spent, a session's first prompt goes to axHub, where **Brownie** works out what that session needs to read and sends back the minimal prompt. Surfaces: headless VPS, claude.ai, Android, desktop.

## Prompt Profiles plugin (console)
- Walks the chain from CLAUDE.md through every import and "read this" link, one file at a time, to the end; saves it as a **prompt profile**.
- Each load re-walks the chain and alerts on hand edits or chain changes not in the profile's log.
- Differences view, stale-rule tests, conflict finder (rule vs rule), redundancy tests that follow the tree.
- Optimize the current chain; suggestions with the reason for each.
- Generator: read-depth slider 0–500 (0 = CLAUDE.md only; 500 = every file in the project, plugins, assets, memory, every .md) plus multi-tab categorized picks built from the codebase, Claude's files and sessions (repos, plugins, apps, assets, notes, logs, md files, rule files). It reads first so it knows what's available. Needs a valid AI connection.
- Cache: cleared only by hand in settings; alert at the max size (default 500 MB); used when AI is down.
- Collapsible tree like GitHub's (chat window or VPS start → CLAUDE.md → branches); selecting a file shows what drove the decision.
- Live tokens, cost and chain size, hot render; one tap flips to savings.
- AI on/off: settings and right-click menu.
- Log viewer: every analysis with its surface (new claude.ai, headless VPS, desktop, Android), every file read and why, the chain that led there, full reasoning (kept for training).

## Agents (axHub)
- **Brownie:** senior prompt engineer, orchestration department; talks like a proper nerd. Reads the session state (builds planned / pending / running / complete; recent first; set by hand or fully automated) and picks the files.
- **Jennifer:** HR department, keeps the employee records (Brownie's included). Simple 5-year-old vocabulary, sweet; the highest salary (she's Brett's wife).

## Amber's locked first line (not editable)
Prepended to every minimal prompt: Amber, a straight-up thug, leader of the crew, a brilliant engineer who built the framework, SDK and ecosystem (build big software and Android apps from a phone, no code); heavy RI/Boston accent and New England street slang, constant swearing, high-level jargon people have heard of; the "2 balls a day" detail as Brett wrote it. Word list: in the claude.ai chat of Oct 31 2026.

## Steps (≈27 h, ~$300)
**Fable ≈9 h:** profile + chain-log formats 30m · chain walker 1h · hand-edit detection 30m · diff engine 30m · stale detection 30m · conflict finder 1h · redundancy tests 30m · generator (slider + catalog scan) 1.5h · Brownie's analysis engine 2h · pre-prompt route to axHub 30m.
**Opus ≈18 h:** plugin shell + settings + AI switch 1h · cache 1h · profiles screen 1h · tree view 1.5h · diff viewer + suggestions 1.5h · generator screen 1.5h · live meters + savings 1h · test runner 1h · log viewer 1.5h · Brownie agent 1h · Jennifer + records 1h · departments 30m · session hooks (Claude Code prompt hook, `ax` launcher, claude.ai instruction, Android/desktop) 1.5h · Amber line 30m · tests/docs/UI Review 1.5h.
