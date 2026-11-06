"""Build docs and walkthroughs (server part). Mounted at /api/plugins/build-docs/ (console token on every route, 404
while the plugin is off). Every rule lives in the plugin's Node core; this file runs cli.mjs, talks to the AI
(axf.llm@1), GitHub (the docs pull request) and Vinny (axf.vinny@1: the one veto call that records a video on the VPS).

  GET  index                 builds and steps the right-click menus offer (built / complete, or steps done)
  GET  options               dialog choices (lengths, audiences, voices, design packages, layouts) and defaults
  GET  ai-status             is an AI provider there? (no = template docs / the fallback script)
  GET  jobs                  every job, newest first (build-docs-job@1)
  GET  job?id=               one job with its script, docs and the VPS command it records with
  GET  source?target=        what a build (or build/step) is made of, and the video's focus picks
  GET  file?id=&name=        a job's output: out/walkthrough.mp4 (range requests), out/walkthrough.vtt, out/poster.jpg,
                             out/transcript.md, script.json, docs/<build>.md, run.log
  POST docs                  {targets, options} → a docs job: gather, write (AI or template), PR, link in the plan
  POST video                 {targets, options} → a video job: gather, plan the script (AI or fallback); waits for approval
  POST script                {id, edits | script} → change the script before it is approved
  POST approve               {id} → approve the script: one veto call on axHub runs the recorder in a heavy slot
  POST cancel                {id}
  POST rerun                 {id, tweaks?} → the same job again with changed options (a docs job runs straight away;
                             a video plans its script again)
  POST remove                {id} → delete a finished job and its files
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github

router = APIRouter()
FOLDER = Path(__file__).resolve().parent.parent.name
CLI = Path(__file__).resolve().parent.parent / "cli.mjs"
ROOT = CLI.parents[4]
MAIN = "main"


def run(req: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), json.dumps(req)], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"Build docs could not run: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def must(r: dict[str, Any], code: int = 400) -> dict[str, Any]:
    if not r.get("ok"):
        raise HTTPException(code, str(r.get("error") or "failed")[:600])
    return r


def _by(request: Request) -> str:
    user = getattr(request.state, "axf_user", None)
    return str(getattr(user, "name", "") or "console")


def _llm() -> Any:
    return plugin_services.get("axf.llm@1")


def _say(job_id: str, **patch: Any) -> None:
    run({"op": "update", "id": job_id, "patch": patch})


# ---------------------------------------------------------------- AI

def _ask_all(prompts: list[dict[str, Any]], want: bool) -> tuple[list[str], str]:
    """One model answer per prompt ('' where there is none). Second value: why there is no AI, if so."""
    if not want:
        return ["" for _ in prompts], "AI off for this job"
    svc = _llm()
    if not svc:
        return ["" for _ in prompts], "no AI provider (AI assistant off)"
    out: list[str] = []
    why = ""
    for p in prompts:
        try:
            r = svc.complete(p["messages"], system=p["system"], params={"max_tokens": int(p.get("maxTokens") or 3000)})
            out.append(str(r.get("text") or ""))
        except Exception as e:  # noqa: BLE001 — the template takes over, and the job says why
            out.append("")
            why = f"the AI provider failed ({str(e)[:160]})"
    return out, why


# ---------------------------------------------------------------- GitHub: the docs pull request

def _gh() -> github.GitHubClient:
    return github.GitHubClient(lambda: os.environ.get("GITHUB_TOKEN", ""), base_url=github.api_base_from_env(), user_agent="axf-console-build-docs",
                               timeout=20, max_bytes=4_000_000)


def _repo() -> str:
    return cx.GITHUB_REPO or "MossesX/AmberX-AXF"


def open_docs_pr(job: dict[str, Any], files: list[dict[str, Any]], gh: Any = None) -> dict[str, Any]:
    """A branch off main with the docs files, and a pull request into main (the merge queue lands it when CI is green)."""
    gh = gh or _gh()
    repo = _repo()
    base = gh.json("GET", github.repo_path(repo, "git", "ref", "heads", MAIN))["object"]["sha"]
    first = (job.get("targets") or [{}])[0].get("build", "build")
    branch = f"docs/{first}-{job['id'][-4:]}"
    gh.json("POST", github.repo_path(repo, "git", "refs"), {"ref": f"refs/heads/{branch}", "sha": base})
    for f in files:
        sha = None
        try:
            cur = gh.json("GET", github.repo_path(repo, "contents", *f["path"].split("/"), query={"ref": branch}))
            sha = cur.get("sha") if isinstance(cur, dict) else None
        except github.GitHubError as e:
            if e.status != 404:
                raise
        body = {"message": f"docs: {f['path']} ({f['build']})", "branch": branch, "content": base64.b64encode(f["text"].encode()).decode()}
        if sha:
            body["sha"] = sha
        gh.json("PUT", github.repo_path(repo, "contents", *f["path"].split("/")), body)
    lines = [f"Documentation written by the Build docs plugin (job `{job['id']}`, {job.get('mode') or 'template'}).", ""]
    lines += [f"- `{f['path']}` for build `{f['build']}`" for f in files]
    lines += ["", f"Audience: {job['options'].get('audience')}, depth: {job['options'].get('depth')}."]
    if job["options"].get("notes"):
        lines += ["", f"Covered on request: {job['options']['notes']}"]
    lines += ["", "Docs only: no code changes. The merge queue lands it once CI is green."]
    pr = gh.json("POST", github.repo_path(repo, "pulls"), {"title": f"docs: {job.get('title') or first}"[:120], "head": branch, "base": MAIN, "body": "\n".join(lines)})
    return {"number": int(pr.get("number") or 0), "url": str(pr.get("html_url") or ""), "branch": branch}


# ---------------------------------------------------------------- Plan Studio: attach the result to the build's plan

def link_plans(job: dict[str, Any], kind: str, url: str, label: str, plans: Any = None) -> list[str]:
    """Every plan whose build is one of the job's builds gets a Docs link (kind doc) and, for a video, an attachment."""
    svc = plans or plugin_services.get("plans@1")
    if not svc or not url:
        return []
    builds = {t.get("build") for t in job.get("targets") or []}
    done: list[str] = []
    try:
        for p in svc.list():
            if not isinstance(p, dict) or (p.get("build") or {}).get("id") not in builds:
                continue
            full = svc.get(p["id"]) or p
            links = [x for x in full.get("links") or [] if x.get("ref") != url]
            links.append({"kind": "doc", "ref": url, "label": label[:200], "job": job["id"], "media": kind})
            change: dict[str, Any] = {**full, "links": links}
            if kind == "video":
                att = [a for a in full.get("attachments") or [] if a.get("url") != url]
                att.append({"kind": "video", "name": label[:200], "url": url, "transcript": ""})
                change["attachments"] = att
            r = svc.save(change, by="build-docs", force=True)
            if r.get("ok") is not False:
                done.append(p["id"])
    except Exception:  # noqa: BLE001 — a plan link is a nice-to-have; the job is still done
        return done
    return done


