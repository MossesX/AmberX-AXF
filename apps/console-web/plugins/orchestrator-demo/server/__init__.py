"""Orchestrator demo — server part. Mounted at /api/plugins/orchestrator-demo/ (console token on every method, 404 while
the plugin is off). The routes are in routes.py; the run itself is driven by runner.mjs (demo-run@1).
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/info")
def info() -> dict[str, str]:
    return {"plugin": "orchestrator-demo", "schema": "demo-run@1"}
