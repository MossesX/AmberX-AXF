#!/usr/bin/env python3
"""Resolve the conflicts of a stopped merge in the current repo without a person (vps.build_land's resolver; the host
copy /opt/axf-batch/resolve.py hands over to this file when the repo has it).

    python3 framework/cli/land-resolve.py <prefer> [--main ours|theirs] [--no-regen] [--no-tests] [--json]
      prefer   ours|theirs: the side whose deletions and scalars win a true clash in a plain JSON / text file
      --main   which side is main (default: found from origin/main: the side that is, or descends from, main's head)

Rules, in order, per conflicted file (generated-files@1 manifest, framework/spec/generated-files.json, shared with
the auto-land runner and the merge queue, which read the same manifest):
  retired build profile   removed (the one build profile `all`, Brett Nov 7 2026)
  modify / delete         the preferred side
  regen                   main's copy, then its generator runs on the merged tree (control inventory, help bake,
                          framework re-bake + lock, fixtures, tracker) and the outputs are staged
  union-json              both sides' keys, 3-way by key; main wins a scalar clash
  union-lines             both sides' lines (git merge-file --union)
  main                    main's copy
  other .json             3-way merge by key (prefer wins a scalar clash)
  .md .css .txt .yml      both sides' lines
  anything else           a real source clash: left for a person (exit 1, "UNRESOLVED: …")
After regenerating, each generator's check and the manifest's tests run; a red one is reported and exits 1 so the
land stops before the commit. Nothing here commits: the caller does.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

args = [a for a in sys.argv[1:] if not a.startswith("--")]
flags = [a for a in sys.argv[1:] if a.startswith("--")]
prefer = args[0] if args else "theirs"
if prefer not in ("ours", "theirs"):
    print("usage: land-resolve.py <ours|theirs> [--main ours|theirs] [--no-regen] [--no-tests] [--json]"); sys.exit(2)
opt_main = next((f.split("=", 1)[1] for f in flags if f.startswith("--main=")), None)
if opt_main is None and "--main" in sys.argv:
    i = sys.argv.index("--main"); opt_main = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
    if opt_main in args: args.remove(opt_main)
no_regen = "--no-regen" in flags
no_tests = "--no-tests" in flags
as_json = "--json" in flags

MANIFEST_PATH = "framework/spec/generated-files.json"


def git(*a, inp=None):
    return subprocess.run(["git", *a], capture_output=True, text=True, input=inp)


def stage(n, path):
    r = git("show", f":{n}:{path}")
    return r.stdout if r.returncode == 0 else None


def main_side():
    """Which side of this merge is main: the side whose commit is main's head or descends from it."""
    if opt_main in ("ours", "theirs"):
        return opt_main
    main = "origin/main" if git("rev-parse", "-q", "--verify", "origin/main").returncode == 0 else "main"
    main_sha = git("rev-parse", main).stdout.strip()
    sides = (("theirs", "MERGE_HEAD"), ("ours", "HEAD"))  # merging main into a branch is the common direction
    for side, ref in sides:
        if main_sha and git("rev-parse", ref).stdout.strip() == main_sha:
            return side
    for side, ref in sides:
        if git("merge-base", "--is-ancestor", main, ref).returncode == 0:
            return side
    return "theirs" if prefer == "ours" else "ours"


MAIN = main_side()
MISSING = object()


def merge3(b, o, t, win):
    """3-way merge of JSON values. o = ours, t = theirs; `win` names the side whose scalar wins a true clash."""
    if o == t: return o
    if b == o: return t
    if b == t: return o
    if isinstance(o, dict) and isinstance(t, dict):
        bd = b if isinstance(b, dict) else {}
        out = {}
        for k in list(o.keys()) + [k for k in t.keys() if k not in o]:
            ov, tv, bv = o.get(k, MISSING), t.get(k, MISSING), bd.get(k, MISSING)
            if ov is MISSING:
                if bv is not MISSING and bv == tv: continue  # ours deleted, theirs unchanged
                out[k] = tv; continue
            if tv is MISSING:
                if bv is not MISSING and bv == ov: continue
                out[k] = ov; continue
            out[k] = merge3(None if bv is MISSING else bv, ov, tv, win)
        return out
    if isinstance(o, list) and isinstance(t, list):
        def key(x):
            return x.get("id") if isinstance(x, dict) and "id" in x else None
        if (o or t) and all(key(x) is not None for x in o + t):
            bl = {key(x): x for x in (b or []) if isinstance(x, dict) and "id" in x} if isinstance(b, list) else {}
            tm = {key(x): x for x in t}
            om = {key(x): x for x in o}
            out = []
            for x in o:
                k = key(x)
                if k in tm: out.append(merge3(bl.get(k), x, tm[k], win))
                elif k in bl and bl[k] == x: continue  # theirs deleted it
                else: out.append(x)
            for x in t:
                k = key(x)
                if k in om: continue
                if k in bl and bl[k] == x: continue  # ours deleted it
                out.append(x)
            return out
        out = list(o)
        for x in t:
            if x not in out: out.append(x)
        return out
    return o if win == "ours" else t


