# Rebuild Gizmo: Claude or your Ollama, per chat

Build `rebuild-gizmo-from-scratch-full-claude-style-cha`, Phase 1 (Opus), Nov 12 2026. Branch `claude/rebuild-gizmo-from-scratch-full-claude-style-cha`.

Brett (Nov 10): "You might as well just build it over again and make it sick. Make it better. It's gotta be a full-blown Claude interface where I can either talk to Claude or talk to my Ollama. The Gizmo plugin is trash, the chat is trash, it used to be way better."

## What changed

**Who answers, per chat (brains@1).** New `apps/console-web/plugins/ai-assistant/server/brains.py` and routes on the console assistant:

| Route | Does |
|---|---|
| `GET /api/plugins/ai-assistant/brains[?check=false]` | Claude Opus, Claude Fable, Mistral Small 24B (local), Mistral 7B (local), each with `ready` + `why` (Ollama reachable? model pulled? Claude provider set up?) |
| `POST …/brains/local` | Creates / repoints the `amberx-llama` provider profile (Ollama, OpenAI-compatible `/v1`, no key). Admin only, idempotent |
| `GET …/conversations/{id}/brain` | The chat's brain |
| `PUT …/conversations/{id}/brain` `{brain}` | Switch it. Local brains pin the `amberx-llama` profile + model and start in chat mode; Claude brains clear the profile and set the model |
| `POST …/conversations` `{brain}` | New chat on a brain |

The Ollama URL is `AXF_OLLAMA_URL` (default `http://amberx-llama:11434`, internal only). The profile is created on first use.

**Gizmo in AmberX (app + web app).**
- Claude | Ollama switch in the title bar. A model chip by the message box (Opus / Fable, or Mistral 24B / 7B). Each family remembers the last model used.
- A red note when the picked model isn't ready, with the reason, plus "Add it to the assistant" and "Check again".
- The chat list docks beside the chat when the pane is 860 px or wider (setting: "Keep the chat list open on a wide screen"). On a phone it's still a drawer.
- History search goes to the server and searches every message, not only titles. Ctrl/Cmd+K opens search, Ctrl/Cmd+Shift+O starts a new chat.
- "Copy a link to this chat".
- On a local model the daily cap is skipped and so is the cost warning (the local model is free).
- Settings → Plugins → Gizmo: "Who answers new chats" replaces "Model for new chats". The old `companion.model` value still counts.
- Kept everything that was there: streaming live sessions, markdown/code, images/files/photo, edit + resend, regenerate, read aloud, talk mode and push to talk, tool cards, export, axHub mirror, window mode.

**Console assistant chat.** The same Claude | Ollama switch in the title bar, plus `/brain claude|fable|ollama|local-7b`.

## How each part is reached (API)

- **Deep link:** `?gizmo=new|talk|<conversation id>&brain=<id>&q=<first message>` on the AmberX app / web app URL. Action `companion.link [target, brain, q]` (works with `console_action` and other plugins).
- **State:** `GET …/brains` and `GET …/conversations/{id}/brain`, both REST.
- **Actions:** REST routes above. MCP and CLI get them through plugin-commands@1 (`commands.auto` on the ai-assistant plugin exposes every route). AmberX actions: `companion.brain [id]`, `companion.local`, `companion.claude`.
- **Voice (AmberX):** "gizmo use ollama", "gizmo go local", "talk to my ollama", "gizmo use claude", "gizmo back to claude". The earlier phrases still work.

## Tests

- `npx tsx apps/amberx-droid/test.mjs`: 2339/2339 pass. New checks cover brains, deep-link parsing and the old-setting fallback.
- `apps/console-web/plugins/ai-assistant/test.py`: 213/213 pass, 4 runs in a row, with a private TMPDIR. 10 of the checks are new brains checks.
  - Fixed an existing flake on main: the background chat-title CLI call raced into the fake CLI's call log and argv file. It failed on main too.
  - Run it with a private `TMPDIR`. The shared `/tmp` on the VPS holds old `axf-cli-chat-*` folders from other runs, and the "chat folders removed" check trips on them.
- `tsc --noEmit` is clean for amberx-droid and console-web.
- check-theme, check-controls, check-toolbars, check-chrome-assets and `plugin-lifecycle check ai-assistant` all pass.

## Not done / left

- **Screenshots / UI Review:** not taken. Headless, the AmberX web app stops at "Waiting for axHub" because it needs a hub session cookie, and there's no dev bypass. The PR waits for shots from a signed-in session.
- **Ollama container:** this build doesn't deploy `amberx-llama` or pull models. If it isn't up, the switch says "isn't reachable". If a model is missing, it shows `ollama pull <model>`.
- **Tools on local models:** local chats start in chat mode. The tool-mode chip still turns tools on, but tool rounds on a CPU model are slow.
- **Android native (Kotlin):** no new work. The companion is the web plugin inside the APK.
