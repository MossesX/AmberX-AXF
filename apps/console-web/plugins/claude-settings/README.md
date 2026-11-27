# Claude plugin (claude-settings@1)

Settings for Claude itself, kept on axHub so every session reads the same values. Page: Builds → Claude, and
Settings → Plugins → Claude; "Claude settings" in every context menu.

## Views

Saved per device (`claude/views.json` next to the settings document, claude-settings-view@1):

- **Tabs** (default): a `tab-group@1` row, id `claude-settings.tabs`. Position top / bottom / left / right; labels
  words / icons / both. They are the row's own overrides, so its right-click Settings changes the same thing.
- **Classic**: one page, collapsible sections.

Tabs are data: `tabs` in `registry.json` lists groups. A group no tab lists shows under Other.

| Tab | Holds |
| --- | --- |
| Approvals & veto | No wait, tool policy, longest pass |
| Builds | Builds, Verification |
| Talking | Talking |
| Notifications | Notifications |
| Follow & memory | Follow Amber, Memory and notes |

## Approvals & veto

axHub's live tool policy: allow / veto / confirm per tool or service, hold seconds, and Brett's default (hold only VPS
writes and account switches) as a plan he applies with one click. Rules: `policyDefaults` in `registry.json`.

Reads use the hub token. Writes go from the browser straight to axHub on Brett's own hub session; the console server,
sessions and tokens cannot write policy. Contract: `framework/spec/AXHUB-POLICY-API.md`. Until axHub has those routes
the tab says so and the rest of the page works.

## REST, MCP, CLI

| | REST (`/api/plugins/claude-settings/`) | MCP | CLI (`claude-settings.mjs`) |
| --- | --- | --- | --- |
| Settings | `GET/PUT settings` | `claude_settings_get`, `claude_settings_set` | `get`, `set k=v` |
| View | `GET/PUT view`, `GET views` | `claude_view_get`, `claude_view_set` | `view get\|set\|devices --device <id>` |
| Policy (read) | `GET policy`, `GET policy/plan` | `claude_policy_get`, `claude_policy_plan_get` | `policy get\|plan` |
| Longest pass | `GET/PUT passes` (Brett's session) | none | none |

`PUT policy` and `policy set` are always refused.

## Tests

`node test.mjs` (core, views, policy), `python3 test.py` where FastAPI is installed (the server).
