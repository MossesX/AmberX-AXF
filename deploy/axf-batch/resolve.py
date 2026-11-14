#!/usr/bin/env python3
"""vps.build_land's merge resolver, installed on the host as /opt/axf-batch/resolve.py (deploy/axf-batch/install.sh).

usage: resolve.py <prefer> [--main ours|theirs] [--no-regen] [--no-tests] [--json]
       prefer = ours|theirs (side whose deletions/scalars win on a true clash)
Exit 0 if every conflict resolved, 1 otherwise (prints unresolved paths).

This file holds no merge rules of its own (build land-batch-merge-main-each-finished, Nov 13 2026). The rules live in
the repo: framework/cli/land-resolve.py, driven by the generated-files@1 manifest (framework/spec/generated-files.json)
that the merge queue reads too. A clash in a generated file (control inventory, baked help packs, axf.lock.json and
src/axf, fixtures, tracker) takes main's copy, its generator reruns on the merged tree and the outputs are staged; a
real source clash stops with the file list. The resolver used is the one in the checkout being landed (the cwd), so a
merge is resolved by the rules of the tree it produces; the deployed /opt/axf copy is the fallback.
"""
import os
import sys

CANDIDATES = (
    os.path.join(os.getcwd(), "framework/cli/land-resolve.py"),
    os.environ.get("AXF_ROOT", "/opt/axf") + "/framework/cli/land-resolve.py",
)

for cand in CANDIDATES:
    if os.path.isfile(cand):
        os.execv(sys.executable, [sys.executable, "-I", cand, *sys.argv[1:]])

print("UNRESOLVED: no resolver (framework/cli/land-resolve.py not in the checkout or " + CANDIDATES[1] + ")")
sys.exit(1)