# One build profile (Brett, Nov 7 2026): every profile was merged into `all`. Files of a retired profile are never
# kept by a merge (a modify/delete clash would otherwise bring them back). The list is read from the repo being merged
# (framework/plan/builds-store-core.mjs RETIRED_PROFILES); once `all` is the base profile (BASE_PROFILE = MERGED_PROFILE)
# its old folder exports (_claude/builds/profiles/all/orchestrator.json, framework/plan/profiles/all/) are stale too.
def stale_profile_paths():
    try:
        core = open("framework/plan/builds-store-core.mjs").read()
    except OSError:
        return [], []
    m = re.search(r"RETIRED_PROFILES\s*=\s*\[([^\]]*)\]", core)
    retired = re.findall(r"'([a-z0-9-]+)'", m.group(1)) if m else []
    dirs = [f"_claude/builds/profiles/{p}/" for p in retired] + [f"framework/plan/profiles/{p}/" for p in retired]
    exact = []
    if re.search(r"BASE_PROFILE\s*=\s*MERGED_PROFILE", core):
        exact.append("_claude/builds/profiles/all/orchestrator.json"); dirs.append("framework/plan/profiles/all/")
    return dirs, exact


STALE_DIRS, STALE_FILES = stale_profile_paths()


def stale(f):
    return f in STALE_FILES or any(f.startswith(d) for d in STALE_DIRS)


def load_manifest():
    """The generated-files@1 manifest from the tree being merged (main's copy when the working file is in conflict);
    a tree from before the manifest existed falls back to the copy next to this script."""
    text = None
    try:
        text = open(MANIFEST_PATH).read()
        json.loads(text)
    except (OSError, ValueError):
        text = stage(2 if MAIN == "ours" else 3, MANIFEST_PATH) or stage(1, MANIFEST_PATH)
    if not text:
        try:
            text = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spec", "generated-files.json")).read()
        except OSError:
            text = None
    if not text:
        return {"files": [], "generators": {}, "tests": []}
    try:
        return json.loads(text)
    except ValueError:
        return {"files": [], "generators": {}, "tests": []}


MANIFEST = load_manifest()
RULES = [(re.compile(f["match"]), f) for f in MANIFEST.get("files", []) if isinstance(f, dict) and "match" in f]
GENERATORS = MANIFEST.get("generators", {}) or {}


def rule_for(path):
    for rx, f in RULES:
        m = rx.match(path)
        if m:
            return f, m
    return None, None


def generator_for(path):
    f, m = rule_for(path)
    if not f or f.get("merge") != "regen" or f.get("generator") not in GENERATORS:
        return None
    gen = GENERATORS[f["generator"]]
    app = (m.group(f["app"]) or "") if f.get("app") else ""
    fill = lambda x: str(x).replace("{app}", app)
    gid = f"{f['generator']}:{app}" if app else f["generator"]
    return {"id": gid, "run": [fill(x) for x in gen.get("run", [])], "check": [fill(x) for x in gen["check"]] if gen.get("check") else None,
            "outputs": [fill(x) for x in gen.get("outputs", [])], "timeout": (gen.get("timeoutMs") or 120000) / 1000.0, "optional": gen.get("optional") is True}


def union_lines(f, o, b, t):
    with tempfile.TemporaryDirectory() as d:
        p = [os.path.join(d, n) for n in ("o", "b", "t")]
        for path, txt in zip(p, (o, b or "", t)): open(path, "w").write(txt)
        git("merge-file", "--union", p[0], p[1], p[2])
        open(f, "w").write(open(p[0]).read())
    git("add", "--", f)


