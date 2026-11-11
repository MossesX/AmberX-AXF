# Per-agent API control: switch in each employee's control panel; Amber and Molly on by default

Build `per-agent-api-control-switch-in-each-employee-s` · Phase 1 · Opus · branch `claude/per-agent-api-control-switch-in-each-employee-s`

## Brett said (verbatim)
> I want the individual agents and the AI assistant to have API access, not all of them, just a couple. I need to be able to give it to them in their employee control panel. Give Amber and Molly control by default.

## What was built
- **Permission (agent-api-access@1)**: console API control is a per-agent grant, off by default. Scopes: `screens` (open screens), `settings` (change settings), `commands` (run commands), `builds` (file/queue builds). Amber (the AI assistant itself, no agent picked) and Molly are on with every scope until someone changes them. Stored in the Agent manager data folder (`api-access.json`) with an audit of every change (who, when, from, to, why, via what). `apps/console-web/plugins/agent-manager/server/apiaccess.py`.
- **Capability `axf.agent-api@1`** (Agent manager): `grant`, `scopes`, `allowed`, `set`, `list`, `audit`. The roster covers Amber, every Agent manager agent and every crew member (through `axf.swarm-roster@1` when the Breakroom is installed).
- **AI assistant** uses the permissions of the agent picked in its chat: console API tools (named by an `apiScope` on the tool, or by name: `console_open…`, `console_settings…`, `console_command…`, `build_queue…`) are offered only in the scopes that agent holds; admins only. The system prompt says what it may do, or that Brett can switch it on in its control panel. The `start` event carries `apiScopes`. Without an Agent manager the same defaults apply (Amber and Molly on).
- **UI**:
  - Agent manager → new **API control** tab: every employee with its grant; pick one to change it.
  - Under each agent's editor (its control panel): the **API control** switch, scope ticks, Why (kept in the audit), Reset to default, the change history.
  - On each Crew employee card and profile (slot `swarm.agent.actions`): a switch showing the grant and when/who last changed it, and a Scopes… button that opens the panel.

## How each part is reached (everything has an API)
| What | Deep link | REST | Plugin command (MCP / CLI / voice) |
|---|---|---|---|
| Who has API control | action `agent-manager.api-control` | `GET /api/plugins/agent-manager/api-access` | `agent-manager/api-control` |
| One agent's grant + history | action `agent-manager.api-control:<id>` | `GET …/api-access/{id}` | `agent-manager/api-control-get` |
| Give / take, pick scopes | same | `PUT …/api-access/{id}` `{on, scopes?, reason?}` | `agent-manager/api-control-set` ("give Rio API control for screens and settings") |
| Reset to default | same | `POST …/api-access/{id}/reset` | `agent-manager/api-control-reset` (confirm) |
| Audit | same | `GET …/api-access/audit?agent=` | `agent-manager/api-control-audit` |
| Open the tab | – | – | `agent-manager/api-control-open` (`args: [agentId]`) |

CLI: `axf agent-manager api-control-set --aid rio --on true`. Voice (AmberX) reaches the same plugin commands.

## Tests
- `python3 apps/console-web/plugins/agent-manager/test.py`: 193 checks pass (15 new: defaults, scopes, audit, refusals, reset).
- `python3 apps/console-web/plugins/ai-assistant/test.py`: the 5 new gate checks pass. The suite then stops at `chat folders removed` (it counts `axf-cli-chat-*` folders in the shared /tmp, which other sessions on the VPS create) and sometimes at `chat turn: no tools of any kind reach the CLI`. Both fail the same way on the unchanged code (checked with the HEAD files), so this build didn't cause them.
- `node apps/console-web/plugins/plugin-commands/test.mjs` green; `commands.mjs check agent-manager` 38 commands; control@1 plans for set / open / read checked.
- `tsc --noEmit` (console-web) clean; check-theme, check-controls, check-toolbars, check-chrome-assets, plugin-lifecycle check agent-manager all green.

## Open points
- **Screenshots / UI Review**: not taken. The local console started by `rebuild-shots.mjs` waits for axHub, and the browser blocks a 127.0.0.1 origin (CORS), so it never renders. The worktree also had no Playwright (I linked another worktree's copy). The UI goes to UI Review from a session that has a local hub, or after deploy.
- **Sibling build** `ai-assistant-in-molly-console-drives-by-api-open` (running in parallel) adds the console-control tools. They are gated automatically if they use the names above or set `"apiScope"` on each tool spec. Its "API access" setting in the AI assistant should read `axf.agent-api@1` rather than store its own on/off.
- **Crew headless runs**: crew members (Rio, Kat, …) can now hold a grant (shown and switchable on their cards), but the swarm runner doesn't pass console tools to headless runs yet. Wiring that means the runner reads the grant (`GET /api-access/{id}`) when it builds the allowed tools. Follow-up.
- `by` on REST/command changes defaults to `brett` (the console token is Brett's); callers can pass `by` / `source`.
