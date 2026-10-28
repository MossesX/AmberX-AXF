"""AmberX server self-test: the wall, admin-only config, keys never returned, fallback + retries, redirects refused,
intent validation (bad model output, repair round, lists), size caps, the Claude plan switch + token refresh, SPA
path safety. No network: a fake provider transport and a fake Claude Code CLI.

    python3 apps/amberx-droid/server/test_server.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="amberx-test-"))
DIST = TMP / "dist"
(DIST / "assets").mkdir(parents=True)
(DIST / "index.html").write_text("<!doctype html><title>AmberX</title>INDEX")
(DIST / "assets" / "app.js").write_text("console.log('app')")
(DIST / ".secret").write_text("SECRET-FILE")
(TMP / "outside.txt").write_text("OUTSIDE")
SECRET = "s" * 40
os.environ.update({"AMBERX_DIST": str(DIST), "AMBERX_DATA_DIR": str(TMP / "data0"), "AMBERX_AI_KEEPALIVE": "off"})
for k in ("AMBERX_TRUST_WALL", "AMBERX_WALL_SECRET", "AMBERX_DEV_OPEN", "AMBERX_TOKEN", "AMBERX_OPENAI_API_KEY", "AMBERX_ANTHROPIC_API_KEY",
          "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AMBERX_CLAUDE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"):
    os.environ.pop(k, None)
sys.path.insert(0, str(HERE))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from axf_server import http, wall as wallmod  # noqa: E402
from router import Router  # noqa: E402

ok = 0
fail = 0


def check(name: str, cond: bool, detail: object = "") -> None:
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print(f"FAIL {name}: {detail}")


HOST = "amberx.amberxai.com"
ORIGIN = f"https://{HOST}"


def signed(name: str = "brett", role: str = "admin", perms: str = "*", ts: int | None = None, secret: str = SECRET) -> dict[str, str]:
    ts = int(time.time()) if ts is None else ts
    return {"host": HOST, "x-auth-via": "session", "x-auth-user": name, "x-auth-role": role, "x-auth-perms": perms,
            "x-auth-sig": wallmod.sign(secret, name, role, perms, HOST, ts)}


class Fake:
    """Provider transport: answers per URL from a queue (or a default), records every request."""

    def __init__(self) -> None:
        self.calls: list[http.Request] = []
        self.plan: dict[str, list] = {}

    def on(self, url_part: str, *answers) -> None:  # type: ignore[no-untyped-def]
        self.plan[url_part] = list(answers)

    def __call__(self, req: http.Request) -> http.Response:
        self.calls.append(req)
        for part, answers in self.plan.items():
            if part in req.url:
                a = answers.pop(0) if len(answers) > 1 else answers[0]
                if isinstance(a, Exception):
                    raise a
                status, body = a
                headers = {"content-type": "application/json"}
                if 300 <= status < 400:
                    headers["location"] = "https://evil.example/steal"
                return http.Response(status, headers, json.dumps(body).encode() if not isinstance(body, bytes) else body, req.url)
        return http.Response(404, {}, b"{}", req.url)

    def count(self, part: str) -> int:
        return sum(1 for c in self.calls if part in c.url)


def anthropic(text: str):  # type: ignore[no-untyped-def]
    return (200, {"content": [{"type": "text", "text": text}], "usage": {"input_tokens": 3, "output_tokens": 2}})


def openai(text: str):  # type: ignore[no-untyped-def]
    return (200, {"choices": [{"message": {"content": text}}]})


sleeps: list[float] = []
cli_calls: list[dict] = []


def fake_cli(profile, messages, system, model, max_tokens):  # type: ignore[no-untyped-def]
    from axf.assistant_host import providers
    cli_calls.append({"token": providers.resolve_key(profile), "model": model, "messages": messages})
    return '{"action": "add", "text": "from the plan"}'


refreshes: list[str] = []


def fake_refresh(refresh: str) -> dict:
    refreshes.append(refresh)
    return {"access": "sk-ant-oat01-" + "n" * 40, "refresh": "sk-ant-ort01-" + "r" * 40, "expiresAt": int(time.time() * 1000) + 8 * 3600_000}


def fresh(n: int):  # type: ignore[no-untyped-def]
    fake = Fake()
    os.environ["AMBERX_DATA_DIR"] = str(TMP / f"data{n}")
    r = Router(TMP / f"data{n}", transport=fake, cli=fake_cli, refresher=fake_refresh, sleep=sleeps.append)
    return fake, r, TestClient(main.make_app(r))


def wall_on() -> None:
    os.environ["AMBERX_TRUST_WALL"] = "1"
    os.environ["AMBERX_WALL_SECRET"] = SECRET


def wall_off() -> None:
    os.environ.pop("AMBERX_TRUST_WALL", None)
    os.environ.pop("AMBERX_WALL_SECRET", None)


A = signed()
W = {**A, "origin": ORIGIN}  # admin write from this site

# ---------------------------------------------------------------- the wall
wall_on()
fake, r, c = fresh(1)
check("no sign-in → 401", c.get("/api/ai/status", headers={"host": HOST}).status_code == 401)
check("admin session reads config", c.get("/api/ai/config", headers=A).status_code == 200)
bad = {**A, "x-auth-sig": A["x-auth-sig"][:-1] + ("0" if A["x-auth-sig"][-1] != "0" else "1")}
check("tampered signature refused", c.get("/api/ai/config", headers=bad).status_code == 403)
check("role swapped after signing refused", c.get("/api/ai/config", headers={**A, "x-auth-role": "admin", "x-auth-user": "mallory"}).status_code == 403)
old = signed(ts=int(time.time()) - 600)
check("old signature refused", c.get("/api/ai/config", headers=old).status_code == 403)
other = signed(secret="t" * 40)
check("signature with another secret refused", c.get("/api/ai/config", headers=other).status_code == 403)
check("other host refused", c.get("/api/ai/config", headers={**A, "host": "evil.amberxai.com"}).status_code == 403)
U = signed("guest", "user", "")
check("user reads status", c.get("/api/ai/status", headers=U).status_code == 200)
check("user can't read config", c.get("/api/ai/config", headers=U).status_code == 403)
check("user can't change config", c.put("/api/ai/config", headers={**U, "origin": ORIGIN}, json={"claude": "api"}).status_code == 403)
check("user can't set keys", c.post("/api/ai/keys/x", headers={**U, "origin": ORIGIN}, json={"key": "k" * 20}).status_code == 403)
check("user can't test", c.post("/api/ai/test/x", headers={**U, "origin": ORIGIN}).status_code == 403)
check("admin write without Origin refused", c.put("/api/ai/config", headers=A, json={"keepAliveMin": 5}).status_code == 403)
check("admin write from another site refused", c.put("/api/ai/config", headers={**A, "origin": "https://evil.example"}, json={"keepAliveMin": 5}).status_code == 403)
check("admin write from this site ok", c.put("/api/ai/config", headers=W, json={"keepAliveMin": 5}).json()["keepAliveMin"] == 5)
check("hub-bearer without the real token refused", c.get("/api/ai/status", headers={"host": HOST, "x-auth-via": "token", "authorization": "Bearer nope"}).status_code == 401)
os.environ["AMBERX_DEV_OPEN"] = "1"
check("dev-open ignored while the wall is trusted", c.get("/api/ai/config", headers={"host": HOST}).status_code == 401)
os.environ.pop("AMBERX_DEV_OPEN")
os.environ["AMBERX_TOKEN"] = "m" * 24
check("machine token is admin", c.get("/api/ai/config", headers={"host": HOST, "authorization": "Bearer " + "m" * 24}).status_code == 200)
check("wrong machine token refused", c.get("/api/ai/config", headers={"host": HOST, "authorization": "Bearer " + "x" * 24}).status_code == 401)
os.environ.pop("AMBERX_TOKEN")
wall_off()
check("wall off, no token, no dev → 401", c.get("/api/ai/status").status_code == 401)
check("forged wall headers ignored while the wall is off", c.get("/api/ai/config", headers=A).status_code == 401)
os.environ["AMBERX_DEV_OPEN"] = "1"
check("dev-open (wall off) lets local dev in", c.get("/api/ai/config").status_code == 200)
os.environ.pop("AMBERX_DEV_OPEN")
wall_on()
me = c.get("/api/me", headers=U).json()
check("/api/me says who", me["user"]["name"] == "guest" and me["admin"] is False and me["wall"] is True, me)

# ---------------------------------------------------------------- config + keys (write-only)
cfg = c.get("/api/ai/config", headers=A).json()
check("registry kinds offered", {"anthropic", "claude-code", "openai", "gemini", "xai", "deepseek", "mistral", "groq", "openrouter", "ollama", "custom"} <= {k["kind"] for k in cfg["kinds"]}, [k["kind"] for k in cfg["kinds"]])
check("no profiles yet", cfg["profiles"] == [] and cfg["active"] == "")
st = c.get("/api/ai/status", headers=U).json()
check("status says nothing set up", st["ok"] is False and "set up" in st["reason"], st)
res = c.put("/api/ai/config", headers=W, json={"profiles": [{"kind": "anthropic", "model": "claude-haiku-5-5"}, {"kind": "openai", "model": "gpt-5-mini"}, {"kind": "gemini"}]})
cfg = res.json()
ids = [p["id"] for p in cfg["profiles"]]
check("profiles added with ids", ids == ["anthropic-1", "openai-1", "gemini-1"], ids)
check("unknown kind refused", c.put("/api/ai/config", headers=W, json={"profiles": [{"kind": "nope"}]}).status_code == 400)
check("base URL refused for a fixed provider", c.put("/api/ai/config", headers=W, json={"profiles": [*cfg["profiles"], {"kind": "openai", "baseUrl": "https://evil.example"}]}).status_code == 400)
check("http base URL to another host refused", c.put("/api/ai/config", headers=W, json={"profiles": [*cfg["profiles"], {"kind": "custom", "baseUrl": "http://10.0.0.5:8000/v1"}]}).status_code == 400)
check("too many profiles refused", c.put("/api/ai/config", headers=W, json={"profiles": [{"kind": "openai"}] * 21}).status_code == 400)
check("labels for Claude", cfg["profiles"][0]["label"] == "Claude API")
API_KEY = "sk-ant-api03-" + "A" * 40
OAI_KEY = "sk-proj-" + "B" * 40
kr = c.post("/api/ai/keys/anthropic-1", headers=W, json={"key": API_KEY})
check("key saved", kr.status_code == 200 and kr.json()["profile"]["hasKey"] is True and kr.json()["profile"]["keySource"] == "saved", kr.text)
check("key not in the save answer", API_KEY not in kr.text and "AAAA" not in kr.text)
c.post("/api/ai/keys/openai-1", headers=W, json={"key": OAI_KEY})
cfg_text = c.get("/api/ai/config", headers=A).text
check("keys never in config", API_KEY not in cfg_text and OAI_KEY not in cfg_text and "BBBB" not in cfg_text)
check("subscription token on the API profile refused", c.post("/api/ai/keys/anthropic-1", headers=W, json={"key": "sk-ant-oat01-" + "c" * 40}).status_code == 400)
check("unknown profile → 404", c.post("/api/ai/keys/nope", headers=W, json={"key": "k" * 20}).status_code == 404)
saved = json.loads((TMP / "data1" / "ai.json").read_text())
check("keys stored on the server", saved["profiles"]["anthropic-1"]["key"] == API_KEY)
check("data file 0600", oct((TMP / "data1" / "ai.json").stat().st_mode & 0o777) == "0o600")
check("data folder 0700", oct((TMP / "data1").stat().st_mode & 0o777) == "0o700")
os.environ["AMBERX_GEMINI_API_KEY"] = "g" * 30
g = [p for p in c.get("/api/ai/config", headers=A).json()["profiles"] if p["id"] == "gemini-1"][0]
check("env key counts, not shown", g["hasKey"] and g["keySource"] == "env" and "ggg" not in json.dumps(g), g)
os.environ.pop("AMBERX_GEMINI_API_KEY")

# ---------------------------------------------------------------- calls: fallback, retries, redirects
fake.on("api.anthropic.com", (500, {"error": {"message": "overloaded"}}))
fake.on("api.openai.com", openai('{"action": "add", "text": "milk", "list": "Shopping"}'))
sleeps.clear()
pr = c.post("/api/ai/parse", headers={**U, "origin": ORIGIN}, json={"transcript": "add milk to shopping", "lists": ["Inbox", "Shopping"], "today": "2026-10-27"})
check("fallback answered", pr.status_code == 200 and pr.json()["answeredBy"] == "openai-1", pr.text)
check("intent passed through", pr.json().get("intent") == {"action": "add", "text": "milk", "list": "Shopping"}, pr.json())
check("5xx retried 3 times before falling back", fake.count("api.anthropic.com") == 3, fake.count("api.anthropic.com"))
check("backoff between retries", len(sleeps) == 2 and all(s > 0 for s in sleeps), sleeps)
first = [x for x in fake.calls if "anthropic" in x.url][0]
check("anthropic gets x-api-key + version", first.headers.get("x-api-key") == API_KEY and first.headers.get("anthropic-version") == "2023-06-01")
oc = [x for x in fake.calls if "openai" in x.url][0]
check("openai gets bearer + its max tokens field", oc.headers.get("authorization") == f"Bearer {OAI_KEY}" and "max_completion_tokens" in json.loads(oc.body), oc.body[:200])
check("every call has a timeout", all(x.timeout and x.timeout <= 60 for x in fake.calls))
check("every call has a size cap", all(x.max_bytes <= 2 * 1024 * 1024 for x in fake.calls))
st = c.get("/api/ai/status", headers=U).json()
check("status: ok through the fallback, says why", st["ok"] and st["provider"] == "OpenAI" and "Claude API" in st["reason"], st)

check("a provider that failed goes to the back of the line", [p["id"] for p in r.chain()][:2] == ["openai-1", "gemini-1"] or r.chain()[-1]["id"] == "anthropic-1", [p["id"] for p in r.chain()])
r.health.clear()
fake.calls.clear()
fake.on("api.anthropic.com", (401, {"error": {"message": "invalid x-api-key " + API_KEY}}))
r2 = r.complete([{"role": "user", "content": "hi"}], "", 10)
check("401 not retried", fake.count("api.anthropic.com") == 1, fake.count("api.anthropic.com"))
check("key scrubbed from errors", API_KEY not in json.dumps(r2["tried"]), r2["tried"])
r.health.clear()
fake.calls.clear()
fake.on("api.anthropic.com", (302, {}))
r3 = r.complete([{"role": "user", "content": "hi"}], "", 10)
check("redirect not followed", fake.count("evil.example") == 0 and fake.count("api.anthropic.com") == 1 and "redirect" in r3["tried"][0]["error"], r3["tried"])
r.health.clear()
fake.calls.clear()
fake.on("api.anthropic.com", http.HttpError("timed out"), anthropic("OK"))
sleeps.clear()
r4 = r.complete([{"role": "user", "content": "hi"}], "", 10)
check("timeout retried, then the active one answers", r4["profile"] == "anthropic-1" and fake.count("api.anthropic.com") == 2 and len(sleeps) == 1, (r4, fake.count("api.anthropic.com")))
fake.on("api.anthropic.com", (200, b"x" * 10))
r.health.clear()
fake.calls.clear()
fake.on("api.anthropic.com", http.ResponseTooLarge("too big"))
r5 = r.complete([{"role": "user", "content": "hi"}], "", 10)
check("too-big answer → next provider, not retried", r5["profile"] == "openai-1" and fake.count("api.anthropic.com") == 1, r5)
fake.on("api.anthropic.com", (500, {}))
fake.on("api.openai.com", (503, {}))
check("all fail → 503", c.post("/api/ai/summarize", headers={**U, "origin": ORIGIN}, json={"text": "hello"}).status_code == 503)
st = c.get("/api/ai/status", headers=U).json()
check("status red when nobody answers", st["ok"] is False and "No provider answers" in st["reason"], st)
# order + active
c.put("/api/ai/config", headers=W, json={"order": ["openai-1", "anthropic-1", "gemini-1"], "active": "openai-1"})
fake.on("api.openai.com", openai("OK"))
fake.on("api.anthropic.com", anthropic("OK"))
check("active profile asked first", r.complete([{"role": "user", "content": "x"}])["profile"] == "openai-1")
c.put("/api/ai/config", headers=W, json={"profiles": [p for p in c.get("/api/ai/config", headers=A).json()["profiles"] if p["id"] != "openai-1"]})
cfg = c.get("/api/ai/config", headers=A).json()
check("removed profile gone (with its key)", "openai-1" not in [p["id"] for p in cfg["profiles"]] and OAI_KEY not in (TMP / "data1" / "ai.json").read_text())
check("active moves on when its profile is removed", cfg["active"] == "anthropic-1", cfg["active"])
t = c.post("/api/ai/test/anthropic-1", headers=W).json()
check("test route", t["ok"] is True and t["profile"] == "anthropic-1", t)
check("test needs a known profile", c.post("/api/ai/test/zzz", headers=W).status_code == 404)

# ---------------------------------------------------------------- intents
P = {**U, "origin": ORIGIN}
body = {"transcript": "put eggs on the shopping list", "lists": ["Inbox", "Home › Shopping"], "today": "2026-10-27"}
fake.calls.clear()
fake.on("api.anthropic.com", anthropic("Sure! Here it is: not json"), anthropic('```json\n{"action": "add", "text": "eggs", "list": "Shopping"}\n```'))
pr = c.post("/api/ai/parse", headers=P, json=body)
check("bad JSON → one repair round → ok", pr.status_code == 200 and pr.json()["intent"]["text"] == "eggs" and fake.count("anthropic") == 2, (pr.text, fake.count("anthropic")))
repair = json.loads([x for x in fake.calls if "anthropic" in x.url][1].body)
check("repair round shows the bad answer and why", len(repair["messages"]) == 3 and "can't be used" in json.dumps(repair["messages"][-1]), repair["messages"])
fake.calls.clear()
fake.on("api.anthropic.com", anthropic('{"action": "explode"}'))
pr = c.post("/api/ai/parse", headers=P, json=body)
check("invalid twice → 422, no intent", pr.status_code == 422 and pr.json()["intent"] is None and fake.count("anthropic") == 2, pr.text)
fake.on("api.anthropic.com", anthropic('{"action": "add", "text": "eggs", "list": "Groceries"}'), anthropic('{"action": "add", "text": "eggs", "list": "Groceries", "create": true}'))
pr = c.post("/api/ai/parse", headers=P, json=body)
check("unknown list refused, then create:true accepted", pr.status_code == 200 and pr.json()["intent"].get("create") is True, pr.text)
fake.on("api.anthropic.com", anthropic('{"action": "move", "target": "eggs", "list": "Home › Shopping"}'))
check("list path accepted", c.post("/api/ai/parse", headers=P, json=body).status_code == 200)
fake.on("api.anthropic.com", anthropic('{"action": "add", "kind": "task", "title": "Call mum", "due": "friday", "priority": 3, "tags": ["Family", "#Phone"], "extra": "dropped", "tasks": [{"content": "dial", "priority": 9}]}'))
it = c.post("/api/ai/parse", headers=P, json=body).json()["intent"]
check("intent cleaned (spoken date, tags, unknown fields dropped)", it == {"action": "add", "kind": "task", "title": "Call mum", "tasks": [{"content": "dial"}], "tags": ["family", "phone"], "due": "2026-10-30", "priority": 3}, it)
fake.on("api.anthropic.com", anthropic('{"action": "rename-list", "target": "Inbox"}'))
check("rename without `to` refused", c.post("/api/ai/parse", headers=P, json=body).status_code == 422)
fake.on("api.anthropic.com", anthropic('{"action": "add", "text": "x", "priority": "high"}'))
check("bad priority refused", c.post("/api/ai/parse", headers=P, json=body).status_code == 422)
sysmsg = json.loads([x for x in fake.calls if "anthropic" in x.url][-1].body)["system"]
check("prompt carries the schema, today and the lists", '"rename-list"' in sysmsg and "2026-10-27" in sysmsg and "Home › Shopping" in sysmsg)

# summarize + ask
fake.on("api.anthropic.com", anthropic('{"title": "Trip", "summary": "Pack bags.", "tags": ["Travel"]}'))
s = c.post("/api/ai/summarize", headers=P, json={"text": "We need to pack bags for the trip."}).json()
check("summarize", s["title"] == "Trip" and s["summary"] == "Pack bags." and s["tags"] == ["travel"], s)
fake.calls.clear()
fake.on("api.anthropic.com", anthropic("Your notes say the code is 1234 [1]."))
a = c.post("/api/ai/ask", headers=P, json={"question": "what is the gate code?", "notes": [{"title": "Gate", "text": "code 1234", "list": "Home"}]}).json()
sent = json.loads(fake.calls[-1].body)
check("ask answers from the notes", a["answer"].startswith("Your notes say") and "code 1234" in sent["system"] and "ONLY the notes" in sent["system"], (a, sent["system"][:200]))

# prompt (AI snippets) + Molly (Oct 28 2026)
fake.on("api.anthropic.com", anthropic("step one\nstep two"))
pr = c.post("/api/ai/prompt", headers=P, json={"prompt": "plan a garden", "notes": [{"title": "Garden", "text": "tomatoes"}]})
sent = json.loads(fake.calls[-1].body)
check("prompt answers (a signed-in user may)", pr.status_code == 200 and pr.json()["answer"] == "step one\nstep two" and "read aloud" in sent["system"] and "tomatoes" in sent["system"], pr.text[:200])
check("prompt cap", c.post("/api/ai/prompt", headers=P, json={"prompt": "x" * 8001}).status_code == 413)
check("prompt required", c.post("/api/ai/prompt", headers=P, json={"prompt": " "}).status_code == 400)
check("Molly is admins only", c.post("/api/ai/molly", headers=P, json={"task": "status"}).status_code == 403)
AP = {**A, "origin": ORIGIN}
os.environ.pop("AMBERX_CONSOLE_TOKEN", None)
ms = c.get("/api/ai/molly/status", headers=A).json()
check("Molly without a console token: not connected, says why", ms["ok"] is False and "AMBERX_CONSOLE_TOKEN" in ms["reason"] and ms["fix"] == "token", ms)
check("Molly without a console token: 503", c.post("/api/ai/molly", headers=AP, json={"task": "status"}).status_code == 503)


class FakeConsole:
    def __init__(self):
        self.calls = []

    def call(self, method, path, body=None, timeout=None):
        self.calls.append((method, path, body))
        if path.startswith(main.MOLLY_ASK):
            return {"text": "CI is green.", "walkthrough": {"title": "Open CI", "steps": []}}
        return {"walkthroughs": []}


fc = FakeConsole()
_real = main.console_client
main.console_client = lambda: fc
mr = c.post("/api/ai/molly", headers=AP, json={"task": "is ci green", "page": "developer<x>"}).json()
check("Molly: asks the console's walkthrough guide, answer + walkthrough title back", mr == {"answer": "CI is green.", "walkthrough": "Open CI"} and fc.calls[-1] == ("POST", main.MOLLY_ASK, {"task": "is ci green", "app": "amberx", "page": "developerx"}), (mr, fc.calls))
check("Molly status: connected", c.get("/api/ai/molly/status", headers=A).json()["ok"] is True)
main.console_client = _real

# ---------------------------------------------------------------- size caps
check("transcript cap", c.post("/api/ai/parse", headers=P, json={"transcript": "x" * 20_001}).status_code == 413)
check("empty transcript refused", c.post("/api/ai/parse", headers=P, json={"transcript": "  "}).status_code == 400)
check("lists cap", c.post("/api/ai/parse", headers=P, json={"transcript": "x", "lists": ["a"] * 501}).status_code == 413)
check("text cap", c.post("/api/ai/summarize", headers=P, json={"text": "x" * 20_001}).status_code == 413)
check("question cap", c.post("/api/ai/ask", headers=P, json={"question": "x" * 2001}).status_code == 413)
check("notes cap", c.post("/api/ai/ask", headers=P, json={"question": "x", "notes": [{"title": "t"}] * 201}).status_code == 413)
check("body cap", c.post("/api/ai/summarize", headers=P, content=b'{"text": "' + b"x" * 300_000 + b'"}').status_code == 413)
check("non-JSON body", c.post("/api/ai/summarize", headers={**P, "content-type": "application/json"}, content=b"nope").status_code == 400)
check("JSON that isn't an object", c.post("/api/ai/summarize", headers=P, json=[1]).status_code == 400)

# ---------------------------------------------------------------- the Claude switch + plan tokens
cfg = c.put("/api/ai/config", headers=W, json={"claude": "plan"}).json()
check("plan switch makes a Claude plan profile active and first", cfg["active"] == "claude-plan" and cfg["order"][0] == "claude-plan" and cfg["claude"] == "plan", cfg)
check("plan profile without a token isn't used", r.chain()[0]["id"] == "anthropic-1")
check("API key refused on the plan profile", c.post("/api/ai/keys/claude-plan", headers=W, json={"key": API_KEY}).status_code == 400)
check("refresh token needs a plan profile", c.post("/api/ai/keys/anthropic-1", headers=W, json={"key": API_KEY, "refresh": "sk-ant-ort01-" + "z" * 30}).status_code == 400)
OAT = "sk-ant-oat01-" + "o" * 40
ORT = "sk-ant-ort01-" + "q" * 40
check("plan pair saved", c.post("/api/ai/keys/claude-plan", headers=W, json={"key": OAT, "refresh": ORT}).json()["profile"]["pair"] is True)
cli_calls.clear()
refreshes.clear()
pr = c.post("/api/ai/parse", headers=P, json={"transcript": "note from the plan", "lists": []})
check("plan answers through the CLI", pr.status_code == 200 and pr.json()["answeredBy"] == "claude-plan" and len(cli_calls) == 1, pr.text)
check("pair with unknown expiry refreshed first", refreshes == [ORT] and cli_calls[0]["token"] == "sk-ant-oat01-" + "n" * 40, (refreshes, cli_calls[0]["token"][:20]))
saved = json.loads((TMP / "data1" / "ai.json").read_text())["profiles"]["claude-plan"]
check("rotated pair stored", saved["refresh"] == "sk-ant-ort01-" + "r" * 40 and saved["expiresAt"] > time.time() * 1000)
c.post("/api/ai/parse", headers=P, json={"transcript": "again", "lists": []})
check("fresh pair not refreshed again", len(refreshes) == 1)
check("plan tokens never in config", "oooo" not in c.get("/api/ai/config", headers=A).text and "nnnn" not in c.get("/api/ai/config", headers=A).text)
cfg = c.put("/api/ai/config", headers=W, json={"claude": "api"}).json()
check("api switch", cfg["active"] == "anthropic-1" and cfg["claude"] == "api" and cfg["order"][0] == "anthropic-1", cfg)
check("bad switch value ignored → 200 but unchanged", c.put("/api/ai/config", headers=W, json={"claude": "maybe"}).json()["active"] == "anthropic-1")
c.post("/api/ai/keys/claude-plan", headers=W, json={"clear": True})
check("clear removes the token", json.loads((TMP / "data1" / "ai.json").read_text())["profiles"]["claude-plan"].get("key") is None)
check("keep-alive bounds", c.put("/api/ai/config", headers=W, json={"keepAliveMin": 61}).status_code == 400)
from axf.assistant_host import providers  # noqa: E402
check("CLI env hides AMBERX_ vars", "AMBERX_" in providers.ENV_PREFIXES_HIDDEN)
fake.calls.clear()
r.keep_alive_once()
check("keep-alive pings the active profile", fake.count("api.anthropic.com") >= 1)

# ---------------------------------------------------------------- the web app (SPA, safe paths)
w = c.get("/assets/app.js")
check("asset served", w.status_code == 200 and "console.log" in w.text and "immutable" in w.headers.get("cache-control", ""))
check("SPA fallback", "INDEX" in c.get("/notes/some/page").text)
check("index no-cache + nosniff", c.get("/").headers.get("cache-control") == "no-cache" and c.get("/").headers.get("x-content-type-options") == "nosniff")
for p in ("/.secret", "/assets/../.secret", "/%2e%2e/outside.txt", "/..%2foutside.txt", "/%2e%2e%2f%2e%2e%2fserver/main.py", "/assets/%2e%2e/%2e%2e/outside.txt"):
    t = c.get(p).text
    check(f"no escape: {p}", "SECRET-FILE" not in t and "OUTSIDE" not in t and "import" not in t, t[:80])
check("unknown API route 404 (not the page)", c.get("/api/nope", headers=A).status_code == 404)
check("healthz", c.get("/healthz").text == "ok\n")

print(f"amberx server: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
