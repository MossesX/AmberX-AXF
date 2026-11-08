<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md lines=107-144 tokens=761 -->
## Build Pilot adoption (separate repo; not edited here)

1. In `scripts/bake-contracts.mjs`, add to `FILES` (framework path → repo path):
   ```js
   'framework/python/axf_server/__init__.py': 'server/axf_server/__init__.py',
   'framework/python/axf_server/wall.py': 'server/axf_server/wall.py',
   'framework/python/axf_server/storage.py': 'server/axf_server/storage.py',
   'framework/python/axf_server/http.py': 'server/axf_server/http.py',
   'framework/python/axf_server/console_client.py': 'server/axf_server/console_client.py',
   'framework/python/axf_server/plugin_package.py': 'server/axf_server/plugin_package.py',
   'framework/python/axf_server/credentials.py': 'server/axf_server/credentials.py',
   'framework/spec/fixtures/wall-signature.json': 'src/axf/spec/fixtures/wall-signature.json',
   'framework/spec/fixtures/plugin-package.json': 'src/axf/spec/fixtures/plugin-package.json',
   ```
   Run `node scripts/bake-contracts.mjs --from ../amberx-axf` after this branch is on main; commit the files and
   `axf-contracts.lock.json` (`--check` then guards them). `server/` is the uvicorn cwd, so `import axf_server` works
   with no path code; the Dockerfile already copies `server/` and `src/axf/spec`.
2. `server/main.py`:
   - wall: `from axf_server.wall import Wall, same_origin`; `WALL = Wall("BP_")`; `wall_trusted = WALL.trusted`;
     `wall_admin(request)` → `c = WALL.admin(request); return c.name if c else None` (admin only + same origin, as now).
     Delete `WALL_MAX_AGE_S`, `_wall_secret`, `wall_signature_ok`.
   - storage: `_write(path, data)` → `storage.write_json(path, data, dir_mode=None)`; `_read` → `storage.read_json`.
   - console: `TOKEN = TokenFile(os.environ.get("BP_CONSOLE_TOKEN_FILE") or None, fallback="")`;
     `console_token = lambda: os.environ.get("BP_CONSOLE_TOKEN", "").strip() or TOKEN()`;
     `CONSOLE = ConsoleClient(CONSOLE_URL, console_token, timeout=TIMEOUT, token_hint="BP_CONSOLE_TOKEN")`;
     `console(method, path, body, timeout)` → `CONSOLE.call(...)`, `console_raw(path, limit)` → `CONSOLE.raw(...)`;
     `ConsoleError = console_client.ConsoleError`. Plain http to `http://axf-console:7090` (deploy/install.sh) is
     allowed because the client allows exactly its own host.
3. `server/plugin_install.py`: replace `PACKAGE_SCHEMA … verify()` with
   `pkg = plugin_package.verify_package(raw, expect_sha, kind="pilot", folder=folder)` and
   `files = plugin_package.decode_files(pkg)`; map `plugin_package.PackageError` to its `PackageError`. Keep
   `installed/unpack/remove/bundled_plugins` (install side, Build Pilot specific). Messages change to the catalog's
   wording (same as the console shows).
4. Tests: add to `server/test_server.py` a replay of `src/axf/spec/fixtures/wall-signature.json` through
   `Wall("BP_")` and of `plugin-package.json` through `verify_package` (copy the loops from
   `framework/python/axf_server/test.py`), and run the baked `axf_server` self-test if wanted
   (`python server/axf_server/test.py` needs `test.py` baked too — optional).
