"""Live VPS gauges for the VPS plugin (the Maintenance plugin's Status tab, banner widget and dropdown).

Plain reads, no AI: load (1/5/15 min against the CPU count), memory, swap, every real filesystem, Docker per-container
CPU and memory, and the top processes. The console container sees the host's load, memory and swap; filesystems,
containers and processes come from the host snapshot (engine/maint.py ``live``) when it is fresh, else from what the
container can read itself. A short history (one sample per ``SAMPLE_S``) feeds the sparklines.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

SAMPLE_S = 20
HISTORY = 180  # 180 × 20 s = one hour
REAL_FS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "vfat", "ntfs", "fuseblk"}
_hist: deque[dict[str, Any]] = deque(maxlen=HISTORY)
_lock = threading.Lock()


def filesystems(mounts_text: str | None = None) -> list[dict[str, Any]]:
    """Every real filesystem once (by device), with its use; / first."""
    if mounts_text is None:
        try:
            mounts_text = Path("/proc/mounts").read_text()
        except OSError:
            mounts_text = ""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for ln in mounts_text.splitlines():
        parts = ln.split()
        if len(parts) < 3 or parts[2] not in REAL_FS or parts[0] in seen:
            continue
        mnt = parts[1].replace("\\040", " ")
        if mnt.startswith(("/snap", "/boot/efi", "/etc/")) or mnt in ("/etc/hosts", "/etc/hostname", "/etc/resolv.conf"):
            continue
        try:
            u = shutil.disk_usage(mnt)
        except OSError:
            continue
        if not u.total:
            continue
        seen.add(parts[0])
        out.append({"mount": mnt, "device": parts[0], "fs": parts[2], "total": u.total, "used": u.used, "free": u.free,
                    "pct": round(u.used / u.total * 100, 1)})
    out.sort(key=lambda d: (d["mount"] != "/", d["mount"]))
    return out


def _run(cmd: list[str], timeout: int = 15) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout or ""
    except (OSError, subprocess.TimeoutExpired):
        return 127, ""


def _pct(text: Any) -> float | None:
    try:
        return round(float(str(text).strip().rstrip("%")), 1)
    except ValueError:
        return None


def containers(parse_size: Any, run: Any = _run) -> list[dict[str, Any]]:
    """Per-container CPU % and memory from `docker stats --no-stream` (empty when Docker isn't reachable here)."""
    if run is _run and not shutil.which("docker"):
        return []
    code, out = run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], 20)
    if code != 0:
        return []
    rows = []
    for ln in out.splitlines():
        try:
            r = json.loads(ln)
        except ValueError:
            continue
        used, _, limit = str(r.get("MemUsage") or "").partition("/")
        rows.append({"name": str(r.get("Name") or r.get("ID") or "?")[:60], "cpu": _pct(r.get("CPUPerc")), "memPct": _pct(r.get("MemPerc")),
                     "mem": parse_size(used.strip()), "memLimit": parse_size(limit.strip())})
    rows.sort(key=lambda r: -(r["cpu"] or 0))
    return rows


def top_processes(n: int = 8, run: Any = _run) -> list[dict[str, Any]]:
    """The busiest processes by CPU, then memory (ps; what this place can see)."""
    code, out = run(["ps", "-eo", "pid,pcpu,pmem,rss,comm", "--sort=-pcpu", "--no-headers"], 10)
    if code != 0:
        return []
    rows = []
    for ln in out.splitlines()[:n]:
        p = ln.split(None, 4)
        if len(p) < 5:
            continue
        try:
            rows.append({"pid": int(p[0]), "cpu": float(p[1]), "memPct": float(p[2]), "rss": int(p[3]) * 1024, "name": p[4][:60]})
        except ValueError:
            continue
    return rows


def live(maint: Any, run: Any = _run) -> dict[str, Any]:
    """Everything this place can measure now (the host engine calls it too, for its snapshot)."""
    b = maint.basic("/")
    return {**b, "disks": filesystems(), "containers": containers(maint.parse_size, run), "top": top_processes(run=run)}


def _metric(name: str, label: str, pct: float | None, used: float | None, total: float | None, unit: str) -> dict[str, Any]:
    return {"id": name, "label": label, "pct": pct, "used": used, "total": total, "unit": unit}


def metrics(snap: dict[str, Any]) -> list[dict[str, Any]]:
    """The gauges, one per metric: load (as % of the CPUs), RAM, swap and each filesystem."""
    ld, m, sw = snap.get("load") or {}, snap.get("memory") or {}, snap.get("swap") or {}
    cpus = ld.get("cpus") or 1
    one = ld.get("1")
    out = [_metric("load", "Load", round(one / cpus * 100, 1) if isinstance(one, (int, float)) else None, one, cpus, "cpus"),
           _metric("ram", "RAM", m.get("pct"), m.get("used"), m.get("total"), "bytes"),
           _metric("swap", "Swap", sw.get("pct") if sw.get("total") else 0, sw.get("used"), sw.get("total"), "bytes")]
    disks = snap.get("disks") or ([snap["disk"]] if snap.get("disk") else [])
    for d in disks:
        mount = d.get("mount") or d.get("path") or "/"
        out.append(_metric("disk" if mount == "/" else f"disk:{mount}", f"Disk {mount}", d.get("pct"), d.get("used"), d.get("total"), "bytes"))
    return out


