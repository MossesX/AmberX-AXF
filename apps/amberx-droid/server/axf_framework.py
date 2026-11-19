"""Puts the framework's Python packages (framework/python: axf_server, axf.assistant_host) on sys.path.

Same job as the Dev Console's `server/axf_framework.py`. In the image the framework is copied to /app/framework/python
(and PYTHONPATH says so); in a checkout it is the repo's own `framework/python`. AMBERX_FRAMEWORK_PYTHON wins when set.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _find() -> Path | None:
    if os.environ.get("AMBERX_FRAMEWORK_PYTHON"):
        return Path(os.environ["AMBERX_FRAMEWORK_PYTHON"]).resolve()
    for parent in Path(__file__).resolve().parents:
        cand = parent / "framework" / "python"
        if (cand / "axf_server").is_dir() and (cand / "axf" / "assistant_host").is_dir():
            return cand
    return None


PYTHON_DIR = _find()
if PYTHON_DIR and str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))
