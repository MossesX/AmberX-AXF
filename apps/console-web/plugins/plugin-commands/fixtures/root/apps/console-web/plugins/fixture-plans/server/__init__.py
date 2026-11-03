"""Fixture plugin server (plugin-commands tests)."""
from typing import Any

from fastapi import APIRouter, Request

router = APIRouter()
CALLS: list[Any] = []


@router.get("/state")
def state() -> dict[str, Any]:
    """Every plan."""
    CALLS.append(("GET", "/state"))
    return {"ok": True, "plans": [{"id": "p1", "title": "A plan"}]}


@router.get("/plans/{pid}")
def plan(pid: str, full: bool = False) -> dict[str, Any]:
    return {"id": pid, "full": full}


@router.post("/search")
async def search(request: Request) -> dict[str, Any]:
    b = await request.json()
    return {"hits": [p for p in ("alpha", "beta") if b.get("q", "") in p]}


@router.get("/events")
def events() -> str:
    return ""
