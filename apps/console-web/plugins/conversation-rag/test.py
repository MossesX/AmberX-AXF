"""Conversation RAG tests: python3 apps/console-web/plugins/conversation-rag/test.py (stdlib only, no console needed)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2].parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parents[1] / "server"))
TMP = Path(tempfile.mkdtemp(prefix="conv-rag-"))
os.environ.update({"AXF_CONVERSATION_RAG_DIR": str(TMP / "data"), "AXF_CONVERSATION_LEDGER_FILE": str(TMP / "ledger.json"), "AXF_CONVERSATION_RAG_NO_WORKER": "1",
                   "AXF_RAG_CLAUDE_DIRS": str(TMP / "claude")})

fails = 0


def check(ok: bool, what: str) -> None:
    global fails
    print(("ok   " if ok else "FAIL ") + what)
    fails += 0 if ok else 1


import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("convrag", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
cx = types.ModuleType("console_context"); cx.ROOT = TMP; sys.modules["console_context"] = cx  # noqa: E702
ps = types.ModuleType("plugin_services"); _svc: dict = {}  # noqa: E702
ps.provide = lambda n, impl, folder: _svc.__setitem__(n, impl); ps.get = lambda n: _svc.get(n)  # noqa: E702
sys.modules["plugin_services"] = ps
P = importlib.util.module_from_spec(spec); sys.modules["convrag"] = P; spec.loader.exec_module(P)  # noqa: E702
R = sys.modules["convrag.rag"]
S = sys.modules["convrag.sources"]

# --- pure parts
v = R.embed("merge queue batching when CI fails")
check(abs(sum(x * x for x in v) - 1.0) < 1e-6, "embedding is unit length")
check(R.cosine(v, R.embed("batching the merge queue when ci failed")) > R.cosine(v, R.embed("theme colours for the phone app")), "embedding ranks related text higher")
check(R.redact("key sk-abcdefghijklmnopqrstuv and token=supersecret1") == "key [redacted] and [redacted]", "secrets are redacted")
ex = {e["kind"] for e in R.extract("From now on never push to main. We'll go with SQLite for the index. Can you add a search box. ok.")}
check(ex == {"rule", "decision", "request"}, f"ledger extraction finds rule/decision/request ({ex})")
chunks = R.chunk_turns([{"role": "brett", "text": "a" * 50, "at": "2026-11-10T10:00:00Z"}] * 40)
check(len(chunks) > 1 and all(len(c["text"]) < 1400 for c in chunks), "turns are chunked")
check(R.brief_text([{"entry": "push to main", "value": "Don't: push to main."}]).endswith("- push to main: Don't: push to main."), "brief text line is entry: value")
quote = "I don't need the whole entire session quoted and plugged in, that costs me a shitload of money. Just a brief summary of what you don't do. A two field RAG format, an entry and a value, that's it."
two = R.extract(quote)
check(len(two) == 1 and two[0]["entry"] == "session quoted and plugged in" and two[0]["value"].startswith("Don't: session quoted") and "Do instead: a brief summary" in two[0]["value"],
      f"Brett's sentence → one entry/value, the follow-up 'Just …' becomes the do-instead half ({two})")
miss = R.extract("You didn't push the branch before opening the PR.")[0]
check(miss["kind"] == "mistake" and miss["entry"].startswith("Missed: push the branch") and miss["value"].startswith("Claude didn't push the branch"), f"a mistake entry ({miss})")
check(all(len(e["entry"]) <= R.ENTRY_CHARS and len(e["value"]) <= R.VALUE_CHARS for e in R.extract("Never " + "do the long thing " * 40 + ".")), "entry and value are capped short")
qt = R.terms("Build the merge queue batching step")
check(R.match_score({"entry": "merge queue batching", "value": "Don't: retry CI."}, qt) > 0 and R.match_score({"entry": "phone theme colours", "value": "Always: use tokens."}, qt) == 0,
      "match score: a related entry matches, an unrelated one doesn't")

# --- sources: Claude Code (interactive + headless), claude.ai export, transcripts service
cc = TMP / "claude" / "proj"; cc.mkdir(parents=True)
lines = [
    {"type": "user", "timestamp": "2026-11-10T16:50:14Z", "message": {"role": "user", "content": "You better make some type of RAG database for this conversation. From now on always index every session."}},
    {"type": "assistant", "timestamp": "2026-11-10T16:50:20Z", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "x"}, {"type": "text", "text": "I'll build a local index with SQLite FTS5."}]}},
    {"type": "user", "timestamp": "2026-11-10T16:51:00Z", "message": {"role": "user", "content": [{"type": "tool_result", "content": "secret tool output"}]}},
    {"type": "user", "isMeta": True, "message": {"role": "user", "content": "meta"}},
]
(cc / "s1.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
brief = "# Build: demo-build-id\n\n## Brett said (verbatim)\nAt: 2026-11-09T10:00:00Z\n> Never use Sonnet for builds.\n\n## Rules for this job\n- stuff"
(cc / "h1.jsonl").write_text(json.dumps({"type": "user", "timestamp": "2026-11-09T10:00:01Z", "message": {"role": "user", "content": brief}}) + "\n"
                             + json.dumps({"type": "assistant", "timestamp": "2026-11-09T10:00:05Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "headless body text zebra"}]}}) + "\n")
imports = TMP / "data" / "imports"; imports.mkdir(parents=True)
(imports / "conversations.json").write_text(json.dumps([{"uuid": "c1", "name": "Voice plans", "created_at": "2026-11-01T09:00:00Z",
                                                          "chat_messages": [{"sender": "human", "text": "We decided to use Opus for the voice agent.", "created_at": "2026-11-01T09:00:00Z"},
                                                                            {"sender": "assistant", "text": "Noted: Opus for voice.", "created_at": "2026-11-01T09:00:03Z"}]}]))


class Rec:
    def docs(self):
        return [{"key": "r1", "version": "v1", "link": "output-recorder?rec=r1", "doc": {"$axf": "audio-transcript@1", "id": "r1", "name": "Walk", "group": "sess-1", "startedAt": "2026-11-08T12:00:00Z",
                 "mic": True, "segments": [{"start": 0, "end": 4, "text": "Okay so the glossary page needs bigger cards."}, {"start": 61.5, "end": 70, "text": "And the kiwi banner must always stay green."}]}}]


ps.provide("axf.session-transcripts@1", Rec(), "x")
rep = P.run()
check(rep["claudeCode"]["files"] == 1 and rep["claudeCode"]["skipped"] == 1, f"claude code: interactive read, headless skipped ({rep['claudeCode']})")
check(rep["claudeAi"]["files"] == 1 and rep["recordings"]["transcripts"] == 1, "claude.ai export and transcript read")
st = P.status()
check(st["sessions"] == 4 and set(st["bySource"]) == {"claude-code", "claude-ai", "recording"}, f"four sessions over three sources ({st['bySource']})")
check(st["chunks"] == 0 and st["passages"] is False, "by default no session text is stored (passages off)")
db = (TMP / "data" / "conversations.db").read_bytes()
check(b"I'll build a local index with SQLite FTS5" not in db, "Claude's replies are not in the store")
sr = P.search("index every session")
check(sr["hits"] == [] and any("index every session" in e["value"] for e in sr["entries"]), "search returns entries, not passages")
ctx = P.context("index every session")
check("## Past conversation" not in ctx["text"] and ctx["text"].startswith("### From Brett's conversations (entry: value)") and all(set(e) == {"entry", "value"} for e in ctx["entries"]),
      "context pack is entry: value lines only")
fs0 = P.find_session("kiwi banner green")["sessions"]
check(fs0 and fs0[0]["session"] == "recording:r1" and fs0[0]["link"] == "output-recorder?rec=r1", "find-session works from entries")

P.post_settings({"passages": True})
P.reindex({"full": True})
hits = P.search("RAG database")["hits"]
check(bool(hits) and hits[0]["session"] == "claude-code:s1" and "secret tool output" not in hits[0]["text"], "search finds the chat, tool output is not indexed")
check(not P.search("zebra")["hits"], "a headless run's body is not indexed by default")
check(P.search("databse ragg")["count"] >= 0, "typo query doesn't error")
check(P.search("kiwi banner")["hits"][0]["offset"] == 61.5, "a transcript hit carries its offset in the recording")
fs = P.find_session("which session about kiwi banner green")["sessions"]
check(fs and fs[0]["session"] == "recording:r1" and fs[0]["link"] == "output-recorder?rec=r1", "find-session ranks the recording first, with its link")
check(len(P.search("voice agent", source="claude-ai")["hits"]) == 1 and not P.search("voice agent", since="2026-11-05")["hits"], "source and date filters")

led = P.ledger()["entries"]
texts = " | ".join(e["text"] for e in led)
texts = " | ".join(e["value"] for e in led)
check("Always: index every session" in texts and "Don't: use Sonnet for builds" in texts and "kiwi banner must always stay green" in texts, "ledger from chats, brief quotes and mic transcripts")
check(all("glossary page needs" not in e["text"] for e in led if e["kind"] == "rule"), "plain remarks are not rules")
lf = json.loads((TMP / "ledger.json").read_text())
check(lf["$axf"] == "conversation-ledger@1" and all(set(e) <= {"entry", "value", "pinned"} for e in lf["entries"]) and any("Sonnet" in e["value"] for e in lf["entries"]),
      "the shared ledger file holds two-field entries only")
check("I'll build a local index" not in json.dumps(lf), "no session text in the published file")
sonnet = next(e for e in led if "Sonnet" in e["text"])
P.ledger_set(sonnet["id"], {"hidden": True})
check(not any("Sonnet" in e["value"] for e in json.loads((TMP / "ledger.json").read_text())["entries"]), "a hidden entry leaves the published file")
P.ledger_add({"entry": "API for everything", "value": "Every UI feature also gets REST, MCP, CLI and voice.", "kind": "rule"})
check(json.loads((TMP / "ledger.json").read_text())["briefText"].split("\n")[1] == "- API for everything: Every UI feature also gets REST, MCP, CLI and voice.", "a manual entry is pinned")
e2 = P.ledger_add({"text": "Never quote whole sessions into a brief."})["entry"]
check(e2["entry"] == "quote whole sessions into a brief" and e2["value"].startswith("Don't: quote whole sessions"), "a sentence is distilled into entry/value on add")
P.ledger_set(e2["id"], {"value": "Don't: paste sessions. Do: one-line entries."})
check(P.ledger(q="paste sessions")["entries"][0]["value"] == "Don't: paste sessions. Do: one-line entries.", "an entry's value is editable")
ctx = P.context("RAG database")
check("## Past conversation" not in ctx["text"] and ctx["answer"] is None, "context pack is entries only even with passages on, no AI (switch off)")
P.post_settings({"briefLedger": False})
check(json.loads((TMP / "ledger.json").read_text())["briefText"] == "", "the brief switch empties the published text")
P.post_settings({"briefLedger": True})

# incremental: an appended line is read alone
with (cc / "s1.jsonl").open("a") as f:
    f.write(json.dumps({"type": "user", "timestamp": "2026-11-10T17:00:00Z", "message": {"role": "user", "content": "Add a pelican filter to the search page."}}) + "\n")
rep2 = P.run()
check(rep2["claudeCode"]["files"] == 1 and rep2["claudeAi"]["files"] == 0 and rep2["recordings"]["transcripts"] == 0, "second run reads only what changed")
check(len(P.search("pelican")["hits"]) == 1 and P.search("RAG database")["hits"], "appended turns are searchable, old ones kept")
check(P.reindex({"full": True})["claudeCode"]["files"] == 1 and len(P.search("pelican")["hits"]) == 1, "full reindex rebuilds")
check(any(e["manual"] for e in P.ledger()["entries"]), "full reindex keeps manual ledger entries")
P.post_settings({"passages": False})
check(P.status()["chunks"] == 0 and P.search("pelican")["hits"] == [], "switching passages off deletes the stored session text")

# AI only behind its switch: the model sees one sentence per entry, never a session
seen: list = []


class LLM:
    def complete(self, msgs, system=""):
        seen.append(msgs[0]["content"])
        n = msgs[0]["content"].count("\n") + 1
        return {"text": json.dumps([{"entry": f"ai entry {i}", "value": "ai value line"} for i in range(n)])}


ps.provide("axf.llm@1", LLM(), "x")
check(P.run()["distilled"] == {"ai": False, "entries": 0} and not seen, "AI switch off: no model call")
P.post_settings({"ai": True})
d = P.run()["distilled"]
check(d["entries"] >= 1 and seen and all(len(line) < 500 for line in seen[0].split("\n")), f"AI switch on: entries tidied from single sentences ({d})")
P.post_settings({"ai": False})

# the framework side: rules-brief compose carries the ledger
env = {**os.environ, "AXF_RULES_BRIEFS_FILE": str(TMP / "none.json")}
(TMP / "ledger2.json").write_text(json.dumps({"$axf": "conversation-ledger@1", "enabled": True, "maxEntries": 12, "maxChars": 1200, "entries": [
    {"entry": "API for everything", "value": "Every UI feature also gets REST, MCP, CLI and voice.", "pinned": True},
    {"entry": "merge queue batching", "value": "Don't: re-run CI to freshen a PR."},
    {"entry": "phone theme colours", "value": "Always: use asset tokens."}]}))
js = ("import('./framework/cli/rules-brief.mjs').then(m=>{const d=m.loadForLaunch(process.argv[1]);"
      "const b=d.briefs.find(x=>x.id==='conversation-ledger');console.log(JSON.stringify(b?b.text:null));})")
run = lambda task: subprocess.run(["node", "-e", js, task], cwd=ROOT, env={**env, "AXF_CONVERSATION_LEDGER_FILE": str(TMP / "ledger2.json")}, capture_output=True, text=True)  # noqa: E731
out = run("Fix the merge queue batching when CI fails")
t = json.loads(out.stdout or "null") or ""
check("- API for everything:" in t and "- merge queue batching: Don't: re-run CI" in t and "phone theme" not in t,
      f"rules-brief carries pinned + matching entries only ({(out.stdout or out.stderr).strip()[:200]})")
t2 = json.loads(run("Rename a label").stdout or "null") or ""
check("merge queue" not in t2 and "API for everything" in t2, "an unrelated task gets the pinned entries only")

print(f"\n{'FAILED ' + str(fails) if fails else 'all passed'}")
sys.exit(1 if fails else 0)
