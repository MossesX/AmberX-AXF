"""Notes and tasks, server part. Mounted at /api/plugins/notes-tasks/ (console token on every method; AmberX's server
forwards to it for hub admins).

The notes, to-dos and tasks themselves live on axHub and both apps talk to it directly (web/notes/store.ts). This part
only does what a browser can't:

    GET  /vault              the Claude files, with their text, through axf.notes@1 (read-only here)
    GET  /migration          what the one-time migration did
    POST /migration          run it now (safe to repeat: rows already there are left alone)

Migration (server/migrate.py) runs once by itself when the console starts: it backs up first, then moves the console
Todo manager's lists and entries into the one store.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter

import console_context as cx
import plugin_services

from . import migrate

log = logging.getLogger("notes-tasks")
router = APIRouter()
NOTES_SERVICE = "axf.notes@1"


def data_dir() -> Path:
    return Path(os.environ.get("AXF_NOTES_TASKS_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "notes-tasks"))


def todo_store() -> Path:
    return Path(os.environ.get("AXF_TODO_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "todo-manager")) / "store.json"


def vault() -> dict[str, Any]:
    """Every Claude file with its text. Unavailable (no service, no hub folder) is an empty answer, never an error."""
    svc = plugin_services.get(NOTES_SERVICE)
    if svc is None or not svc.available():
        return {"available": False, "notes": []}
    out = []
    for n in svc.list("").get("notes", []):
        try:
            out.append({**n, "content": svc.read(n["path"]).get("content", "")})
        except Exception as e:  # one unreadable note must not hide the rest
            log.warning("notes-tasks: %s not read: %s", n.get("path"), e)
    return {"available": True, "notes": out}


@router.get("/vault")
def get_vault() -> dict[str, Any]:
    return vault()


@router.get("/migration")
def get_migration() -> dict[str, Any]:
    return migrate.status(data_dir())


@router.post("/migration")
def post_migration() -> dict[str, Any]:
    return migrate.run(todo_store(), migrate.notes_dir(), data_dir())


def _migrate_once() -> None:
    try:
        r = migrate.run_once(todo_store(), migrate.notes_dir(), data_dir())
        if r:
            log.info("notes-tasks migration: %s", r)
    except Exception:  # the old data is untouched; POST /migration retries
        log.exception("notes-tasks migration failed")


if os.environ.get("AXF_NOTES_TASKS_MIGRATE", "on") != "off":
    threading.Thread(target=_migrate_once, name="notes-tasks-migrate", daemon=True).start()
