"""Terminal — settings, the VPS SSH key, an optional Claude Code token and the session log, inside the plugin's dataDir.
Secrets (the private key, the token) are files with mode 0600 and never leave the server."""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

_lock = threading.RLock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_TERMINAL_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "console-terminal"))


def _write(p: Path, data: Any) -> None:
    storage.write_json(p, data, indent=1)  # atomic, 0600, folder 0700 (axf_server.storage)


DEFAULTS: dict[str, Any] = {"$axf": "terminal-settings@1", "idleMinutes": 60, "moshKeepMinutes": 30, "fontSize": 14, "copyOnSelect": False,
                            "pasteWarn": True, "mouseDefault": False, "moshDefault": False, "user": "", "showHubRuns": True, "showHeadless": True,
                            "vps": {"host": os.environ.get("AXF_VPS_HOST", ""), "port": 22, "user": "root"}}


def settings() -> dict[str, Any]:
    raw = storage.read_json(data_dir() / "settings.json", {})
    if not isinstance(raw, dict):
        raw = {}
    out = {**DEFAULTS, **raw, "vps": {**DEFAULTS["vps"], **(raw.get("vps") or {})}}
    out["sshKey"] = ssh_key().exists()
    out["claudeToken"] = bool(claude_token())
    return out


_HOST = re.compile(r"^[A-Za-z0-9.-]{1,253}$|^\[?[0-9a-fA-F:]{2,45}\]?$")


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        s = {k: v for k, v in settings().items() if k not in ("sshKey", "claudeToken")}
        for k, lo, hi in (("idleMinutes", 5, 24 * 60), ("moshKeepMinutes", 1, 24 * 60), ("fontSize", 9, 28)):
            if k in patch:
                s[k] = max(lo, min(int(patch[k]), hi))
        for k in ("copyOnSelect", "pasteWarn", "mouseDefault", "moshDefault", "showHubRuns", "showHeadless"):
            if k in patch:
                s[k] = bool(patch[k])
        if "user" in patch:
            u = str(patch["user"]).strip()
            if u and not re.match(r"^[A-Za-z0-9_.-]{1,32}(:[A-Za-z0-9_.-]{1,32})?$", u):
                raise ValueError("user is a name or uid")
            s["user"] = u
        if isinstance(patch.get("vps"), dict):
            v = patch["vps"]
            host = str(v.get("host", s["vps"]["host"])).strip()
            if host and (not _HOST.match(host) or host.startswith("-")):
                raise ValueError("host is a hostname or IP address")
            user = str(v.get("user", s["vps"]["user"]) or "root").strip()
            if not re.match(r"^[a-z_][a-z0-9_.-]{0,31}$", user):
                raise ValueError("SSH user is a Linux user name")
            s["vps"] = {"host": host, "port": max(1, min(int(v.get("port", s["vps"]["port"]) or 22), 65535)), "user": user}
        if "claudeToken" in patch:
            tok = str(patch["claudeToken"] or "").strip()
            f = data_dir() / "claude-token"
            if not tok:
                f.unlink(missing_ok=True)
            elif not re.match(r"^sk-ant-oat01-[A-Za-z0-9_-]{20,}$", tok):
                raise ValueError("that isn't a Claude Code token (run `claude setup-token`; it starts with sk-ant-oat01-)")
            else:
                storage.write_text(f, tok)  # atomic, 0600
        _write(data_dir() / "settings.json", s)
        return settings()


def claude_token() -> str:
    try:
        return (data_dir() / "claude-token").read_text().strip()
    except OSError:
        return os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "")


def ssh_key() -> Path:
    return data_dir() / "ssh" / "id_ed25519"


def keygen(replace: bool = False) -> str:
    """A dedicated ed25519 key for the VPS tab (private half stays here, 0600)."""
    k = ssh_key()
    with _lock:
        if k.exists() and not replace:
            return public_key()
        k.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        for f in (k, k.with_suffix(".pub")):
            f.unlink(missing_ok=True)
        try:
            r = subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "axf-console-terminal", "-f", str(k)], capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            raise ValueError("ssh-keygen isn't installed in the console (openssh-client)") from None
        if r.returncode != 0:
            raise RuntimeError(f"ssh-keygen failed: {r.stderr.strip()[:200]}")
        os.chmod(k, 0o600)
    return public_key()


def public_key() -> str:
    try:
        return ssh_key().with_suffix(".pub").read_text().strip()
    except OSError:
        return ""


def log(entry: dict[str, Any]) -> None:
    e = {"at": int(time.time() * 1000), **entry}
    p = data_dir() / "sessions.jsonl"
    with _lock:
        storage.append_jsonl(p, e, rotate_at=2_000_000)


def read_log(limit: int = 200) -> list[dict[str, Any]]:
    p = data_dir() / "sessions.jsonl"
    try:
        lines = p.read_text("utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in reversed(lines[-limit:]):
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out
