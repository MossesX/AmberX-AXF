"""Build Breaker (server part). Mounted at /api/plugins/build-breaker/ (console token on every route, 404 while off,
never on the console MCP).

  GET  asks     every ask Brett made (build-asks@1): the seed in the plugin folder merged with the live copy in its
                data folder, read through the plugin's CLI (asks.mjs export --json) so the console, the CLI and other
                sessions share one set of rules. {ok, doc: {$axf, generatedAt, sources, gaps, apps, plugins, asks}, files}

Read only: sessions add and change asks with `asks.mjs add | set-status` (writes both copies).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "asks.mjs"
ROOT = CLI.parents[4]


@router.get("/asks")
def asks() -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), "export", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"could not read the asks: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
