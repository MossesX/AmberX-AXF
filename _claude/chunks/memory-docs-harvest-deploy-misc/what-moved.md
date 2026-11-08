<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=6-20 tokens=428 -->
## What moved

| Item | From | To |
| --- | --- | --- |
| Coolify network detection, clean stop, `docker run` on the Coolify network with Traefik router + http→https labels | `deploy/install-console.sh` §4 (≈ Build Pilot `deploy/install.sh` 92-93, 117-119, 163-170) | `framework/deploy/axf-deploy.sh`: `axf_coolify_proxy_running`, `axf_coolify_network`, `axf_stop_container`, `axf_router_labels`, `axf_https_redirect_labels`, `axf_coolify_run` |
| axHub wall: saved on/off/auto, "hub can sign someone in" probe, user_paths from `wallUsers` plugins, verify URL, strip + forwardAuth labels | install-console.sh §6 (≈ BP 124-161) | `axf_save_choice`, `axf_hub_can_sign_in`, `axf_wall_mode`, `axf_wall_plugin_user_paths`, `axf_wall_join_paths`, `axf_wall_verify_url`, `axf_wall_labels` |
| Wall secret creation (0600) | install-console.sh §6 | `axf_wall_secret` |
| 5-minute auto-update script + cron | install-console.sh §5 (≈ BP 179-195) | `axf_update_script` (status JSON + re-run markers; `AXF_UPDATE_PRELUDE`/`AXF_UPDATE_FETCH` for private repos), `axf_cron_file` |
| "Web app + FastAPI behind the wall" starting point | the console + Build Pilot server/deploy patterns | new app template `framework/templates/web-fastapi-wall` |
| Hub-account access policy | `apps/console-web/src/assets/uac-policy/console-access.json` | starter `framework/assets/uac-policy/hub-accounts.json` (generalized) |

Template vs boilerplate: a boilerplate@1 only adds screens/modules/libraries on top of a template (Android-oriented
in practice), and a server + Dockerfile + installer is a different app shape, so this is a **template**
(`axf init <dir> --template web-fastapi-wall`). Swept in CI's engine job like every template.
