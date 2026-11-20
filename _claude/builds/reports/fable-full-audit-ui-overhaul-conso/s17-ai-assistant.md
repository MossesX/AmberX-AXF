# s17: console AI assistant (Amber): found and fixed

Scope: the ai-assistant plugin (chat, chat-mode router, turn engine, built-in tools), the shared Python host runtime
(`framework/python/axf/assistant_host/providers.py`) and the Gizmo/Molly console skills in the agent manager. The full
Amber assistant plan stays its own build.

## Found

| # | Impact | Finding | Evidence |
|---|--------|---------|----------|
| 1 | High | The console chat could not drive the console. Amber and the agents had repo, utility and web tools, no console tools, so "open X" or "go to settings" got "I can't tap your screen" or a walkthrough block that the chat does not render. | Gizmo chat Nov 7 ("I don't have a way to tap your screen"), chat Nov 10 ("Give molly API access to open screens and drive settings" → "I can't do that from this chat"). |
| 2 | Medium | Chat-mode routing dropped navigation requests. `_LEAD` strips "go" as a filler word, so "go to settings" was checked as "to settings" and stayed a plain chat turn with no tools. | `chatmode._sentences` |
| 3 | Medium | Leaked temp folders. A CLI chat turn's `axf-cli-chat-*` / `axf-cli-jail-*` / `axf-bridge-*` folder is removed when the turn ends, but a console restart mid-turn leaves it behind. | 8 stale folders in /tmp (Nov 10 to Nov 17). |
| 4 | Medium | The self-test failed on any machine with those leftovers ("chat folders removed" checked the shared /tmp). | `test.py` stopped at "FAIL: chat folders removed" before the fix. |
| 5 | Medium | Double send: Enter pressed twice before the next render (or voice and a tap together) could start two turns. Text sent while a reply ran was cleared and lost. | `chat.tsx` `run` / `send` |
| 6 | Low | An unhandled promise rejection when the running-session lookup failed while a conversation opened. | `chat.tsx` `open` → `attach` |
| 6b | Medium (UI) | On a phone, picking a conversation (or New chat) left the slide-over list covering the chat; it only closed in the dialog. | Phone screenshot during this step |
| 7 | Low (UI) | Raw icon-only buttons with a tooltip only (no `aria-label`, no console control target). Attach and New chat both used the plus icon. Replies always showed the sparkles avatar, never the agent's icon. Plugin CSS stripped the suggestion chips' border, so they looked like plain text. The composer placeholder (key hints) was cut off on a phone. | Phone screenshot before the fix |

## Fixed (one commit each)

1. **Console tools** (`ai-assistant: Amber and agents drive the open console`). New built-in group `console`:
   console_open, console_settings, console_dialog, console_back, console_where, console_list. They send the
   same control@1 commands as the console's MCP tools through the `console-commands@1` capability (optional in plugin.json,
   never by folder name). Grants are `control.console.read` and `control.console.navigate` only. There is no console_action
   tool: the control@1 gate asks `control.console.write` for every `console.actions` run, even an action that only
   navigates (checked against `console.mjs run`), so offering one would mean granting write. The tools are for the owner only (hub users never get the
   group) and are offered only while the Console commands plugin is on. There is a switch in Settings → Plugins → AI
   assistant → Tools (on by default). The system prompt tells the model to navigate rather than describe taps. The
   Gizmo/Molly "Drive the console" skills now put the tools first and keep the walkthrough for apps without them.
   console_screenshot is left out on purpose: these tool results are text only. console_where gives the screen state.
2. **Routing**: each sentence is checked at every strip step, so "go to" and "go back" count. New default action words:
   go to, go back, go home, take me, navigate, where am i. Config schema 1 → 2 adds them once to a saved word list, and a
   word Brett removes afterwards stays removed.
3. **Temp sweep** (`assistant host: sweep CLI temp folders…`): `providers.sweep_stale_temp()` removes those folders once
   they are older than the CLI deadline plus 5 minutes. It runs at most once an hour, from the CLI provider.
4. **Self-test**: it runs in its own temp folder and gained 15 checks (console tools, grants, gate refusal, owner-only,
   routing, end-to-end tool turn, migration, sweep). 218 checks pass.
5. **Chat UI** (`ai-assistant: chat UI fixes and tightening`, plus the phone list fix): fixes for findings 5, 6, 6b and 7. The icon buttons are now
   framework IconButtons, Attach has the file icon, replies show the agent's icon, the suggestions are framework buttons
   (the restyle rule is gone), the placeholder is short and the key hints are in its tooltip. The welcome text says the
   console can be driven from the chat. One new help entry ("Remove this model") keeps help coverage at 100%.

## Checks

- `python3 apps/console-web/plugins/ai-assistant/test.py`: 218 passed
- `python3 apps/console-web/plugins/agent-manager/test.py`: 178 passed
- `python3 framework/python/axf/assistant_host/test.py`: 58 passed
- `tsc --noEmit` (console-web): clean, apart from the generated `inventory.json`, which the build writes
- check-theme, check-controls, check-toolbars, check-chrome-assets, help-coverage --check, plugin-lifecycle (agent-manager): pass

## Not done here (left for the full Amber assistant build)

- Screenshots in chat (console_screenshot needs image tool results, provider by provider).
- Console actions from the chat. The gate would need a navigate-only lane for `console.actions` (the inner check already
  knows each action's effect), or an approval-card flow for actions that change data.
- No new Android/Kotlin work. The assistant host is Python-only, so there is no twin to record.
