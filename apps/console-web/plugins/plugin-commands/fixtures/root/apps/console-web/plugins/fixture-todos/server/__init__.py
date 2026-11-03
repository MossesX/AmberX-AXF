"""Fixture plugin server (plugin-commands tests)."""
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
CALLS: list[Any] = []


@router.get("/entries")
def entries(q: str = "", limit: int = 20) -> dict[str, Any]:
    return {"q": q, "limit": limit, "entries": []}


@router.post("/entries", status_code=201)
async def post_entry(req: Request) -> dict[str, Any]:
    b = await req.json()
    CALLS.append(("POST", "/entries", b))
    if "listId" not in b:
        raise HTTPException(400, "listId is required")
    return {"entry": {"id": 7, **b}}


@router.delete("/entries/{eid}")
def delete_entry(eid: int) -> dict[str, Any]:
    CALLS.append(("DELETE", f"/entries/{eid}"))
    return {"ok": True, "deleted": eid}
