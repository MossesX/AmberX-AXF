"""Claude accounts manager: the pure part (no IO). One ordered list of every Claude account on the VPS, subscription and
API alike, with what each is doing, whether it is out of credits, and its usage in dollars.

Inputs are what three capabilities hand over: axf.claude-accounts@1 view() (names, kinds, roles, labels, emails, plans,
limits, API spend), axf.claude-usage@1 usage() (each login's 5-hour and weekly usage in percent) and
axf.build-dispatch@1 accounts() / order() (the dispatcher's view: rank, running, usable, why). Never a credential.

Dollars (Brett, Nov 10 2026: "usage in dollars"): Claude reports a subscription's usage only as percent of its windows,
so a subscription's weekly dollars are its plan price spread over the week (price × 7 / 30.44); used = that × weekly %.
The plan prices are settings (prices by plan, an override per account). An API key's dollars are what it spent this
week against its weekly cap (else its daily cap), straight from the spend records.
"""
from __future__ import annotations

import re
from typing import Any

NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
DAYS_PER_MONTH = 30.44
DEFAULT_PRICES = {"pro": 20.0, "max": 100.0, "max-20x": 200.0, "team": 30.0, "enterprise": 60.0}
SHOW = ("name", "number", "left", "kind", "email", "plan", "status", "dollars")
DEFAULT_SETTINGS: dict[str, Any] = {
    "$axf": "claude-accounts-manager@1",
    "widget": {"on": True, "account": "", "show": ["number", "name", "left", "kind"]},
    "column": {"on": True, "open": True},
    "overlay": {"open": False, "scope": "console", "dock": "free", "minimized": False, "locked": False,
                "x": 24, "y": 96, "w": 240, "h": 320, "opacity": 100,
                "buttons": [
                    {"id": "list", "label": "Accounts", "icon": "key", "action": "nav:claude-accounts-manager", "menu": []},
                    {"id": "session", "label": "Claude Code", "icon": "sparkles", "action": "", "list": "session", "menu": []},
                    {"id": "add", "label": "Add", "icon": "plus", "action": "", "menu": [
                        {"label": "Subscription login", "action": "claude-accounts-manager.add-dialog:subscription"},
                        {"label": "API key", "action": "claude-accounts-manager.add-dialog:api"}]},
                ]},
    "prices": dict(DEFAULT_PRICES),
    "accountPrices": {},
}
DOCKS = ("free", "left", "right", "top", "bottom")
SCOPES = ("console", "os")
LISTS = ("", "session", "rename", "accounts")


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _str(v: Any, n: int = 200) -> str:
    return v[:n] if isinstance(v, str) else ""


def clean_name(v: Any) -> str:
    """An account name or '' (spoken "Account 2" → account-2)."""
    n = re.sub(r"\s+", "-", v.strip().lower()) if isinstance(v, str) else ""
    return n if NAME.fullmatch(n) else ""