def page_link(job_id: str) -> str:
    """The console link that opens the job on the Docs & videos page (the video needs the console token to play)."""
    return f"#/{FOLDER}?job={job_id}"


# ---------------------------------------------------------------- workers

def docs_worker(job_id: str) -> None:
    try:
        prep = must(run({"op": "prepare", "id": job_id}, timeout=300))
        job = must(run({"op": "get", "id": job_id}))["job"]
        answers, why = _ask_all(prep["prompts"], job["options"].get("ai", True))
        if why and job["options"].get("ai", True):
            _say(job_id, say=f"Template docs: {why}")
        files = must(run({"op": "write-docs", "id": job_id, "answers": answers}))["files"]
        job = must(run({"op": "get", "id": job_id}))["job"]
        if job.get("cancel"):
            return
        try:
            pr = open_docs_pr(job, files)
        except Exception as e:  # noqa: BLE001 — the docs are kept in the job; say what GitHub answered
            _say(job_id, state="failed", message=f"Docs written (kept in the job), but the pull request failed: {str(e)[:300]}", say="Pull request failed")
            return
        docs = [{"path": f["path"], "build": f["build"], "url": f"https://github.com/{_repo()}/blob/{pr['branch']}/{f['path']}"} for f in files]
        plans = link_plans(job, "docs", pr["url"], f"Docs: {job.get('title')} (PR {pr['number']})")
        _say(job_id, state="done", outputs={"pr": pr, "docs": docs, "plans": plans}, message=f"PR {pr['number']} is open; the merge queue lands it when CI is green",
             say=f"Opened PR {pr['number']}" + (f", linked in {len(plans)} plan(s)" if plans else ""))
    except HTTPException as e:
        _say(job_id, state="failed", message=str(e.detail)[:400], say="Failed")
    except Exception as e:  # noqa: BLE001
        _say(job_id, state="failed", message=str(e)[:400], say="Failed")


def video_worker(job_id: str) -> None:
    try:
        prep = must(run({"op": "prepare", "id": job_id}, timeout=300))
        job = must(run({"op": "get", "id": job_id}))["job"]
        answers, why = _ask_all(prep["prompts"], job["options"].get("ai", True))
        if why and job["options"].get("ai", True):
            _say(job_id, say=f"Script from the build's screens: {why}")
        must(run({"op": "plan-script", "id": job_id, "answers": answers}))
    except HTTPException as e:
        _say(job_id, state="failed", message=str(e.detail)[:400], say="Failed")
    except Exception as e:  # noqa: BLE001
        _say(job_id, state="failed", message=str(e)[:400], say="Failed")