def take(side, f):
    git("checkout", f"--{side}", "--", f); git("add", "--", f)


unresolved, resolved, regen_files, touched_additive = [], [], [], []
files = [f for f in git("diff", "--name-only", "--diff-filter=U").stdout.split("\n") if f]
for f in files:
    if stale(f):
        git("rm", "-q", "-f", "--", f); resolved.append(f); continue
    b, o, t = stage(1, f), stage(2, f), stage(3, f)
    if o is None or t is None:  # modify/delete
        keep = o if prefer == "ours" else t
        if keep is None: git("rm", "-q", "--", f)
        else:
            open(f, "w").write(keep); git("add", "--", f)
        resolved.append(f); continue
    rule, _ = rule_for(f)
    mode = rule.get("merge") if rule else None
    if mode == "regen":
        take(MAIN, f); regen_files.append(f); resolved.append(f); continue
    if mode == "main":
        take(MAIN, f); resolved.append(f); continue
    if mode == "union-lines":
        union_lines(f, o, b, t); touched_additive.append(f); resolved.append(f); continue
    ext = os.path.splitext(f)[1].lower()
    if mode == "union-json" or ext == ".json":
        try:
            m = merge3(json.loads(b) if b else None, json.loads(o), json.loads(t), MAIN if mode == "union-json" else prefer)
            open(f, "w").write(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
            git("add", "--", f); resolved.append(f)
            if mode == "union-json": touched_additive.append(f)
            continue
        except Exception as e:
            if mode == "union-json":  # one side is not JSON: main's copy
                take(MAIN, f); resolved.append(f); continue
            unresolved.append(f + " (json: %s)" % e); continue
    if ext in (".md", ".css", ".txt", ".yml", ".yaml") or f.endswith("THREADS.md"):
        union_lines(f, o, b, t); resolved.append(f); continue
    unresolved.append(f)

# a retired profile's file that merged in cleanly (tracked on one side only) goes too
for f in [x for x in git("ls-files", "--", "_claude/builds/profiles", "framework/plan/profiles").stdout.split("\n") if x and stale(x)]:
    git("rm", "-q", "-f", "--", f)


def run(cmd, timeout):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env={**os.environ, "CI": "1"})
        return r.returncode, ((r.stderr or "") + (r.stdout or "")).strip()[-400:]
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {int(timeout)}s"
    except OSError as e:
        return 127, str(e)


# the generators the regenerated files need, each once, on the merged tree; outputs are staged with the merge
regenerated, skipped, failed = [], [], []
if not unresolved and regen_files and not no_regen:
    plan = {}
    for f in regen_files:
        g = generator_for(f)
        if g and g["id"] not in plan: plan[g["id"]] = g
    for g in plan.values():
        code, text = run(g["run"], g["timeout"])
        if code:
            # an optional generator that refuses (rebake: the app's baked files were edited in place) leaves main's copy
            if g["optional"]:
                skipped.append(f"{g['id']} ({text.splitlines()[-1] if text else 'exit %d' % code})"); continue
            failed.append(f"{g['id']} failed to regenerate ({' '.join(g['run'])}): {text}"); continue
        regenerated.append(g["id"])
        outs = [o for o in g["outputs"] if os.path.exists(o)]
        if outs: git("add", "-A", "--", *outs)
        if g["check"]:
            code, text = run(g["check"], g["timeout"])
            if code: failed.append(f"{g['id']} regenerated but its check failed ({' '.join(g['check'])}): {text}")
    if not failed and not no_tests and (regen_files or touched_additive):
        for t in MANIFEST.get("tests", []) or []:
            code, text = run(list(t), 180)
            if code: failed.append(f"tests after regenerating failed ({' '.join(t)}): {text}"); break

result = {"resolved": resolved, "regenerated": regenerated, "skipped": skipped, "unresolved": unresolved, "failed": failed, "main": MAIN}
if as_json:
    print(json.dumps(result)); sys.exit(1 if unresolved or failed else 0)
if unresolved:
    print("UNRESOLVED: " + " ".join(unresolved)); sys.exit(1)
if failed:
    print("REGEN FAILED: " + " | ".join(failed)); sys.exit(1)
extra = f", regenerated {', '.join(regenerated)}" if regenerated else ""
if skipped: extra += f"; not regenerated, main's copy kept: {'; '.join(skipped)}"
print("resolved %d (main = %s%s)" % (len(files), MAIN, extra))
