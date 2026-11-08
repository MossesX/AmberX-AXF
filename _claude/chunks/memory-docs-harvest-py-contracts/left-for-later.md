<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md lines=93-100 tokens=136 -->
## Left for later

- Build Pilot adoption (not done here; Build Pilot is read-only for this group): see the final message / below.
- An `axf_server/` + `axf.assistant_host` doc line in `framework/libs/README.md` once the other Python group lands.
- `providers.py` still shells out to the Claude Code CLI with `claude -p`; an axHub-hosted session host
  (`axhub-agent-host`) replaces `axhub_placeholder` by registering a `SessionHost`.
- `apps/console-web/src/axf/core/assistant.ts` was re-baked by hand (CI re-bakes the whole folder anyway).
