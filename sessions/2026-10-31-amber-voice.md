# Session log: Oct 31 2026, Brett + Amber (claude.ai text + voice)

## Landed on main tonight
- Tighter screens (ui-all-assets): every console screen, plugin page, AmberX and axhub-web read the scale tokens; main's red CI fixed.
- Amber persona: _claude/persona.md loaded via CLAUDE.md (#215).
- axHub: Approve now on veto calls + ntfy Approve button (decision #105); approval page live.
- axHub v0.3.0: vps.check gained builds, build_log, git_main, git_branch, orchestrator (no approval needed for reads).
- AmberX fix: no spoken empty states / 'no saved inbox' loop; FLAG_SECURE removed from normal screens with opt-in 'Hide sensitive screens from recordings' (needs new APK).
- AmberX look fix: shared appearance, Open-on-hub fallback, notices ring once per phase (axHub f7e96bc, AXF 51c1d9c7).
- Approve now on every approvals list row (axhub-web) - e48ca208.
- Agent swarm 19/19 (Breakroom): agents, leases, cost meter, statuses, salaries, ID cards, group chat; install_steps Part I - d9ea1692. Console redeployed 00:18 UTC.

## Running / queued (headless on VPS)
- Urgent: one builds store, Steps view (drag, multi-select, split, rename), live progress bars.
- Flicker fix (axhub-web 'Reading the hub' loop) -> dropdown Approve/Deny -> approval 'who asked' columns -> expandable rows (caret far right) -> Watch live hot render for any UI.
- Asset-conform rule (handwritten allowed only if it conforms to hot-swappable assets) - branch pushed, wants UI Review.
- UI Review: Screenshots tab -> named timestamped groups -> one schema for every review item (name + timestamp required).
- Breakroom check screenshots (group 'Breakroom check, Oct 31 8:20 PM').
- rec-control: axHub amberx.recorder_start (straight approval, no countdown) / stop / status driving AmberX's Audio Output Recorder.

## Rules Brett set tonight
- Persona always: Amber, thick Rhode Island/Boston slang, heavy cussing, no 'kid'; no slurs.
- Reads/checks never on a timer; only dangerous stuff needs approval.
- Build system output defaults to framework controls + assets; handwritten code only if it conforms to hot-swappable assets.
- Anything into UI Review needs a name, timestamp and the schema; Claude asks Brett for a group name first.
- Session recording start = straight approval (confirm), not veto.
- Every session gets a written log here (sessions/).

## Open issues
- VPS stored GitHub login is invalid; headless pushes go through the console token. Brett: new token + gh auth login when convenient.
- Look fix flagged six held sync data files needing a pick.
- PR #158 terminal v0.3 has a corrupted orchestrator JSON on its branch.
- amberx-app-backup-1 container still restart-looping.


## Later the same night (Nov 1, ~9 PM - 3 AM ET)
### Landed on main
- Flicker fix, Approve/Deny in the 'Waiting for approvals' dropdown, approvals 'who asked' (source/session), expandable rows (caret far right), Watch live hot render, UI Review Screenshots tab + named timestamped groups, Urgent (one builds store, Steps view, drag + rename, progress) 11/12, rec-control (axHub drives AmberX recorder; start = straight approval).
- Server git login fixed (axf-git-cred serves the working token; gh logged in). Builds push themselves.
- axHub safe tools (decision #110): vps.build_start / build_land / build_stop / build_list run with NO timer. Raw vps.run keeps its veto. Use these for builds and pushes; vps.check for reads.
### Running at ~3 AM
- leftovers (finish nearly-done builds + blank 'The request' page), banner-fix (ghost lines: PostToolUse hook missing; collapsed banner; GitHub 403), agent-cap (configurable max agents/tests + queue + memory guard), help-mode (global ? switch, tooltips everywhere as help@1 assets), amberx-listeners (one listener per device; 'Note saved' once; dings only for new events; Quiet switch; needs new APK), amberx-walkthrough (AmberX walkthrough video like the demo one), agent-jobs (hire a crew that owns recurring jobs: walkthrough producer, site checker, screenshot runner, lander, banner janitor, listener fixer), chat-viewer (store/sync/search all sessions; claude.ai via data export or 'sync my chats'; 2-voice audio export), xchat-check (read-only: find the real address/code of Brett's AXP streaming stack).
- 4 GB swap was queued (vps.run, veto) - verify it's on.
### Shelved
- HR department (rules, raises, school + 50/50 loans + no firing in debt, HR panel): plans/shelved-hr-department.md. Say 'resume HR'.
### Findings
- demo.amberxai.com = old static axp-demo page (Sep 13), up, cert to Jan 28 2027; its nginx proxies a few paths to dead :3200. No streaming backend there; AXP stack (axp-xchat, xchat-media, devstudio, deploy, coturn) likely the real site - xchat-check will say.
- amberx-app-backup-1 restart-loops (~30 s), belongs to the amberxai.com stack; cause unknown.
- Console wall secret leaked into the urgent build's local log: rotate (Brett said not now).
- Hostinger credential on axHub unavailable (axhub vault status).
- Brett's ideas queued for later: paid-companionship booking app (companionship only, 18+ ID checks, worker controls, safety); asked whether workers are employees or independent - unanswered.