# AI assistant = Gizmo moved to the console (`ai-assistant-gizmo-moved-to-the-console-remove-t`)

Brett (Nov 10 2026): "Let's figure out the assistant first. I need to get rid of the assistant since we have Gizmo. I want
to move the Gizmo plugin that is the chat in AmberX to the console and be a console plugin named AI assistant."

## What changed
- **Old console chat removed**: `plugins/ai-assistant/web/chat.tsx` (sidebar chat, compare dialog, tags/archive UI,
  slash prompts) and the stand-in mic `voicemic.tsx` are gone.
- **Gizmo's chat is the console plugin "AI assistant"** (`web/gizmo.tsx`, screen id `ai-assistant`, dialog
  `ai-assistant.chat`): Gizmo's Claude-style chat ported from `apps/amberx-droid/src/plugins/companion/web/Chat.tsx`:
  chats drawer (search, day groups, pin, rename, delete), streaming replies that reattach after a reload, markdown and
  code, tool cards, write-mode approval cards (kept from the old chat), images and text files, edit and resend,
  regenerate, copy, read aloud, export, tools chip (Auto / Chat only / Tools on), axHub approvals badge.
- **Per-chat model switch** (`web/models.ts`): Claude Opus / Fable (model policy) on the Claude profile, or any model of
  an enabled Ollama profile. Stored on the conversation (`profileId` + `model`), so AmberX sees the same choice.
- **Agent picker** in the title bar: Gizmo by default when the agent manager has him, else the default agent; any agent
  from the agents section; "Train and edit agents…" runs the new generic action `agents.open` (agent manager registers
  it; the assistant never names that plugin).
- **Voice chat** (`web/talk.ts`): push to talk and hands-free talk mode in the browser (Web Speech), replies spoken
  sentence by sentence, say "stop" to cut in. Settings → Plugins → AI assistant → Voice chat. The `assistant.mic` /
  `assistant.head` slots and the `axf:assistant.*` voice bridge events stay, so the Agent voice plugin keeps working.
- **Console control tools** for the assistant (`server/tools.py`, group `console`, admins only, on by default):
  `console_open`, `console_settings`, `console_action`, `console_where`, `console_list` through `console-commands@1`
  (same wire as the console MCP tools), `build_file` / `build_status` through `axf.build-dispatch@1`.
- **Kept**: the engine (`server/`), providers, setup wizard, settings, usage, live sessions, hub-user page. AmberX's Gizmo
  is a client of this engine, so removing it would have broken Gizmo.

## API (every surface the same)
- Deep link: `console_open ai-assistant` / `console_show screen:ai-assistant` / `nav:ai-assistant`; dialog `ai-assistant.chat`.
- Actions (MCP `console_action`, plugin commands for CLI and voice): `ai-assistant.open[:prompt]`, `ai-assistant.new`,
  `ai-assistant.talk`, `ai-assistant.model:<claude:opus|claude:fable|ollama|model>`, `ai-assistant.agent:<id>`,
  `ai.chat.start:<json>`.
- State and every chat action over REST: `/api/plugins/ai-assistant/status`, `/conversations` (create, list, read,
  patch settings incl. `agentId`/`profileId`/`model`/`toolMode`, delete, send, stop, export).
- Settings keys `ai-assistant.talk.*` through control@1 / Settings.

## AmberX
AmberX's Gizmo (`companion` plugin) stays as the phone client: it talks to this same plugin through AmberX's server, so
every chat started in the console continues in AmberX and back. Its native talk service (screen off, notification Stop)
is Android-only and stays there. Not removed from AmberX: that would take away talk mode on the phone.

## Checks
- `apps/console-web` `tsc --noEmit`: 0 errors.
- `python3 apps/console-web/plugins/ai-assistant/test.py`: 213 checks (10 new for the console tools). One check,
  "chat turn: no tools of any kind reach the CLI", fails about one run in two **on unchanged main too** (timing in the fake
  CLI log), not from this build.
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-plugin-pages: pass.
- plugin-lifecycle check flags only `.axf-focus.json` (git-ignored live-preview file), not plugin code.

## Left
- UI Review shots (desktop + phone) were not taken in this session: the console with this branch was not running here.
  Take them after deploy and submit to UI Review.
- No Android/Kotlin work (none needed).
