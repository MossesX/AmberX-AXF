"""The VPS badge (is the host pingable) and the server health widgets (disk, CPU load, memory, swap).

Brett, Nov 12 2026: "make it VPS badge as long as my VPS is pingable. Green if it's pingable, red if it's not."
The VPS badge is one ping and nothing else: no shell, no Claude login (that read lives with the Claude badge).
Where the host is: AXF_VPS_HOST, else the Terminal's VPS host (axf.headless@1 `host()`), else the Docker default gateway
(the host itself on Coolify's network). The ping is ICMP when the console may send it, else a TCP connect to port 22:
a refused connection still means the host answered.

Health is read in the console's own container with plain code: /proc/loadavg, /proc/meminfo and statvfs of the disk
path (AXF_VPS_DISK_PATH, default /). A container shares the host's kernel, so these are the VPS's numbers. No shell, no
tokens. Each metric has a warn and a red threshold (percent, kept in the plugin's data folder) and a state from them.
When the disk passes its red threshold the console raises one alert (the alert hub, which also reaches AmberX); it
resolves when the disk drops back under. A background check every 5 minutes keeps the alert live with no page open.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

import console_context as cx
import plugin_services
from axf_server import storage

PING_TTL_S = 20.0
PING_TIMEOUT_S = 2
HEALTH_TTL_S = 10.0
WATCH_S = 300.0
METRICS = ("disk", "cpu", "memory", "swap")
DEFAULTS: dict[str, dict[str, float]] = {"disk": {"warn": 80, "red": 90}, "cpu": {"warn": 70, "red": 90}, "memory": {"warn": 80, "red": 95}, "swap": {"warn": 50, "red": 80}}
ALERT_SOURCE = "claude-badge"
ALERT_KEY = "claude-badge:vps-disk"
HOST_RE = re.compile(r"^[A-Za-z0-9.:_-]{1,253}$")

_lock = threading.Lock()
_ping: dict[str, Any] = {"at": 0.0, "value": None}
_health: dict[str, Any] = {"at": 0.0, "value": None}
_alerted: dict[str, bool] = {"disk": False}


# ---------------------------------------------------------------------- where the VPS is, and the ping

def gateway(route_file: str = "/proc/net/route") -> str:
    """The default gateway from the kernel's route table: inside Docker, that is the host."""
    try:
        for ln in Path(route_file).read_text().splitlines()[1:]:
            p = ln.split()
            if len(p) > 2 and p[1] == "00000000" and p[2] != "00000000":
                return ".".join(str(b) for b in reversed(bytes.fromhex(p[2])))
    except (OSError, ValueError):
        pass
    return ""


def vps_host(in_docker: bool | None = None, route_file: str = "/proc/net/route") -> tuple[str, str]:
    """(host, where it came from). Empty when nothing says where the VPS is."""
    env = os.environ.get("AXF_VPS_HOST", "").strip()
    if env:
        return env, "AXF_VPS_HOST"
    svc = plugin_services.get("axf.headless@1")
    try:
        h = str(svc.host() or "").strip() if svc is not None and hasattr(svc, "host") else ""
    except Exception:  # noqa: BLE001 — the Terminal's setting is optional
        h = ""
    if h:
        return h, "Terminal VPS host"
    if Path("/.dockerenv").exists() if in_docker is None else in_docker:
        g = gateway(route_file)
        if g:
            return g, "Docker gateway"
    return "", ""


def _icmp(host: str, timeout: int) -> tuple[bool | None, float, str]:
    """(answered, ms, why). None = ICMP can't be sent from here (no ping binary, no permission): try TCP."""
    if not shutil.which("ping"):
        return None, 0.0, "no ping command"
    t = time.time()
    try:
        r = subprocess.run(["ping", "-n", "-c", "1", "-W", str(timeout), host], capture_output=True, text=True, timeout=timeout + 3)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, 0.0, str(e)[:120]
    ms = (time.time() - t) * 1000
    m = re.search(r"time[=<]([\d.]+)\s*ms", r.stdout)
    if r.returncode == 0:
        return True, float(m.group(1)) if m else round(ms, 1), ""
    if r.returncode == 1:
        return False, 0.0, f"{host} didn't answer the ping"
    err = (r.stderr or r.stdout).strip()
    if re.search(r"unknown host|name or service not known|temporary failure in name resolution", err, re.I):
        return False, 0.0, f"Can't resolve {host}"
    return None, 0.0, err[:120]


