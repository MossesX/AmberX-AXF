"""AmberX AXF — shared Python server helpers (stdlib only, typed).

Every AXF app with a Python server (the Dev Console's FastAPI API and its plugins, Build Pilot's server, future
apps) uses these instead of keeping its own copy. Each module is small, has no third-party dependencies and is
covered by `framework/python/axf_server/test.py`; the cross-language parts replay fixtures in `framework/spec/fixtures`
(`wall-signature.json`, `plugin-package.json`) that `framework/spec/check-axf-server.mjs` replays in Node.

    axf_server.wall            axHub sign-in wall: signature check (v1|ts|user|role|perms|host, 120 s, host bound),
                               Caller, same-origin check, user_may — configured by an env prefix (AXF_, BP_, …)
    axf_server.storage         private dirs (0700), atomic JSON/text writes (tmp + fsync + replace, 0600), safe reads
    axf_server.http            outbound HTTP: https only (loopback http allowed), no redirects or credential-stripping
                               redirects, size cap, timeout, JSON helpers, injectable transport, HttpClient base
    axf_server.credentials     0600 env-file credential store (KEY=value lines)
    axf_server.console_client  the Dev Console's token file (mtime cache) + server-to-server calls to its API
    axf_server.plugin_package  plugin-package@1 checks (the Python port of framework/cli/plugin-catalog.mjs)

Extension point: `axf_server.github` (lib-github) is built on `axf_server.http.HttpClient` — see that class.

Import path: the package lives in `framework/python`; put that folder on `sys.path` (the console's
`server/axf_framework.py` does it, the console image sets PYTHONPATH) and `import axf_server.<module>`.
Apps outside this repo bake the package in (Build Pilot: `scripts/bake-contracts.mjs` → `server/axf_server/`).
"""
from __future__ import annotations

__version__ = "1.0.0"
SCHEMA = "axf-server@1"

__all__ = ["__version__", "SCHEMA"]
