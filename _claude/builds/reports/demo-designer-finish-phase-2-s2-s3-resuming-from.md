# Demo Designer: phase 2 (demo-designer-finish-phase-2-s2-s3-resuming-from)

Built Nov 10 2026 on Opus, branch `claude/demo-designer-finish-phase-2-s2-s3-resuming-from`. Brett: "Is the demo
designer done yet? ... Yes, queue it urgent."

## Where it stood
- Phase 1 of `demonstration-designer-plugin-new-standalone` (folder `/root/axf-builds/demo-designer`, branch
  `claude/demo-designer`) built the plugin; PR #405 is **already merged** to main. Its report
  (`_claude/builds/reports/demonstration-designer.md`) planned phase 2 only as "finish it" plus tests, report and PR; the
  one open item it named was the known limit: an exported video had captions and music but **no voice**, because
  Chrome never routes browser speech into tab capture. "A server-side voice is the next step."
- `walkthrough-player-ide-layout-setting-collapsibl` (branch of the same name, not merged) merges the glossary's player,
  Book Builder and clips into this plugin and splits `web/page.tsx` into `pitch.tsx` / `ide.tsx` / `library.tsx` /
  `books.tsx`. To avoid duplicating it, this phase does not touch layout, books, clips or the IDE: it closes the voice gap
  only, with the shared pieces in `web/model.ts` so the split page reuses them.

## What this phase adds
**Cloud narrator voices, recorded into exported videos.**
- Agent voice (server) now provides capability **`axf.speech@1`**: `narrators()` (agents whose voice profile allows cloud
  voices and whose provider has a key) and `say(agentId, text, rate)` → mp3. It is the same code path as its `/tts`
  route (refactored into `render()`): same permission rule, same key handling (keys never leave the server), same cache.
- Demonstration Designer (server) adds `GET narrators` and `POST narrate {narrator, text, speed}` → audio/mpeg. It finds
  speech by capability only (optional `axf.speech@1` in plugin.json), never by folder; with no provider it says why.
- A narrator value `agent:<id>` is a cloud narrator. The stage fetches each line and plays it through WebAudio, connected
  to the speakers **and the export mix**, so an exported video carries the voice. Music ducks under it as before. Pause /
  stop cut the line. If the server cannot speak a line (no key, permission removed), that line falls back to the device
  voice and the pitch keeps playing.
- The voice pickers (page pick 3 and Settings → Narration → Default narrator) list cloud narrators between the defaults
  and the device voices, from one shared helper (`narratorOptions` in `web/model.ts`); the settings hint says why there
  are none when there are none.

## Every action, four ways
| what | UI | REST | MCP / CLI | voice |
| --- | --- | --- | --- | --- |
| list cloud narrators | Voice picker, Default narrator | `GET /api/plugins/demonstration-designer/narrators` | `demonstration_designer_narrators` · `axf demonstration-designer narrators` | — (read) |
| speak a line | plays on the stage | `POST …/narrate {narrator, text, speed}` | `demonstration_designer_narrate` | — |
| use a cloud narrator | pick it, Generate | `POST …/generate {topic, voice: "agent:<id>"}` · `POST …/settings {narration: {voice}}` | `…_generate`, `…_settings_set` · `demos.mjs generate <topic> --voice agent:<id>` | `pitch.generate:<topic>:<minutes>` then `pitch.play` / `pitch.export:<id>` |
| deep link | — | — | — | `?axf-demo=<id>`, `?axf-demo=settings` (unchanged) |

## Checks
- `demonstration-designer/test.mjs`: 22 checks (was 21); the new one runs `server_test.py` (11 checks: no provider →
  why + 409, narrators as `agent:<id>`, audio/mpeg, speed clamp, text limit, provider refusal passes through, device
  voice and bad ids refused, provider withdrawn). It skips with a message where python3 + fastapi are missing.
- `agent-voice/test.py`: 41 checks (4 new: service provided, narrators, say matches /tts and its cache, permission refused).
- `tsc --noEmit` clean; check-theme, check-controls, check-toolbars, check-chrome-assets clean;
  `plugin-lifecycle check` clean for both plugins; `plugin-commands.mjs check` 67/67; `plugins.mjs --check` clean.

## UI Review
Screen item for the Demonstration Designer page with the cloud narrator picked (desktop shot), group
"demo-designer-finish-phase-2-s2-s3-resuming-from - Nov 10 …". Shots were taken on a local console with a scratch Agent
voice folder (one agent allowed cloud voices, placeholder key) and `AXF_APPEARANCE_HUB=off`.
**Missing:** a phone shot. In the headless shot runner the phone viewport kept landing on Home (the `?axf-demo=` deep link
fired before the plugins loaded, three tries); the change is one option in an existing select, the same control on both
viewports. The phase 1 items (`r-20261109-eb1a4485`, `r-20261109-438d0f75`) are still waiting for Brett's layout picks.

## Known limits
- Cloud narration costs the provider's credits per line (cached on the server, so replays and re-exports of an unchanged
  script are free).
- A device-voice export still has no voice; the README says to pick a cloud narrator for exports.

## Decisions made alone
- Closed the voice gap instead of layout or book work, which the walkthrough-player build owns.
- Put the speech service in Agent voice (it already owns cloud keys, voices and the per-agent permission) rather than
  a second copy of the provider code in this plugin. The narrator is an agent, so the existing "allow cloud voices"
  permission still governs who can spend credits.
- `POST narrate` is declared `readOnly: false` because it spends credits, though it changes no stored state.