def _tcp(host: str, timeout: int, port: int = 22) -> tuple[bool, float, str]:
    t = time.time()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
    except ConnectionRefusedError:
        pass  # the host is up and said no: that is an answer
    except OSError as e:
        return False, 0.0, f"{host} didn't answer ({e.__class__.__name__})"
    return True, round((time.time() - t) * 1000, 1), ""


Pinger = Callable[[str, int], tuple[bool | None, float, str]]


def ping(host: str, timeout: int = PING_TIMEOUT_S, icmp: Pinger = _icmp, tcp: Callable[[str, int], tuple[bool, float, str]] = _tcp) -> dict[str, Any]:
    """One reachability check: {ok, ms, method, error}."""
    ok, ms, why = icmp(host, timeout)
    if ok is not None:
        return {"ok": ok, "ms": ms, "method": "icmp", "error": why}
    ok2, ms2, why2 = tcp(host, timeout)
    return {"ok": ok2, "ms": ms2, "method": "tcp", "error": why2}


def read_vps(refresh: bool = False) -> dict[str, Any]:
    """The VPS badge: `ok` when the host answers, `error` when it doesn't, `off` when no host is known. Cached 20 s."""
    with _lock:
        now = time.time()
        if not refresh and _ping["value"] is not None and now - _ping["at"] < PING_TTL_S:
            return {**_ping["value"], "cached": True}
    host, src = vps_host()
    res: dict[str, Any] = {"at": int(now * 1000), "ok": False, "state": "off", "reachable": False, "host": host, "source": src, "method": "", "ms": 0.0, "error": ""}
    if not host:
        res["error"] = "No VPS host known: set AXF_VPS_HOST on the console or the VPS host in Settings → Plugins → Terminal"
    elif not HOST_RE.match(host):
        res.update(state="error", error="The VPS host setting isn't a host name or address")
    else:
        p = ping(host)
        res.update(ok=p["ok"], reachable=p["ok"], state="ok" if p["ok"] else "error", method=p["method"], ms=p["ms"], error=p["error"])
    with _lock:
        _ping.update(at=now, value=res)
    return {**res, "cached": False}


# ---------------------------------------------------------------------- health: disk, CPU load, memory, swap

def meminfo(text: str) -> dict[str, int]:
    """/proc/meminfo → {name: kB}."""
    out = {}
    for ln in text.splitlines():
        m = re.match(r"^(\w+):\s+(\d+)", ln)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out


def _pct(used: float, total: float) -> float:
    return round(max(0.0, min(100.0, used * 100.0 / total)), 1) if total > 0 else 0.0


def memory_of(info: dict[str, int]) -> dict[str, Any]:
    total = info.get("MemTotal", 0) * 1024
    avail = info.get("MemAvailable", info.get("MemFree", 0)) * 1024
    return {"total": total, "used": max(0, total - avail), "pct": _pct(total - avail, total)}


def swap_of(info: dict[str, int]) -> dict[str, Any]:
    total = info.get("SwapTotal", 0) * 1024
    free = info.get("SwapFree", 0) * 1024
    return {"total": total, "used": max(0, total - free), "pct": _pct(total - free, total), "none": total == 0}


def cpu_of(loadavg: str, cores: int) -> dict[str, Any]:
    """Load averages and load1 as a percent of the cores (load 2.0 on 4 cores = 50%)."""
    try:
        l1, l5, l15 = (float(x) for x in loadavg.split()[:3])
    except ValueError:
        l1 = l5 = l15 = 0.0
    cores = max(1, int(cores or 1))
    return {"load1": l1, "load5": l5, "load15": l15, "cores": cores, "pct": _pct(l1, cores)}


def disk_of(st: Any) -> dict[str, Any]:
    """statvfs → used percent as df counts it: used / (used + what an ordinary user may still write)."""
    total = st.f_blocks * st.f_frsize
    used = (st.f_blocks - st.f_bfree) * st.f_frsize
    avail = st.f_bavail * st.f_frsize
    return {"total": total, "used": used, "free": avail, "pct": _pct(used, used + avail)}


def level(pct: float, t: dict[str, float]) -> str:
    return "error" if pct >= t["red"] else "warn" if pct >= t["warn"] else "ok"


def _thresholds_file() -> Path:
    from . import data_dir  # the plugin's one data folder
    return data_dir() / "thresholds.json"


