# Build report: ai-assistant-in-molly-console-drives-by-api-open

Brett (2026-11-10 23:46): "Give Molly and the AI assistant access to the API so she can drive the console, open screens
and configure settings. Easy to reach, hands free. A setting in AI assistant."

Branch `claude/ai-assistant-in-molly-console-drives-by-api-open` · PR #488 · Fable s1, Opus s2–s3.

## What landed
- **Console tools for the assistant** (tool group Console, owner only), through control@1 with its gate kept:
  `console_where`, `console_list`, `console_open` (screen / dialog / settings + anchor), `console_nav`,
  `console_setting_get`, `console_setting_set`, `console_action`, `build_file`, `control` (any control@1 command).
  Destructive commands answer `confirmation_required`; the assistant resends only after an explicit yes.
- **Setting values by API:** control@1 `console.settings` gains `act read` / `act change`; console-command@1 gains op
  `setting`. Schema snapshot and fixtures regenerated.
- **Hands-free voice:** one server switch. It sits first in Settings → Plugins → AI assistant and as a mic toggle in every
  chat header. Wake or talk mode, spoken replies, screen wake lock on phones.
- **Molly:** new plugin `apps/molly/plugins/assistant` frames the console plugin's chat page and owns it
  (`ai-assistant-host@1`), so the console never draws a second copy inside Molly.

## How each piece is reached without the UI
| Piece | Deep link | State | Actions |
|---|---|---|---|
| Hands-free voice | `console_open settings plugins/ai-assistant` (anchor `hands-free`) | `GET /api/plugins/ai-assistant/hands-free` · MCP `ai-assistant_hands-free-state` · `axf ai-assistant hands-free-state` | `PUT …/hands-free {on, toggle, mode, wakeWords, speak, keepScreenOn}` · MCP `ai-assistant_hands-free` · `axf ai-assistant hands-free` · action `ai-assistant.hands-free[:on|off]` (menus, search, `console_action`, voice) |
| Console tool group | `console_open settings plugins/ai-assistant` | `GET …/tools` · MCP `ai-assistant_tools` | `PUT …/config {"tools":{"console":false}}` |
| Console setting values | `console_open settings <tab>` | `control act console.settings <key> read` (REST / MCP / CLI) | `… change {value}` (needs `control.console.write`) |
| Molly assistant window | Molly actions `molly-assistant.open`, `molly-assistant.page` | console plugin `/status` | `molly-assistant.hands-free[:on|off]` |

## Checks (s2, Opus)
- `test.py` 193 ✓; one known failure ("chat folders removed") from other sessions' `/tmp/axf-cli-chat-*` folders, also on main.
- Fixed in s2: the fake `claude` in `test.py` recorded the background title call's argv over the chat turn's
  (flaky `--allowedTools` crash); console-web `tsc` errors in `web/host.ts` (message narrowing) and `web/index.tsx`
  (toast tone `danger`).
- check-theme, check-controls, check-toolbars, check-chrome-assets ✓ · plugin-lifecycle (ai-assistant, Molly assistant) ✓
- spec check-control 371 ✓ · check-console-commands 75 ✓ · console-web and Molly `tsc --noEmit` ✓

## Open
- UI Review: `r-20261111-r9jdg01` (chat header mic toggle), `r-20261111-v2asl01` (Hands-free voice panel).
- Deferred (PORTING.md): Kotlin twins, AmberX native screen-off listening.