def norm_settings(raw: Any) -> dict[str, Any]:
    """claude-accounts-manager@1 with every default filled in and every value checked."""
    o = raw if isinstance(raw, dict) else {}
    d = DEFAULT_SETTINGS
    w = o.get("widget") if isinstance(o.get("widget"), dict) else {}
    show = [s for s in (w.get("show") if isinstance(w.get("show"), list) else d["widget"]["show"]) if s in SHOW]
    col = o.get("column") if isinstance(o.get("column"), dict) else {}
    ov = o.get("overlay") if isinstance(o.get("overlay"), dict) else {}
    dov = d["overlay"]

    def num(k: str, lo: int, hi: int) -> int:
        v = _num(ov.get(k))
        return int(min(hi, max(lo, v))) if v is not None else dov[k]

    def item(m: Any) -> dict[str, str] | None:
        if not isinstance(m, dict) or not _str(m.get("label")).strip():
            return None
        return {"label": _str(m["label"], 40).strip(), "action": _str(m.get("action"), 200).strip()}

    def button(b: Any, i: int) -> dict[str, Any] | None:
        if not isinstance(b, dict) or not _str(b.get("label")).strip():
            return None
        bid = re.sub(r"[^a-z0-9-]", "", _str(b.get("id"), 32).lower()) or f"b{i + 1}"
        menu = [x for x in (item(m) for m in (b.get("menu") if isinstance(b.get("menu"), list) else [])[:20]) if x]
        return {"id": bid, "label": _str(b["label"], 40).strip(), "icon": re.sub(r"[^a-z0-9-]", "", _str(b.get("icon"), 32).lower()) or "star",
                "action": _str(b.get("action"), 200).strip(), "list": b.get("list") if b.get("list") in LISTS else "", "menu": menu}

    raw_buttons = ov.get("buttons") if isinstance(ov.get("buttons"), list) else dov["buttons"]
    buttons = [x for x in (button(b, i) for i, b in enumerate(raw_buttons[:12])) if x]
    prices = dict(DEFAULT_PRICES)
    for k, v in (o.get("prices") if isinstance(o.get("prices"), dict) else {}).items():
        if isinstance(k, str) and _num(v) is not None and 0 <= float(v) <= 10000:
            prices[k.strip().lower()[:20]] = round(float(v), 2)
    acc = {}
    for k, v in (o.get("accountPrices") if isinstance(o.get("accountPrices"), dict) else {}).items():
        if clean_name(k) and _num(v) is not None and 0 <= float(v) <= 10000:
            acc[clean_name(k)] = round(float(v), 2)
    return {
        "$axf": d["$axf"],
        "widget": {"on": w.get("on") is not False, "account": clean_name(w.get("account")), "show": show or ["name"]},
        "column": {"on": col.get("on") is not False, "open": col.get("open") is not False},
        "overlay": {"open": ov.get("open") is True, "scope": ov.get("scope") if ov.get("scope") in SCOPES else "console",
                    "dock": ov.get("dock") if ov.get("dock") in DOCKS else "free", "minimized": ov.get("minimized") is True,
                    "locked": ov.get("locked") is True, "x": num("x", 0, 8000), "y": num("y", 0, 8000), "w": num("w", 160, 1200),
                    "h": num("h", 120, 1600), "opacity": num("opacity", 40, 100), "buttons": buttons},
        "prices": prices,
        "accountPrices": acc,
    }


def merge_settings(old: dict[str, Any], patch: Any) -> dict[str, Any]:
    """A patch over the saved settings: sections merge one level deep (overlay.buttons is replaced whole)."""
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in norm_settings(old).items()}
    for k, v in (patch if isinstance(patch, dict) else {}).items():
        if k in ("widget", "column", "overlay", "prices", "accountPrices") and isinstance(v, dict):
            out[k] = {**out[k], **v}
    return norm_settings(out)


def plan_price(plan: str, name: str, s: dict[str, Any]) -> float | None:
    """Monthly price of an account's plan: its own override, else the plan's (Max 20x before Max), else None."""
    if name in s["accountPrices"]:
        return s["accountPrices"][name]
    p = (plan or "").lower()
    if not p:
        return None
    if "max" in p and "20" in p:
        return s["prices"].get("max-20x")
    for key in sorted(s["prices"], key=len, reverse=True):
        if key and key in p:
            return s["prices"][key]
    return None


MODES = ("custom", "auto")


def clean_mode(v: Any) -> str:
    """custom | auto from a mode or the words people use ('' = not a mode)."""
    m = v.strip().lower() if isinstance(v, str) else ("auto" if v is True else "custom" if v is False else "")
    return {"automatic": "auto", "on": "auto", "manual": "custom", "drag": "custom", "off": "custom"}.get(m, m) if m in (*MODES, "automatic", "on", "manual", "drag", "off") else ""


def effective_order(order: list[str], rows: list[dict[str, Any]], mode: str = "custom") -> list[str]:
    """The order as the dispatcher follows it. custom: the saved one (known names only), else every subscription in host
    order. auto: every subscription, then every API account (the dispatcher picks the least busy within each kind)."""
    if mode == "auto":
        return [r["name"] for r in rows if r.get("kind") != "api"] + [r["name"] for r in rows if r.get("kind") == "api"]
    known = [r["name"] for r in rows]
    listed = [n for n in order if n in known]
    if listed:
        return listed
    return [r["name"] for r in rows if r.get("kind") != "api"]


def _window(w: Any) -> dict[str, Any] | None:
    if not isinstance(w, dict) or _num(w.get("used")) is None:
        return None
    used = max(0.0, min(100.0, float(w["used"])))
    return {"usedPct": round(used, 1), "leftPct": round(100 - used, 1), "resetsAt": _str(w.get("resetsAt"), 40), "locked": w.get("locked") is True}