def thresholds() -> dict[str, dict[str, float]]:
    """Each metric's warn and red percent: the saved ones over the defaults."""
    try:
        saved = json.loads(_thresholds_file().read_text("utf-8"))
    except (OSError, ValueError):
        saved = {}
    out = {}
    for m in METRICS:
        s = saved.get(m) if isinstance(saved, dict) and isinstance(saved.get(m), dict) else {}
        out[m] = {k: float(s[k]) if isinstance(s.get(k), (int, float)) and not isinstance(s.get(k), bool) else DEFAULTS[m][k] for k in ("warn", "red")}
    return out


def set_thresholds(metric: str, warn: float | None = None, red: float | None = None, reset: bool = False) -> dict[str, dict[str, float]]:
    """Change one metric's thresholds (1–100, warn not above red), or put it back to the defaults."""
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {', '.join(METRICS)}")
    cur = thresholds()
    new = dict(DEFAULTS[metric]) if reset else {"warn": cur[metric]["warn"] if warn is None else float(warn), "red": cur[metric]["red"] if red is None else float(red)}
    for k, v in new.items():
        if not 1 <= v <= 100:
            raise ValueError(f"{k} must be between 1 and 100")
    if new["warn"] > new["red"]:
        raise ValueError("warn can't be above red")
    cur[metric] = new
    storage.write_json(_thresholds_file(), cur, indent=None)
    with _lock:
        _health.update(at=0.0, value=None)
    return cur


def read_health(refresh: bool = False, proc: str = "/proc", disk_path: str | None = None, alert: bool = True) -> dict[str, Any]:
    """Disk, CPU load, memory and swap now, each with its state from the thresholds. Cached 10 s."""
    with _lock:
        now = time.time()
        if not refresh and _health["value"] is not None and now - _health["at"] < HEALTH_TTL_S:
            return {**_health["value"], "cached": True}
    t = thresholds()
    res: dict[str, Any] = {"at": int(now * 1000), "ready": True, "why": "", "thresholds": t}
    path = disk_path or os.environ.get("AXF_VPS_DISK_PATH", "/") or "/"
    try:
        res["disk"] = {**disk_of(os.statvfs(path)), "path": path}
    except OSError as e:
        res["disk"] = None
        res["why"] = f"Can't read the disk at {path}: {e.strerror or e}"
    try:
        res["cpu"] = cpu_of(Path(proc, "loadavg").read_text(), os.cpu_count() or 1)
    except OSError:
        res["cpu"] = None
    try:
        info = meminfo(Path(proc, "meminfo").read_text())
        res["memory"], res["swap"] = memory_of(info), swap_of(info)
    except OSError:
        res["memory"] = res["swap"] = None
    res["states"] = {m: ("off" if not res.get(m) or (m == "swap" and res[m].get("none")) else level(res[m]["pct"], t[m])) for m in METRICS}
    res["ready"] = any(res.get(m) for m in METRICS)
    if not res["ready"]:
        res["why"] = res["why"] or "Can't read this server's numbers"
    if alert:
        res["alert"] = disk_alert(res)
    with _lock:
        _health.update(at=now, value=res)
    return {**res, "cached": False}


def disk_alert(h: dict[str, Any]) -> str:
    """Raise the disk alert once when it passes red; resolve it when it is back under. Returns raised|resolved|''."""
    d = h.get("disk")
    if not d:
        return ""
    red = h["states"]["disk"] == "error"
    if red and not _alerted["disk"]:
        _alerted["disk"] = True
        gb = d["free"] / 1024 ** 3
        cx.raise_alert({"source": ALERT_SOURCE, "key": ALERT_KEY, "severity": "error", "title": f"VPS disk {round(d['pct'])}% full",
                        "body": f"{gb:.1f} GB free on {d['path']}. The red line is {round(h['thresholds']['disk']['red'])}%. Server health shows the rest.",
                        "link": "view:server-health"})
        cx.log("system", f"VPS disk {d['pct']}% full (red from {h['thresholds']['disk']['red']}%)", "warn")
        return "raised"
    if not red and _alerted["disk"]:
        _alerted["disk"] = False
        cx.resolve_alerts([ALERT_KEY])
        return "resolved"
    return ""


def _watch() -> None:
    while True:
        time.sleep(WATCH_S)
        try:
            read_health(refresh=True)
        except Exception:  # noqa: BLE001 — the watch never dies over one bad read
            pass


def start_watch() -> None:
    """The disk alert without a page open. AXF_CLAUDE_BADGE_WATCH=0 turns it off (tests)."""
    if os.environ.get("AXF_CLAUDE_BADGE_WATCH", "1") != "0" and not any(t.name == "claude-badge-health" for t in threading.enumerate()):
        threading.Thread(target=_watch, name="claude-badge-health", daemon=True).start()
