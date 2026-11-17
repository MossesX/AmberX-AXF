"""Server part of the Hub plugin (hub-console@1). Mounted at /api/plugins/hub-admin/.

Step 5 scaffold: the route table and a health line. Step 6 adds the proxy that reads every hub screen through axHub
(the console's hub token for bearer reads, the console's own hub session for /auth/api reads) with retries and a clear
unavailable state, and the action routes that hand a person's tap to the approvals-banner relay.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter()
FOLDER = "hub-admin"
ROOT = Path(__file__).resolve().parents[5]
TABLE_FILE = ROOT / "framework" / "schemas" / "hub-console.json"


def load_table() -> dict[str, Any]:
    """The hub-console@1 route table (the single source every projection reads)."""
    return json.loads(TABLE_FILE.read_text(encoding="utf-8"))


@router.get("/table")
def get_table() -> dict[str, Any]:
    return {"ok": True, "table": load_table()}