def _start(target: Any, job_id: str) -> None:
    threading.Thread(target=target, args=(job_id,), daemon=True, name=f"build-docs-{job_id}").start()


def send_recording(job_id: str, command: str, title: str) -> str:
    """The veto call that records an approved video on the VPS (axHub vps.run through Vinny)."""
    svc = plugin_services.get("axf.vinny@1")
    if svc is None:
        raise HTTPException(503, "Recording goes through Vinny: switch the Agent manager on.")
    ok, why = svc.ready()
    if not ok:
        raise HTTPException(503, f"Vinny can't send it to axHub: {why}")

    def send() -> None:
        try:
            svc.call("vps.run", {"command": command}, reason=f"Record the walkthrough video: {title}"[:200])
            _say(job_id, message="Sent to axHub: it runs when the countdown ends unless you deny it, then waits for a heavy slot",
                 say="Veto call sent (vps.run)")
        except Exception as e:  # noqa: BLE001
            _say(job_id, state="failed", message=f"axHub didn't take it: {str(e)[:300]}", say="Veto call failed")

    threading.Thread(target=send, daemon=True).start()
    return "Sending it to axHub…"


# ---------------------------------------------------------------- Codebase changes entry → build

def changes_dir() -> Path:
    """The change-log@1 folder (same order as changes.mjs: AXF_CHANGES_DIR, the hub's shared data, the repo snapshot)."""
    if os.environ.get("AXF_CHANGES_DIR"):
        return Path(os.environ["AXF_CHANGES_DIR"])
    hub = Path("/projects/amberx-axf/_data/changes")
    return hub if hub.is_dir() else ROOT / "changes"


_changes_cache: dict[str, Any] = {"at": 0.0, "map": {}}


def change_builds(build_ids: set[str], branches: dict[str, str], ttl: float = 300) -> dict[str, str]:
    """change id → build id (its buildRef, else its branch), so a right-click on a Codebase changes row finds the build.
    Read at most every `ttl` seconds (the log is a few hundred small files)."""
    if time.time() - _changes_cache["at"] < ttl and _changes_cache["map"]:
        return {k: v for k, v in _changes_cache["map"].items() if v in build_ids}
    out: dict[str, str] = {}
    d = changes_dir()
    if d.is_dir():
        for f in d.rglob("chg-*.json"):
            try:
                e = json.loads(f.read_text())
            except (OSError, ValueError):
                continue
            ref = (e.get("buildRef") or {}) if isinstance(e, dict) else {}
            bid = str(ref.get("id") or "") if isinstance(ref, dict) else ""
            if ":" in bid:
                bid = bid.split(":", 1)[1]
            bid = bid if bid in build_ids else branches.get(str(e.get("branch") or ""), "")
            if bid:
                out[str(e.get("id") or f.stem)] = bid
    _changes_cache.update(at=time.time(), map=out)
    return out


# ---------------------------------------------------------------- routes

@router.get("/index")
def index_() -> dict[str, Any]:
    r = must(run({"op": "index"}))
    # plan id → build id, so a right-click on a Plan Studio plan finds its build (plans@1 when Plan Studio is on)
    plans: dict[str, str] = {}
    svc = plugin_services.get("plans@1")
    if svc:
        try:
            for p in svc.list():
                b = (p.get("build") or {}).get("id") if isinstance(p, dict) else None
                if b:
                    plans[str(p.get("id"))] = str(b)
        except Exception:  # noqa: BLE001 — the menus still work for every other place
            pass
    return {**r, "plans": plans, "changes": change_builds({b["id"] for b in r.get("builds") or []}, {b["branch"]: b["id"] for b in r.get("builds") or [] if b.get("branch")})}


@router.get("/options")
def options() -> dict[str, Any]:
    return must(run({"op": "options"}))


@router.get("/ai-status")
def ai_status() -> dict[str, Any]:
    svc = _llm()
    return {"ok": True, "available": bool(svc), "message": "" if svc else "No AI provider: docs use the template and videos the build's screens in order."}


@router.get("/jobs")
def jobs() -> dict[str, Any]:
    r = must(run({"op": "list"}))
    _link_finished(r["jobs"])
    return r


@router.get("/job")
def job(id: str) -> dict[str, Any]:  # noqa: A002 — the query parameter is called id
    return must(run({"op": "get", "id": id}), 404)


