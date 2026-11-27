"""Self-test for the builds live channel (python apps/console-web/server/test_builds_events.py; pytest picks the
test_* functions up too).

1. The command fans out: one POST /api/builds/updated reaches two connected screens as the same `builds.updated`
   event, at the same moment, carrying { build, state, rev, at } and nothing else.
2. The fallback watcher: a store revision that moved with no command emits `builds.updated` by itself; a move a
   command already covered, the first look and an unreadable store emit nothing; nobody connected = no polling.
3. Auth: the command and the merge-together press are refused without the console token; the stream is a read.
4. The stream: retry hint, heartbeat comments when idle, a clean end when the client is gone, a slow screen that
   never holds the others up, bad bodies refused with the field named.

Everything is in memory: no store, no console, no node, no file is touched.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import builds_events as BE  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TOKEN = "test-token"
EV = {"build": "pipeline-watch-test", "state": "running-ci", "rev": 42, "at": "2026-11-24T02:00:00.000Z"}


def auth(request: Request) -> None:
    """The console's rule, as main.py has it: the bearer token, or nothing gets in."""
    if request.headers.get("authorization") != f"Bearer {TOKEN}":
        raise HTTPException(401, "unauthorized")


def parse(frame: str) -> dict[str, Any]:
    """One SSE frame → { event, data }."""
    out: dict[str, Any] = {}
    for line in frame.strip().split("\n"):
        if line.startswith("event: "):
            out["event"] = line[7:]
        elif line.startswith("data: "):
            out["data"] = json.loads(line[6:])
    return out


async def opened(hub: BE.Hub, disconnected: Any = None) -> Any:
    """A connected screen: its stream, with the first frame (the retry hint) already read."""
    s = hub.stream(disconnected)
    first = await s.__anext__()
    assert first.startswith(f"retry: {BE.RETRY_MS}\n"), first
    return s


def client(hub: BE.Hub, lander: Any = None) -> TestClient:
    app = FastAPI()
    app.include_router(BE.router_for(auth, hub, lander=lander))
    return TestClient(app)


def test_command_fans_out_to_two_subscribers() -> None:
    async def run() -> None:
        hub = BE.Hub(marker=lambda: "1:", watch_s=0)
        a, b = await opened(hub), await opened(hub)
        assert hub.subscribers == 2
        out = hub.command({**EV, "steps": [{"id": "s1", "text": "never forwarded"}], "title": "nor this"})
        assert out["delivered"] == 2
        fa, fb = await asyncio.wait_for(a.__anext__(), 2), await asyncio.wait_for(b.__anext__(), 2)
        assert fa == fb, "both screens get the same event"
        got = parse(fa)
        assert got == {"event": "builds.updated", "data": EV}, got
        assert sorted(got["data"]) == ["at", "build", "rev", "state"], "the event carries no step data"
        # a second command: again one event each, in order
        hub.command({**EV, "state": "landed", "rev": 43})
        assert parse(await a.__anext__())["data"]["state"] == "landed"
        assert parse(await b.__anext__())["data"]["rev"] == 43
        await a.aclose()
        assert hub.subscribers == 1, "a closed stream is dropped at once"
        assert hub.command(EV)["delivered"] == 1
        await b.aclose()
        assert hub.subscribers == 0

    asyncio.run(run())


def test_command_route_through_http() -> None:
    hub = BE.Hub(marker=lambda: "1:", watch_s=0)
    c = client(hub)
    got: list[dict[str, Any]] = []

    async def run() -> None:
        a, b = await opened(hub), await opened(hub)
        r = await asyncio.to_thread(c.post, "/api/builds/updated", json=EV, headers={"Authorization": f"Bearer {TOKEN}"})
        assert r.status_code == 200 and r.json() == {"ok": True, "delivered": 2}, r.text
        got.extend([parse(await asyncio.wait_for(a.__anext__(), 2)), parse(await asyncio.wait_for(b.__anext__(), 2))])
        await a.aclose()
        await b.aclose()

    # the route publishes into queues owned by whichever loop reads them; asyncio queues without waiters are loop-free
    asyncio.run(run())
    assert got == [{"event": "builds.updated", "data": EV}] * 2, got


