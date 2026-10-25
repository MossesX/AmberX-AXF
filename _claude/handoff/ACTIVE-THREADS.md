# Active threads — pick-up list for another account

Written 2026-10-24 18:05 UTC from the AmberX AXF claude.ai project (9 unresolved threads).
Read this after `HANDOFF.md`. Repo MossesX/AmberX-AXF is the source of truth: keep working
on the same repo (no new repo, no fork). No secrets in here; ask Brett for values.

## Standing rules (full text in `_claude/shared/rules/RULES.md`, `_claude/rules/RULES.md`)

- Before every build: recommend Fable / Opus / Sonnet with one line of why and wait for the pick. If Fable was suggested and Opus picked, park a Fable rebuild on the pending list.
- Check the pending list (`node framework/cli/pending.mjs`) and the Build manager's Live list first; build overlapping items together.
- Every build from a prompt goes on the pending list (`source: "chat"`), and gets a Codebase changes entry (`changes.mjs open …`, steps, result) with machine, session and surface.
- One agent: no sub-agents, no parallel workers, no deep-research fan-outs.
- Ask Brett with tap-to-pick cards; he's on his phone, keep replies short.
- Android is on hold except Voice Vault and Patches app code.
- Settings that affect the UI must hot-render. Plugins use framework controls only. One instance per plugin, `builtWith.model` recorded.
- axHub badge is red unless settings are read live from axHub.
- Banner Auto fix order (decision 2026-10-24): Vinny first (trigger-based commands, no model), then Mosses, then Claude.

## Known gaps

- **`AXHUB_TOKEN` in Project settings is too short (12 chars) → axHub answers 401.** Needs the full hub token pasted again in Project settings → Environment (never in chat). Until then, cloud threads reach axHub through the Dev Console API with `AXF_TOKEN`, and Mosses (`axhub_call`) for hub tools; `changes.mjs flush` works that way.
- **All offline agents' engines (Vinny included) run on axHub**, so their VPS commands go through axHub approvals (https://axhub.amberxai.com/auth/admin/approvals). Approvals expire fast: have Brett say "go" before sending one, then retry 15 s × 10, then every minute.
- Cloud sandboxes can't always reach console.amberxai.com; nothing here is screenshot-verified against the live console.
- axHub repo PR #6 (approval limit 7000 chars) is still a draft; the console already assumes 7000.

## The threads

### 1. Banner auto-fix over SSH — blocked on Brett's design pick
- Goal: every VPS systems check gets Auto fix: fixed command → headless Claude Code in the right container → Mosses. Pending id `syscheck-vps-autofix` (not found in pending.json now; re-add).
- State: code written (systems-check self-test 80 → 95) but **never committed** (a safety check refused the free-root headless design). No branch/PR. Work is lost with that container.
- Waiting on: card "How much should headless Claude do?" — recommended *Look first, then approve* (read-only diagnosis, each fix command on its own axHub approval).
- Resume: since then Vinny-first ordering was decided (thread 9). Ask Brett to re-confirm the design, then rebuild on Opus on top of thread 9's PR.

### 2. Voice notes plugin settings — waiting on model pick
- Done: voice notes settings + Voice Vault listener on main; **PR #51** (Voice notes tabbable page) CI green, ready, not merged.
- New ask (2026-10-24): Voice Vault master "Microphone off", per-trigger switches, custom voice actions screen, quiet hours, "what did it hear" log (~1.5 h, Voice Vault app code only).
- Waiting on: model card (recommended Opus). Resume: merge #51 when Brett says, then build the mic/actions work on Opus.

### 3. Log every Claude code change — waiting on model pick
- Goal: changes hook opens an entry on the first edit/create/remove (not just prompt keywords) with machine, session, session type, repo, branch, folder; plus a project-level hook so cloud/headless sessions log without a per-machine install. ~1.5 h, ~$13.
- Waiting on: model card (recommended Opus). Nothing built yet.

### 4. BanVue banner data viewer — waiting on model pick
- Goal: new framework contract so any banner plugin hands its data (items, status, badges, actions) to another plugin, plus the BanVue viewer (window/dialog, tab group, grids, sub-grids, trees, search, sort) and a big settings UI. Builds on draft PR #42. Web only.
- Waiting on: model card (recommended **Fable**: cross-app contract). If Opus is picked, park a Fable rebuild.

### 5. Plugin model badges and updates — waiting on model pick
- Done: PR #43 merged (model badges, Plugin Update, Plugins menu, AshesUI).
- Next: Build manager **Sessions** group switch — grid of every session (machine, surface, model, dates, counts, time, cost) with expandable sub-grid of everything it was asked to build. Reads the change log it already has.
- Waiting on: model card (recommended Opus).

### 6. Build X Select read-aloud plugin — built, waiting on merge
- **PR #52** (draft, CI green): Android plugin X Select + `lib-selection` + `lib-readaloud`. Pending `xselect-read-aloud` marked complete.
- Resume: mark ready + merge when Brett says.

### 7. Report X Select build to axHub — done, left open
- Change entry `chg-20261024-086f3af4d6` flushed through the Dev Console API; it's on axHub marked running (last update 16:07 UTC). It should be finished (result done) once #52 merges. Thread can be resolved.

### 8. Add out-of-credits connection status — merging
- **PR #64**: Claude badge third state (amber "out of credits") + icon picker per state, 26 tests. Brett said "Merge and deploy"; thread was waiting on CI (console + Gradle) then merging. Console auto-updates 5 min after merge.
- Resume: check CI on #64, merge, confirm the console picked it up.

### 9. Let Vinny run VPS commands offline — building
- Goal: Vinny trigger → command engine (VPS, git, GitHub), no model needed; command book + runs stored on axHub's data folder, commands through axHub `vps.run`; settings dialog for commands/triggers; banner Auto fix tries Vinny → Mosses → Claude.
- State: engine + settings dialog done, banner Auto fix ordering in progress, then tests/typecheck/commit/PR. Decisions saved in `_claude/memory/decisions.md`. Open card: where the engine runs (recommended "book on axHub, engine in console"; moving the matcher into axHub is a follow-up).
- Resume: find its branch (`claude/project-thread-*`, newest) or PR; if nothing was pushed, rebuild from the steps above.

## Other open PRs on AmberX-AXF (not from these threads)

- #28 draft (Oct 22): Push banner 0.3.0 + banner plugins run in Patches. Its thread is resolved; stale against main.
- #54 draft: claude-pick plan login really drops the API key, `--auth-check`.
- #57, #61, #62, #63 drafts from another claude.ai project: connection badges, tab-group asset + per-asset tokens, hidden banners "Show them" line, icon picker. #57 needs #63 first.
