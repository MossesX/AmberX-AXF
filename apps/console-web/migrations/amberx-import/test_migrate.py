"""Self-test for the AmberX → console data import (CI: python apps/console-web/migrations/amberx-import/test_migrate.py).

Everything runs in a temp folder: a fake AmberX data folder (ai.json with keys, ai.env, a walkthrough tree), a fake
/projects (notes tables, a settings document, recordings) and a fake .axf-console (alerts.json, secrets.env). Checks:
--check writes nothing; apply moves what the console didn't have and leaves hub data in place; a second apply changes
nothing; a rotated AmberX key updates the entry the import owns; a value typed into the console is a conflict and
stays; rollback removes exactly what apply made and puts back what it replaced; no secret value is ever printed.
"""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import sys
import tempfile
import time
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import migrate as M  # noqa: E402

KEY_A = "sk-ant-oat01-SECRET-ACCESS-TOKEN-AAAAAAAAAAAA"
REFRESH_A = "sk-ant-ort01-SECRET-REFRESH-TOKEN-BBBBBBBBBB"
KEY_OPENAI = "sk-openai-SECRET-CCCCCCCCCCCCCCCC"
SECRETS = (KEY_A, REFRESH_A, KEY_OPENAI)


def write(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, (dict, list)):
        p.write_text(json.dumps(data), "utf-8")
    elif isinstance(data, bytes):
        p.write_bytes(data)
    else:
        p.write_text(data, "utf-8")


def build_fixture(root: Path) -> dict[str, Path]:
    src = root / "amberx" / ".app" / "data"
    write(src / "ai.json", {"$axf": "amberx-ai@1",
                            "profiles": {"claude-code-1": {"id": "claude-code-1", "kind": "claude-code", "label": "Claude (plan)", "model": "", "baseUrl": "", "enabled": True,
                                                           "key": KEY_A, "refresh": REFRESH_A, "expiresAt": 1800000000},
                                         "ollama-1": {"id": "ollama-1", "kind": "ollama", "label": "Local", "model": "llama3", "baseUrl": "http://127.0.0.1:11434", "enabled": True}},
                            "order": ["claude-code-1", "ollama-1"], "active": "claude-code-1", "keepAliveMin": 10})
    write(src.parent / "ai.env", f"AMBERX_OPENAI_API_KEY={KEY_OPENAI}\nUNRELATED=1\n")
    write(src / "walkthrough" / "chapters.json", {"title": "AmberX", "duration": 60, "recordedAt": "2026-11-01"})
    write(src / "walkthrough" / "walkthrough.mp4", b"\x00\x00\x00\x18ftypmp42" + bytes(2000))
    write(src / "walkthrough" / "walkthrough.vtt", "WEBVTT\n")
    write(src / "walkthrough" / "stack" / "chapters.json", {"title": "Stack"})
    write(src / "walkthrough" / "stack" / "chapters" / "intro.mp4", bytes(300))
    write(src / "walkthrough" / ".DS_Store", b"x")
    write(src / "walkthrough" / "render.tmp", b"x")

    projects = root / "projects"
    notes = projects / "amberx-axf" / "_data" / "amberx-notes"
    write(notes / "lists" / "head.json", {"$axf": "hub-table@1", "table": "lists", "chunks": 0, "count": 2, "updatedAt": "2026-11-10T00:00:00Z",
                                          "rows": {"inbox": {"id": "inbox", "name": "Inbox"}, "work": {"id": "work", "name": "Work"}}})
    write(notes / "items" / "head.json", {"$axf": "hub-table@1", "table": "items", "chunks": 2, "count": 3, "updatedAt": "2026-11-11T00:00:00Z"})
    write(notes / "items" / "rows-0.json", {"n1": {"id": "n1", "kind": "note", "text": "a"}, "t1": {"id": "t1", "kind": "todo", "text": "b"}})
    write(notes / "items" / "rows-1.json", {"k1": {"id": "k1", "kind": "task", "text": "c", "due": "2026-11-20"}})
    settings = projects / "_shared" / "_data" / "settings"
    write(settings / "apps" / "amberx-droid.json", {"$axf": "hub-settings@1", "values": {"voice.lang": {"v": "en-US", "at": "x"}, "monitor.interval": {"v": 30, "at": "x"}},
                                                    "updatedAt": "2026-11-11T00:00:00Z", "updatedBy": "phone"})
    write(settings / "appearance.json", {"$axf": "appearance@1", "look": "dark"})
    rec = projects / "amberx-recordings" / "_data" / "output-recorder"
    write(rec / "recordings" / "r1.json", {"$axf": "audio-recording@1", "id": "r1", "parts": 2, "bytes": 8, "sha256": "x"})
    write(rec / "parts" / "r1" / "0000.json", {"$axf": "audio-part@1", "id": "r1", "n": 0, "b64": base64.b64encode(b"abcd").decode()})
    write(rec / "parts" / "r1" / "0001.json", {"$axf": "audio-part@1", "id": "r1", "n": 1, "b64": base64.b64encode(b"efgh").decode()})
    write(rec / "recordings" / "r2.json", {"$axf": "audio-recording@1", "id": "r2", "parts": 3, "bytes": 0, "sha256": "y"})
    write(rec / "parts" / "r2" / "0000.json", {"$axf": "audio-part@1", "id": "r2", "n": 0, "b64": ""})

    console = root / "axf" / ".axf-console"
    write(console / "alerts.json", [
        {"id": "ci:Failed", "key": "ci:Failed", "source": "ci", "severity": "error", "title": "Failed", "body": "", "link": "", "meta": {},
         "firstAt": 1762900000000, "lastAt": 1762903600000, "count": 2, "ack": True, "resolved": False, "resolvedAt": None},
        {"id": "builds:Done", "key": "builds:Done", "source": "builds", "severity": "info", "title": "Done", "body": "", "link": "", "meta": {},
         "firstAt": 1762910000000, "lastAt": 1762910000000, "count": 1, "ack": False, "resolved": False, "resolvedAt": None},
    ])
    write(console / "secrets.env", "# AXF Dev Console credentials (saved from the systems check). Never commit this file.\nGITHUB_TOKEN=ghp_existing_EXISTING_EXISTING_EXISTING\n")
    return {"src": src, "projects": projects, "console": console}


