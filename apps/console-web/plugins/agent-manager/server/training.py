"""Training: feed an agent's memory with knowledge from sources, on demand or on a schedule.

Job: {id, name, agentId, sources: [...], chunkSize, overlap, replace, schedule, lastRun, nextRun, status, autoRun}
Source types
  firecrawl-scrape  {url}                        one page → Markdown (Firecrawl)
  firecrawl-crawl   {url, limit, include[]}      a site section → Markdown pages (Firecrawl)
  firecrawl-search  {query, limit}               web search results → Markdown (Firecrawl)
  url               {url}                        plain fetch of a public page (no Firecrawl needed)
  repo              {paths: [globs]}             files from the AmberX AXF repo (e.g. framework/spec/*.md)
  text              {title, text}                pasted notes, docs, transcripts
  mcp-resource      {url, tokenEnv, uri}         a resource from an MCP server
  mcp-tool          {url, tokenEnv, tool, args}  the output of an MCP tool call
Schedules: manual · hourly · daily · weekly. A background thread runs due jobs (Settings → Plugins → Agent manager → scheduler).
"""
from __future__ import annotations

import fnmatch
import threading
import time
from typing import Any

from axf.contracts import agents as contract  # framework/python

from . import memory, store, toolkit

SOURCE_TYPES = contract.TRAINING_SOURCE_TYPES
PERIOD = contract.SCHEDULE_SECONDS
_running: set[str] = set()
_lock = threading.Lock()


def validate(job: dict[str, Any]) -> dict[str, Any]:
    """Contract validation (same rules on every port) + this host's schedule bookkeeping."""
    v = contract.validate_item("training", job, contract.Context(known=store.known(), builtins=toolkit.BUILTINS))
    if not v.ok:
        raise ValueError(v.errors[0])
    return {**v.item, "nextRun": next_run(v.item["schedule"])}


def next_run(sched: str, base: float | None = None) -> int | None:
    return int(((base or time.time()) + PERIOD[sched]) * 1000) if sched in PERIOD else None


def _docs(src: dict[str, Any], log) -> list[tuple[str, str]]:  # noqa: ANN001
    """(source label, text) pairs for one source."""
    t = src["type"]
    if t == "firecrawl-scrape":
        r = toolkit.fc_scrape(src["url"])
        return [(r["url"], f"# {r['title']}\n\n{r['markdown']}")]
    if t == "firecrawl-crawl":
        pages = toolkit.fc_crawl(src["url"], int(src.get("limit") or 20), src.get("include") or None)
        log(f"crawl {src['url']}: {len(pages)} pages")
        return [(p["url"], f"# {p['title']}\n\n{p['markdown']}") for p in pages if p["markdown"]]
    if t == "firecrawl-search":
        rows = toolkit.fc_search(src["query"], int(src.get("limit") or 5))
        log(f"search “{src['query']}”: {len(rows)} results")
        return [(r["url"], f"# {r['title']}\n\n{r['markdown']}") for r in rows if r["markdown"]]
    if t == "url":
        code, ctype, text = toolkit.http("GET", src["url"])
        if code >= 400:
            raise ValueError(f"{src['url']}: HTTP {code}")
        return [(src["url"], toolkit.page_text(text, ctype))]
    if t == "repo":
        out = []
        pats = [p.strip() for p in (src.get("paths") or []) if p.strip()]
        for fp in toolkit.walk_repo(store.ROOT):
            rel = str(fp.relative_to(store.ROOT))
            if any(fnmatch.fnmatch(rel, p) for p in pats) and fp.stat().st_size < 600_000:
                out.append((rel, f"File: {rel}\n\n{fp.read_text(errors='replace')}"))
                if len(out) >= 400:
                    log("repo: stopped at 400 files")
                    break
        log(f"repo {', '.join(pats)}: {len(out)} files")
        return out
    if t == "text":
        return [(src.get("title") or "pasted text", src.get("text") or "")]
    if t == "mcp-resource":
        return [(f"{src['url']} {src['uri']}", toolkit.mcp_call(src["url"], src.get("tokenEnv") or "", resource=src["uri"]))]
    if t == "mcp-tool":
        return [(f"{src['url']} {src['tool']}", toolkit.mcp_call(src["url"], src.get("tokenEnv") or "", tool=src["tool"], args=src.get("args") or {}))]
    raise ValueError(f"unknown source type {t}")


