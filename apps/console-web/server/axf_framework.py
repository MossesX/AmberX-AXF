"""Puts the framework's Python packages (framework/python: axf_server, axf_libs, axf) on sys.path.

Every console server module and plugin server part that uses a framework package imports this first:

    import axf_framework  # noqa: F401 — framework/python on sys.path
    from axf_server import storage

It works the same in the Docker image (repo at /axf, also PYTHONPATH=/axf/framework/python), on the VPS (host clone
mounted over /axf) and in tests run from a checkout. AXF_ROOT wins when set, else the repo this file sits in.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
PYTHON_DIR = (Path(os.environ["AXF_ROOT"]).resolve() if os.environ.get("AXF_ROOT") else _HERE.parents[2]) / "framework" / "python"
if not (PYTHON_DIR / "axf_server").is_dir():  # AXF_ROOT pointing at a scratch clone in a test: use this checkout's copy
    PYTHON_DIR = _HERE.parents[2] / "framework" / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))