@router.get("/source")
def source(target: str) -> dict[str, Any]:
    return must(run({"op": "source", "target": target}, timeout=180), 404)


@router.get("/file")
def file(id: str, name: str) -> FileResponse:  # noqa: A002
    r = run({"op": "get", "id": id})
    if not r.get("ok"):
        raise HTTPException(404, "no such job")
    allowed = {"out/walkthrough.mp4", "out/walkthrough.vtt", "out/poster.jpg", "out/transcript.md", "script.json", "run.log"}
    if name not in allowed and not (name.startswith("docs/") and name.endswith(".md") and "/" not in name[5:] and ".." not in name):
        raise HTTPException(400, "not a job file")
    base = Path(must(run({"op": "options"}))["dataDir"]) / "jobs" / id
    p = (base / name).resolve()
    if base.resolve() not in p.parents or not p.is_file():
        raise HTTPException(404, "not made yet")
    types = {"mp4": "video/mp4", "vtt": "text/vtt", "jpg": "image/jpeg", "md": "text/markdown; charset=utf-8", "json": "application/json", "log": "text/plain; charset=utf-8"}
    return FileResponse(p, media_type=types.get(p.suffix.lstrip("."), "application/octet-stream"), filename=p.name if name.endswith(".mp4") else None)


@router.post("/docs")
async def docs(request: Request) -> dict[str, Any]:
    body = await request.json()
    r = must(run({"op": "create", "kind": "docs", "targets": (body or {}).get("targets"), "options": (body or {}).get("options"), "title": (body or {}).get("title") or "", "by": _by(request)}))
    _start(docs_worker, r["job"]["id"])
    return r


@router.post("/video")
async def video(request: Request) -> dict[str, Any]:
    body = await request.json()
    r = must(run({"op": "create", "kind": "video", "targets": (body or {}).get("targets"), "options": (body or {}).get("options"), "title": (body or {}).get("title") or "", "by": _by(request)}))
    _start(video_worker, r["job"]["id"])
    return r


@router.post("/script")
async def script(request: Request) -> dict[str, Any]:
    body = await request.json() or {}
    return must(run({"op": "edit-script", "id": body.get("id"), "edits": body.get("edits"), "script": body.get("script"), "by": _by(request)}))


@router.post("/approve")
async def approve(request: Request) -> dict[str, Any]:
    body = await request.json() or {}
    r = must(run({"op": "approve", "id": body.get("id"), "by": _by(request)}))
    try:
        msg = send_recording(r["job"]["id"], r["command"], r["job"].get("title") or r["job"]["id"])
    except HTTPException as e:
        _say(r["job"]["id"], state="script-ready", message=str(e.detail), say="Not sent: " + str(e.detail)[:200], force=True)
        raise
    return {**r, "message": msg}


@router.post("/cancel")
async def cancel(request: Request) -> dict[str, Any]:
    body = await request.json() or {}
    return must(run({"op": "cancel", "id": body.get("id"), "by": _by(request)}))


@router.post("/rerun")
async def rerun(request: Request) -> dict[str, Any]:
    body = await request.json() or {}
    r = must(run({"op": "rerun", "id": body.get("id"), "tweaks": body.get("tweaks") or {}, "by": _by(request)}))
    _start(video_worker if r["job"]["kind"] == "video" else docs_worker, r["job"]["id"])
    return r


@router.post("/remove")
async def remove(request: Request) -> dict[str, Any]:
    body = await request.json() or {}
    return must(run({"op": "remove", "id": body.get("id")}))


# A finished video is attached to its builds' plans (a link to the console's own file route) the first time the console
# lists jobs after the host runner finished: the runner itself can't reach the console.
_linked: set[str] = set()


def _link_finished(jobs_list: list[dict[str, Any]]) -> None:
    for j in jobs_list:
        if j.get("kind") == "video" and j.get("state") == "done" and j["outputs"].get("video") and not j["outputs"].get("plans") and j["id"] not in _linked:
            _linked.add(j["id"])
            plans = link_plans(j, "video", page_link(j["id"]), f"Walkthrough video: {j.get('title')}")
            if plans:
                _say(j["id"], outputs={"plans": plans}, say=f"Attached to {len(plans)} plan(s)")


@router.get("/finished")
def finished() -> dict[str, Any]:
    """Jobs done since the console last looked; finished videos are attached to their builds' plans here."""
    r = must(run({"op": "list"}))
    _link_finished(r["jobs"])
    cutoff = time.time() - 7 * 24 * 3600
    return {"ok": True, "jobs": [j for j in r["jobs"] if j.get("state") == "done" and j.get("finishedAt") and _ts(j["finishedAt"]) > cutoff]}


def _ts(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0