def sample(snap: dict[str, Any], now: float | None = None) -> None:
    """Keep one point per SAMPLE_S for the sparklines."""
    now = time.time() if now is None else now
    with _lock:
        if _hist and now - _hist[-1]["t"] < SAMPLE_S:
            return
        _hist.append({"t": int(now), **{x["id"]: x["pct"] for x in metrics(snap)}})


def history() -> list[dict[str, Any]]:
    with _lock:
        return list(_hist)


def gauges(maint: Any, host_snap: dict[str, Any] | None, fresh: bool) -> dict[str, Any]:
    """The Status tab's read: live basics, host-only parts from a fresh host snapshot, the metrics and their history."""
    here = live(maint)
    host = (host_snap or {}).get("live") if fresh else None
    snap = {**here}
    source = "console"
    if isinstance(host, dict):
        source = "host"
        for k in ("disks", "containers", "top"):
            if host.get(k):
                snap[k] = host[k]
    sample(snap)
    load = snap.get("load") or {}
    return {"at": maint.now_iso(), "source": source, "load": load, "memory": snap.get("memory"), "swap": snap.get("swap"),
            "disks": snap.get("disks") or [], "containers": snap.get("containers") or [], "top": snap.get("top") or [],
            "metrics": metrics(snap), "history": history(), "cpus": load.get("cpus") or os.cpu_count() or 1}


# ------------------------------------------------------------------ VPS view and banner widget settings (vps.json)

VIEWS = ("radial", "bars", "strip", "history")
MODES = ("icon", "value", "meters")
SIDES = ("left", "right")
# The heat scale's stops: theme colour tokens, so a theme (or skin) recolours them; positions in %.
HEAT_TOKENS = ("text", "muted", "border", "surface", "bg", "accent", "info", "success", "warning", "danger")
VPS_DEFAULTS: dict[str, Any] = {
    "view": "radial",           # Status tab view: radial | bars | strip | history
    "warnPct": 70,              # gauge thresholds: warning tone from here
    "highPct": 90,              # danger tone from here
    "bannerShow": True,         # the banner widget
    "bannerMode": "icon",       # icon (heat colour) | value (icon + %) | meters (icon + mini meter)
    "bannerMetrics": ["load", "ram", "swap", "disk"],
    "bannerSide": "right",
    "refreshS": 15,             # how often the widget and the Status tab read the gauges
    # white (low) → gray → black → red (high); on a dark theme text/muted/bg are light/gray/dark
    "heat": [{"at": 0, "token": "text"}, {"at": 40, "token": "muted"}, {"at": 70, "token": "bg"}, {"at": 100, "token": "danger"}],
}
VPS_LIMITS = {"warnPct": (1, 99), "highPct": (1, 100), "refreshS": (5, 600)}


def normalize_vps(raw: Any) -> dict[str, Any]:
    """Saved VPS settings over the defaults, each value checked; unknown keys dropped."""
    out = json.loads(json.dumps(VPS_DEFAULTS))
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if k == "view" and v in VIEWS:
            out[k] = v
        elif k == "bannerMode" and v in MODES:
            out[k] = v
        elif k == "bannerSide" and v in SIDES:
            out[k] = v
        elif k == "bannerShow":
            out[k] = bool(v)
        elif k == "bannerMetrics" and isinstance(v, list):
            out[k] = [str(x)[:80] for x in dict.fromkeys(v) if isinstance(x, str) and x][:12]
        elif k in VPS_LIMITS and isinstance(v, (int, float)) and not isinstance(v, bool):
            lo, hi = VPS_LIMITS[k]
            out[k] = int(min(hi, max(lo, v)))
        elif k == "heat" and isinstance(v, list):
            stops = [{"at": int(min(100, max(0, s.get("at", 0)))), "token": s["token"]} for s in v
                     if isinstance(s, dict) and s.get("token") in HEAT_TOKENS and isinstance(s.get("at", 0), (int, float))]
            if len(stops) >= 2:
                out[k] = sorted(stops, key=lambda s: s["at"])[:6]
    if out["highPct"] <= out["warnPct"]:
        out["highPct"] = min(100, out["warnPct"] + 1)
    return out


def load_vps(data_dir: Path) -> dict[str, Any]:
    try:
        return normalize_vps(json.loads((data_dir / "vps.json").read_text()))
    except (OSError, ValueError):
        return normalize_vps({})


def save_vps(data_dir: Path, patch: dict[str, Any]) -> dict[str, Any]:
    merged = normalize_vps({**load_vps(data_dir), **patch})
    tmp = data_dir / f".vps.json.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(merged, indent=1))
    os.replace(tmp, data_dir / "vps.json")
    return merged


def heat_mix(pct: float | None, stops: list[dict[str, Any]]) -> dict[str, Any]:
    """Where a level sits on the heat scale: the two stops it is between and how far (the web mixes the tokens)."""
    p = 0.0 if pct is None else max(0.0, min(100.0, float(pct)))
    for a, b in zip(stops, stops[1:]):
        if p <= b["at"]:
            span = max(1, b["at"] - a["at"])
            return {"from": a["token"], "to": b["token"], "t": round((p - a["at"]) / span, 3)}
    return {"from": stops[-1]["token"], "to": stops[-1]["token"], "t": 0.0}
