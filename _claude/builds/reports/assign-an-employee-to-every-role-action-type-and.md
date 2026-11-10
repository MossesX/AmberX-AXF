# Assign an employee to every role, action type and app (assign-an-employee-to-every-role-action-type-and)

Brett said (2026-11-09 23:50, verbatim):
> The orchestrator has somebody who runs it, one of my employees. Assign employees to every single type of action and app, so I can understand easily what's what. If it's something they did, it will have their avatar next to it, like in a text message. You'll be able to click that person with hooks to the employee's information, their history. And I need a way to see who has which job.

Phase 1 (Opus, headless VPS). Branch `claude/assign-an-employee-to-every-role-action-type-and`.

## What was built

| Brett asked | Where it is |
|---|---|
| "The orchestrator has somebody who runs it, one of my employees" | **Ozzie Orchestrator** holds the `orchestrator` role; **Dispatch Dot** the dispatcher. A "Run by Ozzie Orchestrator" chip with his face sits on every Builds toolbar (slot `builds.toolbar`); tap = his profile. |
| "Assign employees to every single type of action and app" | `apps/console-web/plugins/agent-swarm/agents/roles.json` (crew-roles@1): 24 roles in three groups. Apps: Dev Console (Console Connie), AmberX (Gizmo), Molly (Molly Minder), axHub (Hub Hubert), VoiceVault (Earl), Walkthrough Studio (Reel Rhonda), Expenses (Accounts Acey). Actions: builds (Build Bea), approvals & holds (Approval Abby), fixes & CI (Greenlight Gina), deploys (Deploy Dex), accounts & keys (Accounts Acey), notifications (Notify Nora), git & merges (Merge Max), landing (Lenny), AI replies (Gizmo), tests (Tex), screenshots (Sully), site checks (Paulie), banner cleanup (Joey), themes (Tia), docs (Doc). Existing crew were used where they fit; ten were hired (Ozzie, Dot, Connie, Molly Minder, Hubert, Bea, Abby, Dex, Acey, Nora) with names, drawn avatars, bios and catchphrases. Patches is not on the list (retired Nov 3). |
| "If it's something they did, it will have their avatar next to it, like in a text message" | Activity banner: every entry carries `actor` (server, capability `axf.crew-roles@1`) and shows the employee's face on the left with their name first on the line, the role after it (hidden on phones to keep one line). |
| "click that person with hooks to the employee's information, their history" | Tapping the face runs `agent-swarm.profile:<id>`: the employee card with a new **Jobs** section (roles held) and **Activity history** (every Activity Monitor entry they did, each state, newest first), alongside the existing current work, status history, pay, chat and runs. Right-click / long-press on the face still gives the Crew's agent menu. |
| "I need a way to see who has which job" | Breakroom → **Who does what** tab: every role grouped (Orchestrator, Apps, Actions), the holder's face (tap = profile), a picker to reassign, a "reassigned" chip, and the reassignment history. Reassignments are posted in the group chat. |

### How an entry finds its employee
`web/roles-core.mjs` (pure): a crew member the entry names (`by`, `agent`, "Agent: Name") wins; else the first role whose id prefix, then source, then kind, then a whole word of the title fits (part-words never match: "ci" is not in "decision"); else the orchestrator. Role holders are `jobsOnly` with home skill `crew-roles`: they never get build steps, and the job-type router no longer falls back to them (`jobs-core.mjs` `ROLE_SKILL`).

### Data
Catalogue in the plugin folder; Brett's reassignments in `.axf-console/plugins/agent-swarm/roles.json`; each employee's activity log in `.axf-console/plugins/agent-swarm/activity.jsonl` (one line per entry state, capped at 5000). The swarm service calls node only when an entry id/state it has not seen appears; answers are cached.

## Full API control

| Feature | REST (console API) | MCP / voice (plugin commands) | CLI | Deep link |
|---|---|---|---|---|
| The board | `GET /api/plugins/agent-swarm/roles` | `roles` | `swarm.mjs roles` | action `agent-swarm.roles` |
| Reassign | `POST …/roles/assign {role, agent, note?}` | `assign-role` (input schema declared) | `swarm.mjs assign <role> <agent> [note]` | board picker |
| Who did an entry | `GET …/roles/who?id=&source=&kind=&title=&by=` | `who-did` | `swarm.mjs who '<json>' [--record]` | — |
| Employee jobs + history | `GET …/agents/{agent}/history` | `agent-history` | `swarm.mjs history <agent>` | action `agent-swarm.profile:<agent>` |
| Avatars on entries | `GET /api/plugins/activity/items` (each item's `actor`) | activity `items` read | — | — |

## Tests
- `node apps/console-web/plugins/agent-swarm/test.mjs`: 107 passed (7 new: catalogue, holders, resolver order, named actor, reassign/history/fallback, board/log, CLI in a scratch folder).
- `apps/console-web/plugins/activity/test.py`: 145 passed (3 new: actor set, no service, failing service).
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-model-policy, check-swarm (252), plugin-commands check: green. `tsc --noEmit` on console-web: clean.
- `plugin-lifecycle check agent-swarm` flags only `.axf-focus.json`, the git-ignored live-preview file the focus command writes in this worktree; not in the repo.

## Left / notes
- **Screenshots**: not taken. This headless session has no running console on the branch to capture; the UI Review submission (desktop + phone: Activity banner rows with faces, Who does what, a profile's Jobs + Activity history, the Builds toolbar chip) is still owed before the PR is called ready.
- Activity history is logged when the Activity banner's feed is read (any open console polls it every 4 s); work that starts and ends with no console open is not in the history. The employee's runs are on the profile regardless.
- The Activity Monitor build (`activity-monitor-plugin-live-plain-english-log-o`) runs in parallel: its log can show faces by calling `axf.crew-roles@1` `annotate(items)` (or reading `actor` from the activity feed) and opening `agent-swarm.profile:<id>`.
- Kotlin twin of roles-core: deferred (Android on hold).
