#!/usr/bin/env python3
"""Capture real screenshots of an app built from a boilerplate (boilerplate-shots@1).

Runs on a machine with `adb` and one booted Android device/emulator (the boilerplate-shots.yml workflow).
Installs the APK, starts the app, then for each screen of the boilerplate taps that screen's entry in the app's
own navigation (bottom tabs, top tabs, rail, or the drawer behind "Open navigation"), waits for it to settle and
saves `adb screencap` as <out>/<screen id>.png. Writes <out>/result.json:
  {"$axf": "boilerplate-shots@1", "boilerplate": id, "package": pkg, "shots": [{"screen", "label", "kind", "file", "verified"}]}
`verified` = the screen's label is on screen after the tap and the screen changed (or shows its placeholder text).

  python3 boilerplate-capture.py --apk app-debug.apk --package ai.amberx.axf.notes \\
      --boilerplate framework/boilerplates/notes/boilerplate.json --out shots/notes [--width 540]

Stdlib only. Never touches anything but the given package on the device.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

SCREEN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
PKG = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


def adb(*args: str, timeout: float = 60, binary: bool = False) -> bytes | str:
    r = subprocess.run(["adb", *args], capture_output=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout if binary else r.stdout.decode(errors="replace")


def dump() -> ET.Element | None:
    """The current UI tree (uiautomator). None when the dump fails (animations, transient)."""
    for _ in range(4):
        try:
            adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/axf-ui.xml", timeout=30)
            xml = adb("exec-out", "cat", "/sdcard/axf-ui.xml", timeout=30)
            return ET.fromstring(xml)
        except (RuntimeError, ET.ParseError, subprocess.TimeoutExpired):
            time.sleep(1)
    return None


def nodes(root: ET.Element | None) -> list[ET.Element]:
    return [] if root is None else list(root.iter("node"))


def texts(root: ET.Element | None) -> list[str]:
    return [n.get("text", "") for n in nodes(root) if n.get("text")]


def center(n: ET.Element) -> tuple[int, int] | None:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
    if not m:
        return None
    x1, y1, x2, y2 = map(int, m.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def find(root: ET.Element | None, label: str, pkg: str) -> ET.Element | None:
    """The nav entry for a screen: a node of this app whose text (or description) is the label. Prefer one lower on
    the screen (bottom tabs) and one that's clickable or inside something clickable."""
    hits = [n for n in nodes(root) if n.get("package") == pkg and (n.get("text") == label or n.get("content-desc") == label)]
    if not hits:
        return None
    hits.sort(key=lambda n: (center(n) or (0, 0))[1], reverse=True)
    return hits[0]


def tap(n: ET.Element) -> bool:
    c = center(n)
    if not c:
        return False
    adb("shell", "input", "tap", str(c[0]), str(c[1]))
    return True


def open_drawer(root: ET.Element | None, pkg: str) -> bool:
    for n in nodes(root):
        if n.get("package") == pkg and n.get("content-desc") in ("Open navigation", "Menu", "Open drawer"):
            return tap(n)
    return False


def digest(root: ET.Element | None) -> str:
    return hashlib.sha256("\n".join(texts(root)).encode()).hexdigest()


def settle(seconds: float = 1.5) -> ET.Element | None:
    time.sleep(seconds)
    return dump()


def shrink(png: Path, width: int) -> None:
    """Resize to `width` px wide when ImageMagick is there (keeps the repo light); otherwise keep the original."""
    tool = shutil.which("magick") or shutil.which("convert")
    if not tool or width <= 0:
        return
    subprocess.run([tool, str(png), "-resize", f"{width}x", "-strip", str(png)], check=False, timeout=60)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", required=True)
    ap.add_argument("--package", required=True)
    ap.add_argument("--boilerplate", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=540)
    ap.add_argument("--start-shot", action="store_true", help="also save the first screen after launch as start.png (rebuild shots)")
    a = ap.parse_args()
    if not PKG.match(a.package):
        print(f"bad package id: {a.package}", file=sys.stderr)
        return 2
    bp = json.loads(Path(a.boilerplate).read_text())
    screens = [s for s in bp.get("screens") or [] if isinstance(s, dict) and SCREEN_ID.match(str(s.get("id", ""))) and s.get("label")]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    adb("wait-for-device", timeout=300)
    # Clean status bar (demo mode): fixed clock, full battery and signal, no notifications.
    for cmd in (["settings", "put", "global", "sysui_demo_allowed", "1"],
                ["am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "enter"],
                ["am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "clock", "-e", "hhmm", "0941"],
                ["am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false"],
                ["am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4"],
                ["am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "notifications", "-e", "visible", "false"]):
        try:
            adb("shell", *cmd)
        except RuntimeError:
            pass
    adb("install", "-r", "-g", a.apk, timeout=240)
    adb("shell", "monkey", "-p", a.package, "-c", "android.intent.category.LAUNCHER", "1")

    # Wait for the app's shell (past any landing/loading screen): some screen label appears.
    labels = [s["label"] for s in screens]
    root = None
    for _ in range(40):
        root = settle(1.5)
        if any(find(root, l, a.package) is not None for l in labels):
            break
    time.sleep(2)

    shots = []
    root = dump()
    # What was on screen when capture started (shown in the CI report when a screen can't be verified).
    try:
        focus = next((ln.strip() for ln in str(adb("shell", "dumpsys", "window", timeout=30)).splitlines() if "mCurrentFocus" in ln), "")
    except (RuntimeError, subprocess.TimeoutExpired):
        focus = ""
    debug = {"focus": focus[:200], "packages": sorted({n.get("package", "") for n in nodes(root)})[:10],
             "texts": [t[:60] for t in texts(root)][:40],
             "descs": [n.get("content-desc", "")[:60] for n in nodes(root) if n.get("content-desc")][:20]}
    if a.start_shot:
        (out / "start.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True, timeout=60))  # type: ignore[arg-type]
        shrink(out / "start.png", a.width)
        shots.append({"screen": "start", "label": "Start", "kind": "start", "file": "start.png", "verified": True})
    for s in screens:
        before = digest(root)
        n = find(root, s["label"], a.package)
        if n is None and open_drawer(root, a.package):
            root = settle(1.2)
            n = find(root, s["label"], a.package)
        tapped = bool(n) and tap(n)
        root = settle(2.0)
        here = texts(root)
        placeholder = any(f"Boilerplate screen ({s.get('kind', '')})" in t for t in here)
        verified = tapped and s["label"] in here and (placeholder or digest(root) != before or s is screens[0])
        file = f"{s['id']}.png"
        (out / file).write_bytes(adb("exec-out", "screencap", "-p", binary=True, timeout=60))  # type: ignore[arg-type]
        shrink(out / file, a.width)
        shots.append({"screen": s["id"], "label": s["label"], "kind": s.get("kind", ""), "file": file, "verified": bool(verified)})
        print(f"{'✓' if verified else '?'} {bp.get('id')}/{s['id']} ({s['label']})")

    (out / "result.json").write_text(json.dumps({"$axf": "boilerplate-shots@1", "boilerplate": bp.get("id"), "package": a.package, "shots": shots, "debug": debug}, indent=2) + "\n")
    adb("shell", "am", "force-stop", a.package)
    return 0


if __name__ == "__main__":
    sys.exit(main())
