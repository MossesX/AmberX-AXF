# Prompting engine: control panel to create events that pop decisions and run tools, macros or pipelines

Build `prompting-engine-control-panel-to-create`, branch `claude/prompting-engine-control-panel-to-create`.
Phase 1 (s1–s3) on Fable, phase 2 (s4–s8) on Opus (downgrade, recorded on the build).

Brett said (2026-11-13 18:15):
> like a veto approve control panel, we'll be able to create a prompting event, it could be for anything, a general
> prompting engine which will run set tools and maybe some macros or pipelines

## What it is
A prompt event = trigger (any event a source registers) + conditions (all / any / not, every operator) + limits
(cooldown, dedupe, per hour) + what to ask Brett (approve / deny, veto countdown, pick from options, text) + what runs
on each answer (set tools, console commands, MCP and axHub calls, macros, pipelines with gates, chained events).
Contract `prompt-engine@1` (`framework/core/engines/prompt-engine.mjs`, pure), runner + console plugin
`apps/console-web/plugins/prompt-engine`, panel under Builds → Prompt engine.

## Phase 2 (this session)
- **s4 Event feeds.** Every trigger source now actually fires. `axf.prompt-engine@1` gained `emit()` (fire and don't
  wait, nothing while the plugin is off). UI Review fires `ui-review.submitted` / `ui-review.decided`; the push banner
  fires `merge.clash` / `merge.ci-failed` when a merge or Pull main in fails; the approvals banner provides
  `axf.approvals-feed@1` (axHub's approvals feed, read only, with the console's owner sign-in) and the engine's tick
  fires `approval.held` / `approval.waiting` once per id; `POST /voice` fires `voice.phrase`. Builds, webhooks,
  schedules and custom events were already wired.
- **s5 Answer actions.** New tool actions `mcp.call` (any MCP server the MCP client knows) and `axhub.call` (an axHub
  service; refused without `reason { title, description }`). Tool sets govern them as `mcp.<server>.<tool>` and
  `axhub.<service>[.<tool>]`. Fixture regenerated.
- **s6 Control panel.** Test-fire (live, confirm first), History per event (History gains an Event filter), a
  Templates gallery (UI Review, build failed, held call veto, merge clash, model upgrade, watchdog, service down, daily
  digest, shipped). Listing, creating, editing, on / off, dry Test and delete were already there.
- **s7 Everything off the UI.** "when a build fails, ask me to retry or archive" → the rule (`rule-from-words`; a
  template wins when one fits; preview unless `save`). Deep links `?axf-view=prompt-engine&tab=…&rule=…&prompt=…`,
  console actions `prompt-engine.history` / `.templates`, help entries.

## How each feature is reached
| Feature | REST (`/api/plugins/prompt-engine`) | MCP / CLI / voice | Console |
|---|---|---|---|
| Rule from words | `POST /rules/from-words {text, save?}` | `prompt-engine_rule-from-words`, `axf prompt-engine rule-from-words --text "…"`, say it to AmberX | Events → Say what should happen |
| Test-fire | `POST /rules/{id}/test {live: true}` | `test-rule` | Events → Test-fire |
| Event history | `GET /history?rule=<id>` | `history` | Events → History; `&tab=history&rule=<id>` |
| Templates | `GET /templates`, `POST /templates/{id}/use` | `templates`, `use-template` | Events → Templates; action `prompt-engine.templates` |
| Voice trigger | `POST /voice {phrase}` | `voice` | — |
| MCP / axHub actions | in rules, macros, pipelines | same | Builder action picker |

All MCP / CLI / voice entries come from `plugin.json` commands through plugin-commands@1.

## Checks
`check-prompt-engine` 50, runner 16 groups, server 79, ui-review 229, push-banner 194, approvals-banner 58;
`tsc`, check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, plugin-lifecycle and
plugin-commands check pass. `theme-swap.mjs` (needs the built console) was not run in this session; CI runs it.

## Open
- Held calls reach the engine only while the console has its axHub owner sign-in (`AXF_HUB_RELAY_USER` /
  `AXF_HUB_RELAY_PASSWORD`); the existing Approvals relay systems-check item covers that key.
- Email / SMS / call outputs stay "keys needed" until axHub has those connectors.
- Kotlin twin of prompt-engine@1 is deferred (framework/spec/PORTING.md).