def row(a: dict[str, Any], u: dict[str, Any] | None, d: dict[str, Any] | None, s: dict[str, Any]) -> dict[str, Any]:
    """One account: who, what it does, credits, usage in percent and dollars."""
    name = _str(a.get("name"), 40)
    kind = "api" if a.get("kind") == "api" else "subscription"
    running = max(len(a.get("running") or []), int((d or {}).get("running") or 0))
    role = _str(a.get("role"), 20)
    worker = role in ("worker", "api-worker") or bool(a.get("takesJobs"))
    if running:
        status, text = "builder", f"Active builder ({running} running)"
    elif worker:
        status, text = "worker", "Worker (takes headless jobs)"
    elif a.get("active"):
        status, text = "console", "Console account"
    else:
        status, text = "idle", "Not taking jobs"
    limited = a.get("limited") if isinstance(a.get("limited"), dict) else None
    spend = a.get("spend") if isinstance(a.get("spend"), dict) else None
    five, week = (_window((u or {}).get("fiveHour")), _window((u or {}).get("weekly"))) if kind == "subscription" else (None, None)
    out_why = ""
    if kind == "api":
        if spend and spend.get("state") == "capped":
            out_why = _str(spend.get("why")) or "spend cap reached"
        elif a.get("hasKey") is False:
            out_why = "no API key saved"
        elif limited:
            out_why = f"{_str(limited.get('reason'), 40) or 'limited'} until {_str(limited.get('until'), 40)[:16].replace('T', ' ')}"
    else:
        full = [w for w in (five, week) if w and (w["usedPct"] >= 100 or w["locked"])]
        if full:
            out_why = f"usage limit reached, resets {full[0]['resetsAt'][:16].replace('T', ' ')}".rstrip()
        elif limited and limited.get("reason") != "auth":
            out_why = f"limited until {_str(limited.get('until'), 40)[:16].replace('T', ' ')}"
        elif limited:
            out_why = "login expired: sign it in again"
    price = plan_price(_str(a.get("plan"), 40), name, s) if kind == "subscription" else None
    total = used = left = None
    used_pct = left_pct = None
    basis = "none"
    if kind == "subscription":
        if price is not None:
            total = round(price * 7 / DAYS_PER_MONTH, 2)
            basis = "plan price over the week"
        if week:
            used_pct, left_pct = week["usedPct"], week["leftPct"]
            if five and five["usedPct"] > used_pct:   # the tighter window is what is really left now
                left_pct = min(left_pct, five["leftPct"])
            if total is not None:
                used = round(total * week["usedPct"] / 100, 2)
                left = round(total - used, 2)
    else:
        cap = _num((spend or {}).get("weekCap")) or 0.0
        day_cap = _num((spend or {}).get("dayCap")) or 0.0
        spent = _num((spend or {}).get("week"))
        used = round(spent if spent is not None else float(_num(a.get("costWeek")) or 0.0), 2)
        if cap > 0:
            total, basis = round(cap, 2), "weekly spend cap"
        elif day_cap > 0:
            total, basis, used = round(day_cap, 2), "daily spend cap", round(_num((spend or {}).get("day")) or 0.0, 2)
        if total:
            used_pct = round(min(100.0, used / total * 100), 1)
            left_pct = round(100 - used_pct, 1)
            left = round(max(0.0, total - used), 2)
    return {
        "name": name, "label": _str(a.get("label"), 40), "display": _str(a.get("label"), 40) or name, "email": _str(a.get("email")),
        "plan": "API key" if kind == "api" else _str(a.get("plan"), 40), "kind": kind, "active": a.get("active") is True,
        "role": role, "status": status, "statusText": text, "running": running, "worker": worker,
        "outOfCredits": bool(out_why), "creditsWhy": out_why, "hasKey": a.get("hasKey") is not False,
        "fiveHour": five, "weekly": week, "usedPct": used_pct, "leftPct": left_pct,
        "planUsd": price, "totalUsd": total, "usedUsd": used, "leftUsd": left, "usdBasis": basis,
        "costWeek": round(float(_num(a.get("costWeek")) or 0.0), 2),
        "usable": bool((d or {}).get("usable")), "why": _str((d or {}).get("why")),
    }


