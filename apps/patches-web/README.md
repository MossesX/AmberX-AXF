# Patches

Initialized by the **AmberX AXF 0.2.0** build engine (`web-fastapi-wall` template): a React/TS web app
and its FastAPI server in one container, behind Coolify's Traefik and **axHub's sign-in wall**.

```bash
npm install && npm run dev                                         # web on :5173, proxies /api to :7290
pip install -r server/requirements.txt
APP_TOKEN=dev uvicorn main:app --app-dir server --port 7290        # API (+ dist/ when built)
npm run build                                                      # typecheck + production build -> dist/
python3 server/test_server.py                                      # server self-test (token, wall signature, users)
sudo DOMAIN=… REPO=… bash deploy/install.sh                        # on the VPS: build, run, wall, auto-update
```

## Who gets in

| Caller | How | Reaches |
| --- | --- | --- |
| Machine / local dev | `Authorization: Bearer $APP_TOKEN` | every `/api` route |
| Hub admin (signed in) | the wall's signed headers (`APP_TRUST_WALL=1` + `APP_WALL_SECRET`) | every `/api` route, no token |
| Hub user (signed in) | same, only with `APP_WALL_USERS=on` at install | `/api/health`, `/api/me`; extend `user_may` in `server/main.py` |

The installer strips any `X-Auth-*` header a client sends and forward-auths every request to the hub; the server still
trusts those headers only with the hub's HMAC signature (120 s, this host). Browser writes must be same-origin.
In the UI, a signed-in account is bound to the framework's **`hub-accounts`** access policy (roles admin / themes /
user; themes = the hub permission `APP_THEMES_PERM`, default `patches-web.themes`).

## Structure

| Path | Purpose |
| --- | --- |
| `src/axf/` | Baked framework (engines, React, CSS, libraries) — don't edit, re-bake |
| `src/axf/deploy/axf-deploy.sh` | Shared deploy helpers (axf-deploy@1): Coolify run + labels, wall, secret, auto-update |
| `src/api.ts` | Browser client for `/api` |
| `server/main.py`, `server/wall.py` | API + static web app; who is calling behind the wall |
| `Dockerfile` | Node build → Python image (uid 1000) |
| `deploy/install.sh` | VPS installer (root): `APP_WALL=off|on|auto`, `APP_WALL_USERS=on|off` |

State on the VPS: `$DIR/.app/` (0700): `env` (APP_TOKEN, 0600), `wall`, `wall-users`, `data/` (mounted at `/data`).
The wall secret is the hub's one (`AXHUB_WALL_SECRET`), reused from the Dev Console when it has one.
