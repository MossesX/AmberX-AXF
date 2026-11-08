<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md tokens=535 -->
## What moved (from → to)

| Item | From | To |
| --- | --- | --- |
| Wall signature, Caller, same-origin, user rules | `apps/console-web/server/wall.py` (+ Build Pilot `server/main.py` 93-147, hand copy) | `axf_server.wall` (`verify`, `sign`, `Wall(prefix)`, `Caller`, `same_origin`, `user_may`, `ui_role`) |
| Private dirs + atomic JSON + safe reads | ~15 copies: `alerts._write_private/_read_json` + VAPID key, `app_ci._save` + APK cache, `app_catalog._write_index` + APK files, `main._save_state/_load_state`, plugins container-access, snapshot-manager, console-terminal (settings, Claude token, session log), systems-check, theme-manager, claude-badge, feature-assist (log), agent-manager (store + memory), ai-assistant (store), activity (config + reports), `axf_libs.mcp.FileRegistry.save` (mcp-client) | `axf_server.storage` (`write_json/text/bytes`, `read_json/read_text`, `append_jsonl`, `private_dir`) |
| Outbound HTTP | `app_ci._NoAuthRedirect/_http`, `alerts._NoRedirect/_OPENER/_target_ok` (ntfy, GitHub, web push), `main._gh` + `release_download`, systems-check `checks._http` + `hostfix._NoRedirect/_rpc`, activity `_NoRedirect/_github_get`, `app_catalog._http` | `axf_server.http` (`request`, `get_json`, `post_json`, `target_ok`, `HttpClient`) |
| Credential store | `apps/console-web/server/credentials.py` `CredStore` | `axf_server.credentials.CredStore` (the console keeps a 4-line subclass for its header + the `CREDENTIALS` table) |
| Console token file + console client | console `main.current_token/_write_token/_token_cache`, Build Pilot `console()/console_raw()/console_token()` | `axf_server.console_client` (`TokenFile`, `read_token_text`, `ConsoleClient`) |
| Plugin package checks | Build Pilot `server/plugin_install.py` (hand copy of `plugin-catalog.mjs`) | `axf_server.plugin_package` (`verify_package`, `path_problem`, `content_hash`, `decode_files`, open `KINDS` registry) |

New in the console: `server/axf_framework.py` (puts `framework/python` on `sys.path`; works in Docker, on the VPS
mount and in tests). `server/wall.py` is now a thin shim (`Wall("AXF_")` + the names main.py and plugins import).