def test_auth_refused_without_token() -> None:
    hub = BE.Hub(marker=lambda: "1:", watch_s=0)
    calls: list[list[str]] = []
    c = client(hub, lander=lambda args: (calls.append(args), {"ok": True, "mergeTogether": "--off" not in args, "waiting": ["a", "b"]})[1])
    assert c.post("/api/builds/updated", json=EV).status_code == 401
    assert c.post("/api/builds/updated", json=EV, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.post("/api/builds/merge-together", json={}).status_code == 401
    assert hub.sent == 0 and calls == [], "a refused command reaches nobody"
    ok = {"Authorization": f"Bearer {TOKEN}"}
    assert c.post("/api/builds/updated", json=EV, headers=ok).status_code == 200
    assert hub.sent == 1
    # the stream's status is a read, like the stream itself: no token asked
    st = c.get("/api/builds/events/status").json()
    assert st["$axf"] == "builds-events@1" and st["commands"] == 1 and st["subscribers"] == 0, st
    # bad bodies: refused, the field named, nothing sent
    for body, word in [({"build": "../etc", "state": "x"}, "build"), ({"build": "b", "state": "Not A State"}, "state"), ([1, 2], "JSON object")]:
        r = c.post("/api/builds/updated", json=body, headers=ok)
        assert r.status_code == 400 and word in r.json()["detail"], r.text
    r = c.post("/api/builds/updated", content=b"not json", headers={**ok, "Content-Type": "application/json"})
    assert r.status_code == 400
    assert hub.sent == 1
    # a rev that is not a number, a missing at: still one clean event
    ev = BE.clean_event({"build": "b", "state": "merging", "rev": "x"})
    assert ev["rev"] == 0 and ev["at"].endswith("Z") and ev["build"] == "b"
    # the merge-together press goes to the lander, with who pressed; every screen is told to read again
    r = c.post("/api/builds/merge-together", json={}, headers=ok)
    assert r.status_code == 200 and r.json()["waiting"] == ["a", "b"], r.text
    assert calls == [["merge-together", "--by", "console"]], calls
    assert c.post("/api/builds/merge-together", json={"off": True}, headers=ok).json()["mergeTogether"] is False
    assert calls[-1] == ["merge-together", "--off", "--by", "console"]
    assert hub.sent == 3
    # the builds the press named (the orchestrator sends its merge line, with the reason it shows): passed on as ids
    r = c.post("/api/builds/merge-together", json={"builds": ["a", "b"], "reason": {"title": "Merge together", "description": "…"}}, headers=ok)
    assert r.status_code == 200 and calls[-1] == ["merge-together", "--builds", "a,b", "--by", "console"], calls[-1]
    assert c.post("/api/builds/merge-together", json={"builds": ["a", "--by root"]}, headers=ok).status_code == 400, "an id is an id, never a flag"
    assert len(calls) == 3
    bad = client(hub, lander=lambda args: {"ok": False, "error": "the lander did not answer: node missing"})
    r = bad.post("/api/builds/merge-together", json={}, headers=ok)
    assert r.status_code == 502 and "did not answer" in r.json()["detail"]


def test_watcher_emits_on_a_rev_change() -> None:
    async def run() -> None:
        store = {"marker": "7:"}
        reads = {"n": 0}

        def marker() -> str:
            reads["n"] += 1
            if store["marker"] == "boom":
                raise RuntimeError("axf-data unreachable")
            return store["marker"]

        hub = BE.Hub(marker=marker, watch_s=0)  # watch_s=0: no background task; the test beats the watcher itself
        a, b = await opened(hub), await opened(hub)
        assert await hub.check_once() is None, "the first look only records where the store is"
        assert await hub.check_once() is None, "nothing moved: nothing is sent"
        # the store moved and nobody sent the command: the watcher covers it
        store["marker"] = "8:"
        ev = await hub.check_once()
        assert ev is not None and ev["rev"] == 8 and ev["build"] == "" and ev["state"] == "", ev
        for s in (a, b):
            got = parse(await asyncio.wait_for(s.__anext__(), 2))
            assert got["event"] == "builds.updated" and got["data"]["rev"] == 8, got
        assert hub.watched == 1
        # the store moved and the command did arrive: one event (the command's), not two
        store["marker"] = "9:"
        hub.command({**EV, "rev": 9})
        assert await hub.check_once() is None, "a command already covered this change"
        assert parse(await a.__anext__())["data"] == {**EV, "rev": 9}
        assert parse(await b.__anext__())["data"] == {**EV, "rev": 9}
        assert hub.watched == 1
        # a local file store carries no rev: its size and mtime moving is a change too
        store["marker"] = "0:120:1732410000"
        assert await hub.check_once() is not None
        store["marker"] = "0:130:1732410005"
        ev = await hub.check_once()
        assert ev is not None and ev["rev"] == 0
        for s in (a, b):
            assert [parse(await s.__anext__())["data"]["rev"], parse(await s.__anext__())["data"]["rev"]] == [0, 0]
        # a store that cannot be read is not news, and does not lose the place
        store["marker"] = "boom"
        assert await hub.check_once() is None
        store["marker"] = "-1:"
        assert await hub.check_once() is None, "unreadable (rev -1) is not a change to announce"
        await a.aclose()
        await b.aclose()

    asyncio.run(run())


def test_watcher_runs_only_while_someone_is_connected() -> None:
    async def run() -> None:
        store = {"marker": "1:", "reads": 0}

        def marker() -> str:
            store["reads"] += 1
            return store["marker"]

        hub = BE.Hub(marker=marker, watch_s=0.02)
        await asyncio.sleep(0.08)
        assert store["reads"] == 0 and not hub.status()["watching"], "nobody connected: nothing is polled"
        s = await opened(hub)
        await asyncio.sleep(0.08)
        assert hub.status()["watching"] and store["reads"] >= 2
        store["marker"] = "2:"
        got = parse(await asyncio.wait_for(s.__anext__(), 2))
        assert got == {"event": "builds.updated", "data": {"build": "", "state": "", "rev": 2, "at": got["data"]["at"]}}, got
        await s.aclose()
        await asyncio.sleep(0.05)
        assert not hub.status()["watching"], "the last screen left: the watcher stops"
        n = store["reads"]
        await asyncio.sleep(0.08)
        assert store["reads"] == n

    asyncio.run(run())


def test_stream_heartbeat_disconnect_and_slow_screen() -> None:
    async def run() -> None:
        hub = BE.Hub(marker=lambda: "1:", watch_s=0, heartbeat_s=0.05)
        # idle: a comment line, not an event
        s = await opened(hub)
        beat = await asyncio.wait_for(s.__anext__(), 2)
        assert beat == ": keep-alive\n\n", beat
        await s.aclose()
        # the client went away: the stream ends by itself and the subscriber is gone
        gone = {"v": False}

        async def disconnected() -> bool:
            return gone["v"]

        s = await opened(hub, disconnected)
        assert hub.subscribers == 1
        gone["v"] = True
        left = [f async for f in s]
        assert left == [] and hub.subscribers == 0
        # a screen that reads nothing: its backlog folds into one "read again"; the other screen misses nothing
        slow, fast = await opened(hub), await opened(hub)
        seen = []
        for i in range(BE.QUEUE_MAX + 5):
            hub.command({**EV, "rev": i})
            seen.append(parse(await asyncio.wait_for(fast.__anext__(), 2))["data"]["rev"])
        assert seen == list(range(BE.QUEUE_MAX + 5))
        first = parse(await asyncio.wait_for(slow.__anext__(), 2))["data"]
        assert first["build"] == "" and first["rev"] == BE.QUEUE_MAX, first
        await slow.aclose()
        await fast.aclose()

    asyncio.run(run())


def test_no_runtime_file_writes() -> None:
    src = (HERE / "builds_events.py").read_text("utf-8")
    for word in ("write_text", "write_json", "write_bytes", "open(", ".dump("):
        assert word not in src, f"builds_events.py keeps its state in memory ({word})"


if __name__ == "__main__":
    test_command_fans_out_to_two_subscribers()
    test_command_route_through_http()
    test_auth_refused_without_token()
    test_watcher_emits_on_a_rev_change()
    test_watcher_runs_only_while_someone_is_connected()
    test_stream_heartbeat_disconnect_and_slow_screen()
    test_no_runtime_file_writes()
    print("builds events: command fans out to two subscribers, watcher emits on a rev change, auth refused without token, heartbeat + disconnect + slow screen OK")
