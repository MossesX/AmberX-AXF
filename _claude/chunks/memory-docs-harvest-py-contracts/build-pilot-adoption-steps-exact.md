<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md tokens=810 -->
### Build Pilot adoption steps (exact)

1. `scripts/bake-contracts.mjs` → `FILES`: replace the two plugin lines with
   ```js
   'framework/python/axf/contracts/assistant.py': 'server/axf_contracts/assistant.py',
   'framework/python/axf/contracts/agents.py': 'server/axf_contracts/agents.py',
   'framework/python/axf/assistant_host/providers.py': 'server/axf_host/providers.py',
   'framework/python/axf/assistant_host/sessions.py': 'server/axf_host/sessions.py',
   'framework/python/axf/assistant_host/safety.py': 'server/axf_host/safety.py',
   'framework/python/axf/assistant_host/cli_bridge.py': 'server/axf_host/cli_bridge.py',
   ```
   (and the header comment), add `server/axf_host/__init__.py` with the same "never edit, re-bake" note as
   `server/axf_contracts/__init__.py`, re-run `node scripts/bake-contracts.mjs --from ../amberx-axf`.
2. Delete `server/providers.py`, `server/sessions.py`, `server/safety.py`, `server/cli_bridge.py`; in
   `server/assistant.py` and `server/agents.py` import `from axf_host import providers, safety, sessions` and set the
   hooks once (what its forked copies hard-coded): `providers.extra_kinds = assistant_store.extra_kinds`;
   `providers.PRIVATE_DIRS = [".build-pilot", ".axf-console"]`; `providers.ENV_PREFIXES_HIDDEN = ["AXF_", "BP_"]`;
   `providers.PRIVATE_ROOTS = lambda: {str(Path(__file__).resolve().parent.parent), os.environ.get("BP_DATA_DIR", "")} - {""}`
   (its copy also denied `//run/console/**` and the whole `BP_DATA_DIR`: keep those by appending to the result of
   `providers._cli_abs_deny` or by adding `BP_DATA_DIR`'s folder name to `PRIVATE_DIRS`); `providers.HOST_LABEL =
   "the Build Pilot server"`; `providers.USER_AGENT = "AmberX-BuildPilot-Assistant/1"`; `safety.USER_AGENT =
   "AmberX-BuildPilot/1"`; `os.environ.setdefault("AXF_PROVIDERS_FILE", str(BP_PROVIDERS_FILE))` before importing
   providers (its copy read `BP_PROVIDERS_FILE` → baked `src/axf/schemas/ai-providers.json`); `BP_AI_TIMEOUT` /
   `BP_AI_CLI_TIMEOUT` → set `AXF_AI_TIMEOUT` / `AXF_AI_CLI_TIMEOUT` from them before import;
   `sessions.LocalHost(folder, label="Build Pilot server", note="Replies run on the Build Pilot server and keep going when the browser closes.", restart_reason="The Build Pilot server restarted while this reply was running.")`;
   `sessions.axhub_placeholder("the Build Pilot server")`.
3. `src/assistant/chat.tsx`: delete `type PilotCtx = Ctx & { projectId?: string }` and every `as PilotCtx` cast; build
   the context as `{ view: axState.view, title: document.title, extra: pilot.project?.id ? { projectId: pilot.project.id } : undefined, selection: … }`
   and read it with `contextExtra(ctx, 'projectId')` (exported by the baked `src/axf/core/assistant.ts`); the chip and
   the per-message "context:" line use the same call.
4. `server/assistant.py` line ~190: `_turn_project.set(contract.context_extra(contract.normalize_chat_context(body.get("context")), "projectId")[:64])`
   and store the normalised context on the user message (as the console does). `server/test_server.py` ~654:
   `context={"view": "designer", "extra": {"projectId": "apk-1"}}`.
5. Run `node scripts/bake-contracts.mjs --check`, `python3 server/test_server.py`, `npm run typecheck`.
