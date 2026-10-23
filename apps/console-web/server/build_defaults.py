"""Build-engine default rules (build-defaults@1) and one instance per plugin, for the console's plugin loader.

Python twin of framework/cli/build-defaults.mjs (applyDefaults) and framework/cli/plugin-instances.mjs (samePlugin):
the same rules file (framework/schemas/build-defaults.json), the same results. The loader fills missing defaults in
memory (a plugin.json the engine hasn't filled still loads with them), refuses a plugin a rule requires something of
(e.g. the model that built it), and refuses a second build of a plugin that is already loaded (Brett, Oct 23 2026:
"only allow one instance of a plugin, never the same plugin installed twice built by different models").
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

RULES_FILE = Path(__file__).resolve().parents[3] / "framework" / "schemas" / "build-defaults.json"
_cache: dict[str, Any] | None = None


def load_rules(file: Path | None = None) -> dict[str, Any]:
    global _cache
    file = file or RULES_FILE
    if file == RULES_FILE and _cache is not None:
        return _cache
    r = json.loads(file.read_text())
    if r.get("$axf") != "build-defaults@1":
        raise ValueError(f"{file} is not build-defaults@1")
    if file == RULES_FILE:
        _cache = r
    return r


def _ui_refs(m: dict[str, Any]) -> list[str]:
    return [p for p in (m.get("provides") or []) if isinstance(p, str) and re.match(r"^(view|dialog):", p)]


CONDITIONS = {
    "always": lambda m: True,
    "hasUi": lambda m: bool(_ui_refs(m)),
    "noUi": lambda m: not _ui_refs(m),
}

_MISSING = object()


def _get(o: Any, path: str) -> Any:
    for k in path.split("."):
        if not isinstance(o, dict) or k not in o:
            return _MISSING
        o = o[k]
    return o


def _set(o: dict[str, Any], path: str, value: Any) -> None:
    keys = path.split(".")
    for k in keys[:-1]:
        if not isinstance(o.get(k), dict):
            o[k] = {}
        o = o[k]
    o[keys[-1]] = value


def apply_defaults(kind: str, thing: dict[str, Any], rules: dict[str, Any] | None = None) -> dict[str, Any]:
    """→ {"value", "filled": [{rule, field, value}], "problems": [{rule, field, message}]} (= applyDefaults)."""
    rules = rules or load_rules()
    if kind not in (rules.get("kinds") or {}):
        raise ValueError(f'build-defaults: unknown kind "{kind}"')
    value = copy.deepcopy(thing or {})
    filled: list[dict[str, Any]] = []
    problems: list[dict[str, Any]] = []
    for rule in rules.get("rules", []):
        if rule.get("kind") != kind:
            continue
        cond = CONDITIONS.get(rule.get("when", "always"))
        if cond is None:
            problems.append({"rule": rule["id"], "field": rule["field"], "message": f'unknown condition "{rule.get("when")}"'})
            continue
        if not cond(value):
            continue
        have = _get(value, rule["field"])
        ok = rule.get("values") if isinstance(rule.get("values"), list) else rules.get(rule.get("valuesFrom", ""), None)
        if have is _MISSING or have is None or have == "":
            if rule.get("op") == "default":
                _set(value, rule["field"], copy.deepcopy(rule.get("value")))
                filled.append({"rule": rule["id"], "field": rule["field"], "value": rule.get("value")})
            elif rule.get("op") == "require":
                problems.append({"rule": rule["id"], "field": rule["field"], "message": f'"{rule["field"]}" is required: {rule.get("description", "")}'})
            continue
        # JS `includes` is strict: false never matches 0 and True never matches 1, so compare types too
        if isinstance(ok, list) and not any(type(x) is type(have) and x == have for x in ok):
            problems.append({"rule": rule["id"], "field": rule["field"], "message": f'"{rule["field"]}" is {json.dumps(have)}; allowed: {", ".join(json.dumps(x) for x in ok)}'})
        elif rule.get("pattern") and (not isinstance(have, str) or not re.search(rule["pattern"], have)):
            problems.append({"rule": rule["id"], "field": rule["field"], "message": f'"{rule["field"]}" is {json.dumps(have)}; expected {rule["pattern"]}'})
    return {"value": value, "filled": filled, "problems": problems}


_SUFFIX = re.compile(r"-(fable|opus|sonnet|haiku|plugin)$")


def folder_stem(folder: str) -> str:
    f = folder.split("/")[-1]
    while _SUFFIX.search(f):
        f = _SUFFIX.sub("", f)
    return f


def _name_key(n: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(n or "").lower())


def same_plugin(a_folder: str, a: dict[str, Any], b_folder: str, b: dict[str, Any]) -> str | None:
    """Why two plugins are one plugin, or None (= samePlugin in plugin-instances.mjs)."""
    if a.get("id") and a.get("id") == b.get("id"):
        return f"the same id ({a['id']})"
    ra = (a.get("builtWith") or {}).get("replaces") or []
    rb = (b.get("builtWith") or {}).get("replaces") or []
    if b.get("id") and isinstance(ra, list) and b["id"] in ra:
        return f"{a.get('id')} replaces {b['id']}"
    if a.get("id") and isinstance(rb, list) and a["id"] in rb:
        return f"{b.get('id')} replaces {a['id']}"
    if folder_stem(a_folder) == folder_stem(b_folder):
        return f"the same plugin folder ({folder_stem(a_folder)})"
    if _name_key(a.get("name")) and _name_key(a.get("name")) == _name_key(b.get("name")):
        return f"the same name ({a.get('name')})"
    return None


def instance_clash(folder: str, m: dict[str, Any], loaded: dict[str, dict[str, Any]]) -> str | None:
    """`loaded` = folder → manifest of plugins already loaded. The reason `folder` may not load next to them, or None."""
    model = lambda x: (x.get("builtWith") or {}).get("model") or "an unknown model"  # noqa: E731
    for f, other in loaded.items():
        if f == folder:
            continue
        why = same_plugin(folder, m, f, other)
        if why:
            return (f"{folder} (built with {model(m)}) is the same plugin as {f} (built with {model(other)}): {why}. "
                    "Only one instance of a plugin may be installed; replace one with the other (Plugin Update).")
    return None