def rows(view: dict[str, Any], usage: dict[str, Any], dispatch: list[dict[str, Any]], order: list[str], s: dict[str, Any],
         mode: str = "custom") -> dict[str, Any]:
    """The list: accounts in the dispatcher's order (n = 1, 2…), then the ones out of it (n = None). `mode` is the
    switch: custom = the drag-and-drop order, auto = subscriptions first, then API. customOrder is the saved
    drag-and-drop order either way (what Custom goes back to)."""
    mode = mode if mode in MODES else "custom"
    us = {str(x.get("name")): x for x in (usage.get("accounts") or []) if isinstance(x, dict)}
    ds = {str(x.get("name")): x for x in dispatch if isinstance(x, dict)}
    base = [row(a, us.get(str(a.get("name"))), ds.get(str(a.get("name"))), s) for a in (view.get("accounts") or []) if isinstance(a, dict) and a.get("name")]
    eff = effective_order(order, base, mode)
    by = {r["name"]: r for r in base}
    listed = [by[n] for n in eff]
    rest = [r for r in base if r["name"] not in eff]
    for i, r in enumerate(listed):
        r["n"], r["inOrder"] = i + 1, True
    for r in rest:
        r["n"], r["inOrder"] = None, False
        if r["kind"] == "api" and not r["why"]:
            r["why"] = "not in the order: takes no build (drag it in)"
    if mode == "auto":
        for r in listed:
            if r["kind"] == "api" and (not r["why"] or "not in the account order" in r["why"]):   # a custom-mode reason is stale here
                r["why"] = "automatic: takes a build only when every subscription is full or out"
    all_rows = listed + rest
    known = [r["totalUsd"] for r in all_rows if r["totalUsd"] is not None]
    return {"accounts": all_rows, "order": eff, "mode": mode, "customOrder": effective_order(order, base, "custom"),
            "orderSaved": bool([n for n in order if n in by]),
            "totals": {"accounts": len(all_rows), "builders": sum(1 for r in all_rows if r["status"] == "builder"),
                       "workers": sum(1 for r in all_rows if r["worker"]), "out": sum(1 for r in all_rows if r["outOfCredits"]),
                       "api": sum(1 for r in all_rows if r["kind"] == "api"),
                       "usedUsd": round(sum(r["usedUsd"] or 0 for r in all_rows), 2), "leftUsd": round(sum(r["leftUsd"] or 0 for r in all_rows), 2),
                       "totalUsd": round(sum(known), 2)}}


def moved(order: list[str], name: str, to: Any) -> list[str]:
    """The order after moving one account: up | down | top | bottom | out | a 1-based position. Not listed yet = added."""
    cur = [n for n in order if n != name]
    at = order.index(name) if name in order else len(cur)
    if to == "out":
        return cur
    if to == "up":
        at = max(0, at - 1)
    elif to == "down":
        at = min(len(cur), at + 1) if name in order else len(cur)
    elif to == "top":
        at = 0
    elif to == "bottom":
        at = len(cur)
    elif isinstance(to, (int, float)) and not isinstance(to, bool) or (isinstance(to, str) and to.isdigit()):
        at = max(0, min(len(cur), int(to) - 1))
    else:
        raise ValueError("to is up, down, top, bottom, out or a position (1 = first)")
    return cur[:at] + [name] + cur[at:]


def widget_text(r: dict[str, Any] | None, show: list[str]) -> str:
    """The banner widget's line for one account, built from the parts the settings pick."""
    if not r:
        return "Claude: no account"
    parts = []
    for k in show:
        if k == "number" and r.get("n"):
            parts.append(f"#{r['n']}")
        elif k == "name":
            parts.append(r["display"])
        elif k == "kind":
            parts.append("API" if r["kind"] == "api" else "Sub")
        elif k == "left":
            if r.get("leftUsd") is not None:
                parts.append(f"${r['leftUsd']:.2f} left")
            elif r.get("leftPct") is not None:
                parts.append(f"{r['leftPct']:.0f}% left")
        elif k == "dollars" and r.get("usedUsd") is not None:
            parts.append(f"${r['usedUsd']:.2f} used")
        elif k == "email" and r.get("email"):
            parts.append(r["email"])
        elif k == "plan" and r.get("plan"):
            parts.append(r["plan"])
        elif k == "status":
            parts.append("out of credits" if r["outOfCredits"] else r["status"])
    return " · ".join(parts) or r["display"]


def session_open(name: str, kind: str) -> dict[str, Any]:
    """The Terminal tab that opens Claude Code as this account on the VPS host (its own login copy)."""
    return {"kind": "claude", "via": "vps", "account": name, "title": f"Claude: {name}"}


def add_open(name: str, kind: str) -> dict[str, Any]:
    """The Terminal tab that adds an account: the sign-in for a subscription, the hidden key prompt for an API key."""
    return {"kind": "vps", "setup": f"{'savekey' if kind == 'api' else 'login'}:{name}", "title": f"Add {name}"}