def run(job_id: str) -> dict[str, Any]:
    with _lock:
        if job_id in _running:
            raise ValueError("this job is already running")
        _running.add(job_id)
    started = time.time()
    lines: list[str] = []
    log = lambda m: lines.append(f"{time.strftime('%H:%M:%S')} {m}")  # noqa: E731
    try:
        job = store.get("training", job_id)
        agent = store.get("agents", job["agentId"])
        mcfg = memory.config(agent)
        store.upsert("training", {"id": job_id, "status": "running"})
        if job.get("replace", True):
            n = memory.remove(mcfg["scope"], job_id=job_id)
            if n:
                log(f"replaced {n} items from the previous run")
        added = 0
        errors = 0
        for src in job.get("sources") or []:
            try:
                for label, text in _docs(src, log):
                    chunks = memory.chunk(text, int(job.get("chunkSize") or 1200), int(job.get("overlap") or 120))
                    if not chunks:
                        continue
                    memory.add_many(mcfg["scope"], chunks, "knowledge", tags=job.get("tags") or [], source=label, job_id=job_id,
                                    embed=mcfg["type"] in ("vector", "hybrid"), embed_profile=mcfg["embedProfile"], max_items=max(mcfg["maxItems"], 20_000))
                    added += len(chunks)
            except Exception as e:  # noqa: BLE001 — one bad source never stops the rest
                errors += 1
                log(f"✗ {src.get('type')}: {str(e)[:240]}")
        status = "completed" if not errors else ("partial" if added else "failed")
        log(f"{status}: {added} knowledge chunks in {time.time() - started:.1f}s")
        store.upsert("training", {"id": job_id, "status": status, "lastRun": store.now_ms(), "lastAdded": added, "nextRun": next_run(job.get("schedule") or "manual"), "log": lines[-60:]})
        store.add_run({"kind": "training", "jobId": job_id, "agentId": job["agentId"], "status": status, "added": added, "log": lines[-60:]})
        return {"status": status, "added": added, "log": lines}
    except Exception as e:  # noqa: BLE001
        log(f"✗ {e}")
        try:
            j2 = store.items("training").get(job_id) or {}
            store.upsert("training", {"id": job_id, "status": "failed", "lastRun": store.now_ms(), "log": lines[-60:], "nextRun": next_run(j2.get("schedule") or "manual")})
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        _running.discard(job_id)


def run_async(job_id: str) -> None:
    threading.Thread(target=lambda: _quiet(job_id), daemon=True).start()


def _quiet(job_id: str) -> None:
    try:
        run(job_id)
    except Exception:  # noqa: BLE001
        pass


def running() -> list[str]:
    return sorted(_running)


# ---------------------------------------------------------------- scheduler

_started = False
last_tick: int = 0


def start_scheduler(is_active) -> None:  # noqa: ANN001 — callable telling whether the plugin is enabled
    global _started
    if _started:
        return
    _started = True

    def loop() -> None:
        while True:
            time.sleep(60)
            try:
                global last_tick
                last_tick = store.now_ms()
                if not is_active() or not store.load_settings().get("scheduler", True):
                    continue
                now = store.now_ms()
                for j in store.items("training").values():
                    if j.get("schedule") in PERIOD and j.get("nextRun") and j["nextRun"] <= now and j["id"] not in _running:
                        _quiet(j["id"])
            except Exception:  # noqa: BLE001
                continue
    threading.Thread(target=loop, name="axf-agent-training", daemon=True).start()
