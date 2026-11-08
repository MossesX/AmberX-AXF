<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-manager-plugin.md tokens=175 -->
## Known gaps / placeholders
- Kotlin written without a compiler: `Agents.kt` and `AgentsConformanceTest.kt` need Android CI (check the "CI build errors" issue). The Kotlin runtime is a placeholder (`PlaceholderAgentRuntime`, capability `axf.agents`); an Android agent manager module (storage, model calls, UI) is future work (`build-pilot-agents` covers the Build Pilot side).
- The Android memory engine mirrors tokens/BM25/chunk/trim only; vector search and the LLM reflection stay host-side.
- The playground is still a non-streamed single turn; streamed chats live in the AI assistant.
- `firecrawl-*` sources, MCP sources and embeddings need keys/servers; untested here beyond the fake model.
