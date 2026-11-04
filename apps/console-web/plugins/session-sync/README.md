# Session sync (handoff@1 + session-link@1)

Two Claude sessions on one project, side by side, without building the same thing or touching the same files (Brett,
Nov 4 2026). Spec: `framework/spec/HANDOFF.md`; engine `framework/core/engines/handoff.mjs` (pure, fixture
`framework/spec/fixtures/handoff.json`, check `framework/spec/check-handoff.mjs`). Everything else is this plugin
(`plugin@1`, `forFramework: true`, installable in the console, Molly, AmberX and axHub web, removable completely).
It replaces the threads log and the handoff notes, which are gone (`framework/spec/check-no-threads.mjs` keeps them gone).

## How it runs

1. **`/sync`** (Claude Code command, `commands/sync.md`, installed into `.claude/commands/` and `~/.claude/commands/`)
   or `node apps/console-web/plugins/session-sync/sync.mjs sync` or the console's **Sync session** button or voice
   ("sync AmberX") writes `_claude/sync/<project>.json` + `.md` (handoff@1: who is on, claims, running and queued work,
   offers, PRs, attention, decisions, rules, next) and publishes it to main as a status-only commit.
2. A session on **any account** reads it and joins (`sync.mjs join`, `/sync`, MCP `session_sync_join`, the console's
   join dialog). First in = **primary** (owns the orchestrator); every joiner = **secondary** (helper). A new account's
   first join waits for Brett's approval (console click, bell alert, or the axHub approval `axf.session_sync_approve_account`).
3. **Claims** are leases on areas (`terminal`, `banner`, `kernel`, `plugins`, `builds`, `spec`, `console`) or path
   globs, renewed by heartbeat, expiring after 20 min. The Claude Code hook (`sync.mjs hooks install`, once per machine)
   refuses an edit outside your claims while another session is live and names the holder; `sync.mjs check-commit`
   (pre-commit; `--ci` reads the sync file) fails a commit outside them. Disabled plugin or `enforce: false` =
   unrestricted builds with a visible warning (hook line, banner chip, systems check).
4. **Talking:** the Breakroom's group chat, `sessions` channel (no second chat). Every join, claim, offer, accept,
   reject, hold, release, step start / done / blocked, take-back, re-plan and sync posts there automatically with the
   agent's name; free-form lines with `send`. The hook delivers unread lines and claim changes to a Claude session at
   its next step (UserPromptSubmit / PreToolUse), so nobody polls.
5. **Handovers:** a helper asks (`request-work`) and the orchestrator offers whole queued builds or steps split out of
   builds in progress (balanced by areas, model, dependencies); the primary can also *Send to helper* from any build
   or step (whole build, or the steps as a new child build). The helper accepts / rejects / holds / releases; the
   orchestrator reacts (take back, wait, re-offer, replan) and says why. Every handover updates the builds store
   (`assignedTo`, `withHelper`, child builds with `parent`, `touches`), the link, the claims and the chat in one
   transaction and pushes one live event; `consistency --fix` (CI, systems check row with Auto fix) keeps them equal.
6. **Live push:** `GET /events?after=<seq>` (SSE, `id:` = seq, `event:` = type, `gap` when trimmed). The server also
   watches the link file, so CLI and hook writes push too. Clients patch the Sessions panel, join dialog, helper
   widget and badges at once; a dot shows live / reconnecting.

## Roles (enforced server-side)

Secondary: read everything (scoped lists: only its assignments and offers; *Managed by orchestrator* instead of a
build profile), claim / release for its own work, send, inbox, request-work, respond, mark its own steps. Never:
create / queue / start / reorder / edit / cancel / re-model builds, offer, assign, take back, replan, settings,
primary, approvals. Refused writes answer 403 "secondary sessions can't do that" and are audited (`audit.jsonl`).

## Commands

REST `/api/plugins/session-sync/…`, MCP `session_sync_<command>`, CLI `axf session-sync <command>` (plugin-commands@1),
voice through Molly: `sync`, `join`, `heartbeat`, `end`, `state`, `snapshot`, `claims`, `claim`, `release`, `send`,
`inbox`, `messages`, `request-work`, `offer`, `offers`, `respond`, `step`, `take-back`, `undo`, `replan`, `claim-job`,
`consistency`, `settings`, `approve-account` (Brett), `make-primary` (Brett), `audit`, `sync-file`. Who you are:
`X-Axf-Session` / `X-Axf-Account` / `X-Axf-Agent` headers (the CLI, the hook, claude.ai through axHub) or Brett's own
signed-in console click.

## Where things are

- Data: `.axf-console/plugins/session-sync/` (`link.json`, `link.journal.jsonl`, `audit.jsonl`, `posted.json`).
  `AXF_SESSION_LINK_FILE` / `AXF_SESSION_SYNC_DIR` move it (tests). A checkout's own identity: `.axf-console/session-sync/me.json`
  (`AXF_SESSION`, `AXF_ACCOUNT`, `AXF_AGENT`, `AXF_CLIENT` override).
- Repo: `_claude/sync/<project>.{json,md}` (kept on uninstall; `git rm` it), `.claude/commands/sync.md`, one line in CLAUDE.md.
- Tests: `python3 apps/console-web/plugins/session-sync/test.py` (routes, roles, SSE, approval through a fake axHub,
  Breakroom posting through a fake crew, consistency), `node apps/console-web/plugins/session-sync/test.mjs` (CLI: two
  sessions racing, offers, child builds, hook, commit check, sync file).
- Remove: `node apps/console-web/plugins/session-sync/uninstall.mjs --all`.
