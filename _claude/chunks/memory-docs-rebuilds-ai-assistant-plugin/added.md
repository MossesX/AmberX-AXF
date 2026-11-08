<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md tokens=309 -->
## Added
- `framework/schemas/ai-providers.json` (`ai-providers@1`).
- `framework/core/assistant.ts` (exported from `core/index.ts`), `framework/spec/ASSISTANT.md`,
  `framework/spec/fixtures/assistant.json` (+ generator block in `gen-fixtures.mts`).
- Kotlin `framework/android/axf-kernel/.../assistant/Assistant.kt` + `AssistantConformanceTest.kt` (written without
  a compiler; CI compiles).
- Plugin: `server/contract.py`; routes `GET /contract`, `GET /tags`, `POST /providers/reload`; export `format=txt`;
  conversations `?tag=`; usage `users`; config keys `keepInterrupted`, `schema`; optional services
  `axf.containers@1`, `axf.live-host@1` declared in `plugin.json`; `AXF_AI_CLI_TIMEOUT`, `CLAUDE_BIN` listed in
  `lifecycle.env`; hooks check `provider-set-up`, `provider-registry`.
- Chat UI: tag chips + per-conversation tags, "live" pill while a reply runs on the host, Continue on an
  interrupted/stopped reply, interrupted marker, `/model`, `/tag`, `/stop`, `/export json|txt`, Escape cancels an
  edit; Live sessions panel: contract chips, Stop/Open per session, host-registry note; Behaviour: per-user daily
  cap + keep-interrupted switch; Usage: per-hub-user table; dialog prop `open` (open a given conversation).
