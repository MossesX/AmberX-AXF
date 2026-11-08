<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md tokens=289 -->
## Summary

The assistant is now a **framework contract, `assistant@1`**, with the console plugin as its first host instead of a
console-only plugin. `framework/core/assistant.ts` (web reference) = Kotlin `ai.amberx.axf.kernel.assistant` = the
plugin's `server/contract.py` carry the provider registry (`framework/schemas/ai-providers.json`, one file for every
port), the canonical chat shapes, `ai-conversation@1`, every pure rule the engine applies (secret redaction, history
window, fallback chain, user permissions and clamps, SSE framing, the live-reply fold) pinned by a new fixture, and a
transport-agnostic `AssistantClient` + `HttpAssistantClient` + `watchReply` any AXF app (Build Pilot next) can drop a
chat UI on. Live sessions became an **open host registry** (local built, axHub a typed placeholder, modules add hosts
through `axf.live-host@1`), and an interrupted reply no longer loses what it had said. Every Opus feature and every
security guard survives (111 checks kept, 137 now); `axf.llm@1`, ids, routes, settings keys and data formats are
unchanged, so the agent manager, systems check, Claude badge and feature assist work as before.
