# Build report: ai-assistant-in-molly-console-drives-by-api-open

Brett (2026-11-10 23:46): "Give Molly and the AI assistant access to the API so she can drive the console, open screens and configure settings. Easy to reach, hands free. A setting in AI assistant."

Branch `claude/ai-assistant-in-molly-console-drives-by-api-open` · PR #488 · amends the AI assistant build (#482).

## Phases
- **Phase 1 (Fable, s1):** built everything. Commits `b8d45e820`, `cf8b2dded`, `3240baa29`.
- **Phase 2 (Opus, s2 + s3):** s2 repeats the request line from the split; phase 1 already covered it, so s2 re-verified the result end to end (no code change). s3: this report, THREADS row, push.

## What landed
1. **Console control as assistant tools** (group Console, owner only): `console_where`, `console_list`, `console_open`, `console_nav`, `console_setting_get`, `console_setting_set`, `console_action`, `build_file`, `control`. All go through the `control@1` capability (Token control plugin), so its gate and `confirmation_required` for destructive commands stay. Without control@1 the tools answer `not_implemented`.
2. **Setting values over the API:** control@1 `console.settings` gains `act read` / `act change`; console-command@1 gains op `setting`. Schema + fixtures regenerated; `check-console-commands` covers it.
3. **Hands-free voice:** one server switch (`handsFree` config), first panel of Settings → Plugins → AI assistant plus a mic toggle in every chat header. Wake or talk mode, spoken replies, screen wake lock.
4. **Molly:** new plugin `apps/molly/plugins/assistant` frames the console chat page and owns the assistant (`ai-assistant-host@1`), so only one copy renders.

## How it is reached without the UI
| Piece | Deep link | State | Actions |
|---|---|---|---|
| Hands-free voice | `console_open settings plugins/ai-assistant` (anchor `hands-free`) | `GET /api/plugins/ai-assistant/hands-free` · MCP `ai-assistant_hands-free-state` · CLI `axf ai-assistant hands-free-state` | `PUT …/hands-free` · MCP `ai-assistant_hands-free` · CLI `axf ai-assistant hands-free` · action `ai-assistant.hands-free[:on\|off]` · AmberX voice via the plugin command |
| Console tool group | same settings tab | `GET …/tools` | `PUT …/config {"tools":{"console":bool}}` |
| Setting values | `console_open settings <tab>` | `control act console.settings <key> read` | `… change {value}` |
| Molly window | `molly-assistant.open` / `.page` | console plugin `/status` | `molly-assistant.hands-free[:on\|off]` |

## Checks (phase 2 re-run)
- `python3 apps/console-web/plugins/ai-assistant/test.py`: 193 ✓, all console-tool and hands-free checks pass. One FAIL, "chat folders removed": pre-existing, caused by other sessions' `/tmp/axf-cli-chat-*` folders on this VPS; it fails the same way on main.
- `check-theme` ✓ · `check-controls` ✓ · `check-toolbars` ✓ · `check-chrome-assets` ✓ · `check-console-commands` ✓ 75 · `plugin-lifecycle check ai-assistant` ✓.
- Phase 1 also ran `check-control` ✓ 371 and both `tsc --noEmit` (console-web, Molly) ✓.

## UI Review (waiting for Brett)
- `r-20261111-r9jdg01`: chat header hands-free mic toggle (desktop, phone, inside Molly).
- `r-20261111-v2asl01`: Hands-free voice settings panel (desktop + phone).

## Gaps / deferred
- Browsers can't keep listening with the screen off, so hands-free keeps the screen on instead. Real screen-off listening needs the AmberX native recognizer, which is deferred in `framework/spec/PORTING.md` along with the Kotlin twins.
- `build_file` has no priority field (planner.builds has none); priority is set in the orchestrator.
