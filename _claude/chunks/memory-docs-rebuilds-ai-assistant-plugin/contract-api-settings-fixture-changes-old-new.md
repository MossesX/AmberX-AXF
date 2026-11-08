<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md lines=79-89 tokens=255 -->
## Contract / API / settings / fixture changes (old → new)
- New contract `assistant@1` (no old one). New fixture `spec/fixtures/assistant.json`; `live-session.json` unchanged.
- `GET /catalog`: `+ protocols[]`. `GET /sessions`: `hosts[]` now from the registry (`describe()`), `active` may be
  `""` when no host is available (was always `"local"`). `GET /usage`: `+ users[]`. `PUT /config`: `+ keepInterrupted`.
- Config file: `+ schema: 1` (written on first save; older files read fine). Session logs: `+ owner`.
- `plugin.json`: version `0.1.0 → 0.2.0`, `provides + action:ai.chat.start`, `optional + axf.containers@1,
  axf.live-host@1`, `mentions + framework/spec/ASSISTANT.md`.
- Web library `provides`: `['axf.ai-assistant'] → ['axf.ai-assistant', 'axf.llm@1', 'axf.live-sessions@1']`.
- Compatibility: nothing an existing app or plugin calls changed shape. A migration runner exists but no step was
  needed. A plugin that provided a host by editing `sessions.HOSTS` (none did) would now call `register_host`.
