#!/usr/bin/env python3
"""Shrink rebuild/boilerplate screenshots so they stay light in the repo (rebuild log rule).

  python3 framework/cli/shrink-shots.py <dir|file.png> [...] [--max-width 1200] [--colors 256] [--dry-run]

Every PNG under the given paths is scaled down to at most --max-width pixels wide (keeping its aspect ratio) and
re-saved as an adaptive-palette PNG; a file is only replaced when the result is smaller. Screenshots of flat UI
survive a 256-colour palette with no visible loss. Needs Pillow; without it, prints a notice and changes nothing.
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path


def shrink(path: Path, max_width: int, colors: int, dry: bool) -> tuple[int, int]:
    from PIL import Image  # imported here so a missing Pillow is a notice, not a crash

    before = path.stat().st_size
    with Image.open(path) as im:
        im.load()
        img = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
    if img.width > max_width:
        h = round(img.height * max_width / img.width)
        img = img.resize((max_width, h), Image.LANCZOS)
    if img.mode == "RGBA":
        q = img.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.Dither.NONE)
    else:
        q = img.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    after = buf.tell()
    if after < before and not dry:
        path.write_bytes(buf.getvalue())
        return before, after
    return before, before if not dry else min(before, after)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--max-width", type=int, default=1200)
    ap.add_argument("--colors", type=int, default=256)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("shrink-shots: Pillow not installed (pip install pillow); screenshots left as they are")
        return 0
    files: list[Path] = []
    for p in map(Path, a.paths):
        if p.is_dir():
            files += sorted(f for f in p.rglob("*.png") if f.is_file() and not f.is_symlink())
        elif p.suffix.lower() == ".png" and p.is_file():
            files.append(p)
    total_b = total_a = 0
    bad = []
    for f in files:
        try:
            b, af = shrink(f, a.max_width, a.colors, a.dry_run)
        except Exception:  # an empty or broken capture: leave it, report it
            bad.append(str(f)); continue
        total_b += b
        total_a += af
    mb = lambda n: f"{n / 1_048_576:.1f} MB"
    if bad:
        print(f"shrink-shots: {len(bad)} unreadable PNG(s) left as they are: " + ", ".join(bad[:5]) + (" …" if len(bad) > 5 else ""))
    print(f"shrink-shots: {len(files)} PNGs, {mb(total_b)} → {mb(total_a)}" + (" (dry run)" if a.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