def snapshot(d: Path) -> dict[str, bytes]:
    return {str(p.relative_to(d)): p.read_bytes() for p in sorted(d.rglob("*")) if p.is_file()}


def run(args: list[str]) -> tuple[int, str]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = M.main(args)
    return code, buf.getvalue()


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="amberx-import-"))
    try:
        fx = build_fixture(tmp)
        src, projects, console = fx["src"], fx["projects"], fx["console"]
        base = ["--from", str(src), "--console", str(console), "--projects", str(projects)]
        before = snapshot(console)
        proj_before = snapshot(projects)
        iso = lambda ms: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))  # noqa: E731

        # 1. --check writes nothing, reports what would move
        code, out = run(["apply", *base, "--check", "--json"])
        r = json.loads(out)
        assert code == 0 and snapshot(console) == before, "check must not write"
        assert r["sections"]["ai"]["state"] == "moved" and r["sections"]["walkthrough"]["state"] == "moved"
        assert r["sections"]["notes"]["state"] == "in-place" and r["sections"]["notifications"]["state"] == "moved"
        assert not (console / "migrations").exists()

        # 2. apply
        code, out = run(["apply", *base, "--json"])
        r = json.loads(out)
        assert code == 0, out
        for s in SECRETS:
            assert s not in out, "a secret value was printed"
        ai = r["sections"]["ai"]
        assert ai["state"] == "moved" and ai["profiles"] == 2 and ai["active"] == "claude-code-1"
        assert sorted(ai["secretsWritten"]) == ["AMBERX_AI_KEY_CLAUDE_CODE_1", "AMBERX_AI_REFRESH_CLAUDE_CODE_1", "AMBERX_OPENAI_API_KEY"]
        target = Path(ai["target"])
        doc = json.loads(target.read_text())
        assert doc["$axf"] == "amberx-ai@1" and "key" not in doc["profiles"]["claude-code-1"] and "refresh" not in doc["profiles"]["claude-code-1"]
        assert doc["profiles"]["claude-code-1"]["keyRef"] == "AMBERX_AI_KEY_CLAUDE_CODE_1" and doc["profiles"]["claude-code-1"]["expiresAt"] == 1800000000
        assert "keyRef" not in doc["profiles"]["ollama-1"] and doc["order"] == ["claude-code-1", "ollama-1"]
        for s in SECRETS:
            assert s not in target.read_text(), "a secret is in the profiles document"
        env = (console / "secrets.env").read_text()
        assert f"AMBERX_AI_KEY_CLAUDE_CODE_1={KEY_A}" in env and f"AMBERX_AI_REFRESH_CLAUDE_CODE_1={REFRESH_A}" in env
        assert f"AMBERX_OPENAI_API_KEY={KEY_OPENAI}" in env and "GITHUB_TOKEN=ghp_existing" in env and "UNRELATED" not in env
        assert oct(target.stat().st_mode & 0o777) == "0o600" and oct((console / "secrets.env").stat().st_mode & 0o777) == "0o600"
        wk = r["sections"]["walkthrough"]
        wdst = Path(wk["target"])
        assert wk["state"] == "moved" and wk["files"] == 5 and sorted(wk["copied"]) == ["chapters.json", "stack/chapters.json", "stack/chapters/intro.mp4", "walkthrough.mp4", "walkthrough.vtt"]
        assert (wdst / "walkthrough.mp4").read_bytes() == (src / "walkthrough" / "walkthrough.mp4").read_bytes()
        assert not (wdst / ".DS_Store").exists() and not (wdst / "render.tmp").exists()
        notes = r["sections"]["notes"]["tables"]
        assert notes["lists"]["count"] == 2 and notes["items"]["count"] == 3 and notes["items"]["byKind"] == {"note": 1, "todo": 1, "task": 1}
        assert notes["items"]["chunks"] == 2 and len(notes["items"]["sha256"]) == 64
        recs = r["sections"]["recordings"]
        assert recs["state"] == "in-place" and recs["count"] == 2 and recs["parts"] == 3 and recs["incomplete"] == ["r2"]
        st = r["sections"]["settings"]
        assert st["state"] == "in-place" and st["app"]["keys"] == 2 and st["appearance"]["present"] is True
        assert r["sections"]["approvals"]["state"] == "stays-on-axhub"
        nf = r["sections"]["notifications"]
        assert nf["state"] == "moved" and nf["backfilled"] == 2
        lines = [json.loads(l) for l in (console / "alerts-history.jsonl").read_text().splitlines()]
        assert [l["alert"] for l in lines] == ["ci:Failed", "builds:Done"] and lines[0]["readAt"] == iso(1762903600000) and lines[1]["readAt"] is None
        assert lines[0]["deliveredAt"] == iso(1762900000000) and lines[0]["device"] == "amberx-web" and lines[0]["legacy"] is True
        # hub data untouched
        assert snapshot(projects) == proj_before
        man = json.loads((console / "migrations" / "amberx-import.json").read_text())
        assert man["$axf"] == "amberx-import@1" and man["appliedAt"] and len(man["created"]["files"]) == 7 and len(man["created"]["secrets"]) == 3
        assert man["created"]["history"] == ["ci:Failed", "builds:Done"] and man["backups"] == {}
        for s in SECRETS:
            assert s not in json.dumps(man)

        # 3. a second apply is a no-op
        after_first = snapshot(console)
        code, out = run(["apply", *base, "--json"])
        r = json.loads(out)
        assert code == 0 and r["sections"]["ai"]["state"] == "unchanged" and r["sections"]["walkthrough"]["state"] == "unchanged" and r["sections"]["notifications"]["state"] == "unchanged"
        now = snapshot(console)
        now.pop("migrations/amberx-import.json"); after_first.pop("migrations/amberx-import.json")
        assert now == after_first, "second apply changed console files"
        assert len(json.loads((console / "migrations" / "amberx-import.json").read_text())["created"]["files"]) == 7

        # 4. AmberX rotated its token: the entry the import owns follows; a new alert is back-filled too
        aj = json.loads((src / "ai.json").read_text()); aj["profiles"]["claude-code-1"]["key"] = KEY_A + "-ROTATED"; write(src / "ai.json", aj)
        alerts = json.loads((console / "alerts.json").read_text())
        alerts.append({**alerts[1], "id": "deploy:Live", "key": "deploy:Live"}); write(console / "alerts.json", alerts)
        alerts_bytes = (console / "alerts.json").read_bytes()
        code, out = run(["apply", *base, "--json"])
        r = json.loads(out)
        assert code == 0 and r["sections"]["ai"]["state"] == "moved" and r["sections"]["ai"]["secretsWritten"] == ["AMBERX_AI_KEY_CLAUDE_CODE_1"]
        assert f"AMBERX_AI_KEY_CLAUDE_CODE_1={KEY_A}-ROTATED" in (console / "secrets.env").read_text()
        assert r["sections"]["notifications"]["backfilled"] == 1 and len((console / "alerts-history.jsonl").read_text().splitlines()) == 3

        # 5. a value typed into the console is not the import's to change: conflict, left alone, exit 2
        env = (console / "secrets.env").read_text().replace(f"AMBERX_OPENAI_API_KEY={KEY_OPENAI}", "AMBERX_OPENAI_API_KEY=typed-by-brett")
        write(console / "secrets.env", env)
        man = json.loads((console / "migrations" / "amberx-import.json").read_text()); man["created"]["secrets"].remove("AMBERX_OPENAI_API_KEY")
        write(console / "migrations" / "amberx-import.json", man)
        code, out = run(["apply", *base, "--json"])
        r = json.loads(out)
        assert code == 2 and r["sections"]["ai"]["state"] == "conflict" and r["conflicts"] == ["AMBERX_OPENAI_API_KEY"]
        assert "AMBERX_OPENAI_API_KEY=typed-by-brett" in (console / "secrets.env").read_text()
        code, out = run(["apply", *base])
        assert code == 2 and "AMBERX_OPENAI_API_KEY" in out and KEY_OPENAI not in out

        # 6. the console wrote real history since: rollback drops only the legacy lines and keeps the file
        with (console / "alerts-history.jsonl").open("a") as fh:
            fh.write(json.dumps({"$axf": "alert-history@1", "alert": "ci:Failed", "key": "ci:Failed", "device": "pixel-9", "channel": "stream", "deliveredAt": "2026-11-12T10:00:00Z"}) + "\n")
        code, out = run(["rollback", *base, "--check", "--json"])
        r = json.loads(out)
        assert code == 0 and (console / "alerts-history.jsonl").exists() and len(r["removed"]) == 6 and sorted(r["secretsCleared"]) == ["AMBERX_AI_KEY_CLAUDE_CODE_1", "AMBERX_AI_REFRESH_CLAUDE_CODE_1"]
        assert Path(ai["target"]).exists(), "rollback --check must not remove"
        code, out = run(["rollback", *base, "--json"])
        r = json.loads(out)
        assert code == 0 and r["historyDropped"] == 3 and len(r["removed"]) == 6 and r["restored"] == []
        assert not Path(ai["target"]).exists() and not wdst.exists()
        hist = [json.loads(l) for l in (console / "alerts-history.jsonl").read_text().splitlines()]
        assert len(hist) == 1 and hist[0]["device"] == "pixel-9"
        env = (console / "secrets.env").read_text()
        assert "AMBERX_AI_KEY_CLAUDE_CODE_1" not in env and "AMBERX_AI_REFRESH_CLAUDE_CODE_1" not in env
        assert "GITHUB_TOKEN=ghp_existing" in env and "AMBERX_OPENAI_API_KEY=typed-by-brett" in env, "entries the import did not add must stay"
        assert (console / "alerts.json").read_bytes() == alerts_bytes, "the import must never change alerts.json"
        man = json.loads((console / "migrations" / "amberx-import.json").read_text())
        assert man["rolledBackAt"] and man["created"] == {"files": [], "secrets": [], "history": []}
        assert (projects / "amberx-axf" / "_data" / "amberx-notes" / "items" / "head.json").exists()

        # 7. a target that existed before apply comes back on rollback; a history file the import made goes when empty
        (console / "alerts-history.jsonl").unlink()
        write(Path(ai["target"]), {"$axf": "amberx-ai@1", "profiles": {}, "order": [], "active": "", "keepAliveMin": 5})
        write(wdst / "walkthrough.vtt", "WEBVTT\nold\n")
        code, out = run(["apply", *base, "--only", "ai,walkthrough,notifications", "--json"])
        r = json.loads(out)
        # the typed-in credential from step 5 is still a conflict (exit 2); everything else still runs
        assert code == 2 and r["conflicts"] == ["AMBERX_OPENAI_API_KEY"] and r["sections"]["notes"]["state"] == "skipped"
        assert r["sections"]["walkthrough"]["state"] == "moved" and r["sections"]["notifications"]["state"] == "moved"
        man = json.loads((console / "migrations" / "amberx-import.json").read_text())
        assert sorted(man["backups"]) == sorted([os.path.relpath(ai["target"], console), os.path.relpath(wdst / "walkthrough.vtt", console)])
        assert all(os.path.relpath(ai["target"], console) != f["path"] for f in man["created"]["files"])
        assert json.loads(Path(ai["target"]).read_text())["keepAliveMin"] == 10
        code, out = run(["rollback", *base, "--json"])
        r = json.loads(out)
        assert code == 0 and len(r["restored"]) == 2
        assert json.loads(Path(ai["target"]).read_text())["keepAliveMin"] == 5 and (wdst / "walkthrough.vtt").read_text() == "WEBVTT\nold\n"
        assert not (wdst / "walkthrough.mp4").exists() and not (console / "alerts-history.jsonl").exists()
        assert not list((console / "migrations" / "amberx-import.bak").glob("*"))

        # 8. status, and a missing source folder is an error only for the sections that need it
        code, out = run(["status", *base, "--json"])
        assert code == 0 and json.loads(out)["rolledBackAt"]
        code, out = run(["apply", "--from", str(tmp / "nowhere"), "--console", str(console), "--projects", str(projects), "--only", "notes", "--json"])
        assert code == 0 and json.loads(out)["sections"]["notes"]["state"] == "in-place"
        code, _ = run(["apply", "--from", str(tmp / "nowhere"), "--console", str(console), "--projects", str(projects)])
        assert code == 1
        print("amberx-import: all checks passed")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
