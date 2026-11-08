<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md tokens=186 -->
## Left for later

- **`axf_server.github` (lib-github, next group):** build on `http.HttpClient` (README in the package has the exact
  settings) and switch `app_ci._api`, `app_catalog._api`, `alerts._gh`, `main._gh/release_download`, activity
  `_github_get`, systems-check's GitHub check to it.
- `ai-assistant/server/sessions.py` and `session-checkin` pricing still write their own tmp files (live-session file is
  already 0600; pricing is a non-secret repo file) — switch when those plugins are next touched.
- The AI providers / agent LLM HTTP (`ai-assistant/providers.py`, `agent-manager/llm.py`) and container-access's Coolify
  call keep their own urllib (custom SSL context, streaming); move them once `http` grows a streaming call.
