"""toolbar-binding@1 and asset@1 validated with Pydantic (Brett, Oct 27 2026: every asset type is validated with Pydantic).

Python copy of framework/core/engines/toolbar.ts (validateToolbarBinding) and framework/core/validate.ts (validateAsset),
driven by the same spec, framework/schemas/asset-types.json, and pinned by spec/fixtures/toolbar-binding.json:

  * ``Asset``          the asset@1 envelope; ``data`` is checked against its type's spec (required, enums, nested)
  * ``ToolbarAsset``   a typed toolbar: ``ToolbarData`` / ``ToolbarAttach`` / ``ToolbarOwner`` / ``ToolbarItem``
  * ``toolbar_binding_errors(data, plugin=None)``  the binding rules with the TS messages (what the fixture compares)
  * ``validate_asset(raw, plugin=None)``  ``(ok, errors)`` for any asset@1; ``plugin`` = the plugin that ships it, so a
    toolbar must be a plugin toolbar of that plugin (owner.kind "plugin", owner.plugin, attach) or it doesn't validate

Pass the plugin as Pydantic context: ``ToolbarAsset.model_validate(raw, context={"plugin": "ai.amberx.x"})``.
Unlike the other contract modules this one needs ``pydantic`` (v2; the console image has it through FastAPI).
Kinds and attach kinds are open registries: any short lowercase word passes; the listed ones are the known ones.
"""
from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, ValidationInfo, field_validator, model_validator

CONTRACT = "toolbar-binding@1"
SPEC_FILE = Path(__file__).resolve().parents[2].parent / "schemas" / "asset-types.json"


@lru_cache(maxsize=1)
def spec() -> dict[str, Any]:
    return json.loads(SPEC_FILE.read_text(encoding="utf-8"))


def binding() -> dict[str, Any]:
    return spec()["types"]["toolbar"]["binding"]


def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _match(pattern: str, v: Any) -> bool:
    return isinstance(v, str) and re.search(pattern, v) is not None


def _js(v: Any) -> str:
    """String(v) as JavaScript writes it (messages must match the TS reference)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def toolbar_binding_errors(data: dict[str, Any], plugin: Optional[str] = None) -> list[str]:
    """Every toolbar-binding@1 problem in a toolbar's ``data`` (same order and messages as the TS reference)."""
    b = binding()
    errors: list[str] = []
    attach = data.get("attach")
    owner = data.get("owner")

    if "attach" in data:
        if not _is_obj(attach):
            errors.append("data.attach must be an object")
        else:
            if not _match(b["targetPattern"], attach.get("target")):
                errors.append(f"data.attach.target must match {b['targetPattern']}")
            if not _match(b["kindPattern"], attach.get("kind")):
                errors.append(f"data.attach.kind must match {b['kindPattern']} (known: {', '.join(b['attachKinds'])})")
            if "at" in attach and attach["at"] not in b["attachAt"]:
                errors.append(f"data.attach.at must be one of: {', '.join(b['attachAt'])}")
            if "order" in attach and not _num(attach["order"]):
                errors.append("data.attach.order must be a number")

    owner_kind = "app"
    if "owner" in data:
        if not _is_obj(owner):
            errors.append("data.owner must be an object")
        else:
            owner_kind = owner.get("kind") if isinstance(owner.get("kind"), str) else ""
            if owner_kind not in b["owners"]:
                errors.append(f"data.owner.kind must be one of: {', '.join(b['owners'])}")
            if owner_kind == "plugin":
                if not _match(b["pluginPattern"], owner.get("plugin")):
                    errors.append("a plugin toolbar must name its plugin: data.owner.plugin")
                if not _is_obj(attach):
                    errors.append("a plugin toolbar must name the element it controls: data.attach")
            elif "plugin" in owner:
                errors.append('data.owner.plugin is only for plugin toolbars (owner.kind "plugin")')
            if "settingsTab" in owner and not (isinstance(owner["settingsTab"], str) and owner["settingsTab"]):
                errors.append("data.owner.settingsTab must be a settings tab id")
            if "app" in owner and not (isinstance(owner["app"], str) and owner["app"]):
                errors.append("data.owner.app must be a string")

    if plugin is not None:
        if owner_kind != "plugin" or not _is_obj(owner):
            errors.append(f'toolbar shipped by plugin "{plugin}" must be a plugin toolbar: data.owner.kind "plugin"')
        elif owner.get("plugin") != plugin:
            errors.append(f'data.owner.plugin must be "{plugin}", the plugin that ships it')

    groups = data.get("groups") if isinstance(data.get("groups"), list) else []
    for gi, g in enumerate(groups):
        items = g.get("items") if _is_obj(g) and isinstance(g.get("items"), list) else []
        for ii, it in enumerate(items):
            if not _is_obj(it):
                continue
            at = f"data.groups[{gi}].items[{ii}]"
            kind = it["kind"] if "kind" in it else "action"
            if kind not in b["itemKinds"]:
                errors.append(f"{at}.kind must be one of: {', '.join(b['itemKinds'])}")
            if "value" in it and not isinstance(it["value"], str):
                errors.append(f"{at}.value must be a string")
            if "count" in it and not _match(b["countPattern"], it["count"]):
                errors.append(f"{at}.count must match {b['countPattern']}")
            if (kind != "action" or "count" in it) and not _is_obj(attach):
                extra = ", count" if "count" in it else ""
                errors.append(f"{at} acts on the attached element (kind {_js(kind)}{extra}): data.attach is required")
    return errors


def type_data_errors(type_: str, data: dict[str, Any]) -> list[str]:
    """The spec-driven part of validateAsset for any type: required fields, enums, nested required keys."""
    ts = spec()["types"][type_]
    errors = [f"data.{k} is required for {type_}" for k in ts["required"] if k not in data]
    for k, allowed in (ts.get("enums") or {}).items():
        if k in data and data[k] not in allowed:
            errors.append(f"data.{k} must be one of: {', '.join(allowed)}")
    for k, keys in (ts.get("nested") or {}).items():
        if _is_obj(data.get(k)):
            errors.extend(f"data.{k}.{nk} is required" for nk in keys if nk not in data[k])
    return errors


class _Open(BaseModel):
    """Assets are open for expansion: unknown keys are kept, never refused (same as the TS and CLI validators)."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Asset(_Open):
    """asset@1 envelope for every type; ``data`` is checked against the type's spec in asset-types.json."""

    axf: Literal["asset@1"] = Field(alias="$axf")
    type: str
    id: str
    name: str
    version: str
    data: dict[str, Any]
    description: Optional[str] = None
    author: Optional[str] = None
    tags: Optional[list[str]] = None
    roll: Optional[bool] = None

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in spec()["types"]:
            raise ValueError(f'Unknown asset type "{v}"')
        return v

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        p = spec()["envelope"]["idPattern"]
        if not re.search(p, v):
            raise ValueError(f'"id" must match {p}')
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('"name" must be a non-empty string')
        return v

    @model_validator(mode="after")
    def _data(self, info: ValidationInfo) -> "Asset":
        errors = type_data_errors(self.type, self.data)
        if self.type == "toolbar":
            plugin = (info.context or {}).get("plugin") if info else None
            errors += toolbar_binding_errors(self.data, plugin)
        if errors:
            raise ValueError("; ".join(errors))
        return self


class ToolbarAttach(_Open):
    target: str
    kind: str
    at: Optional[Literal["top", "bottom", "start", "end", "overlay"]] = None
    order: Optional[float] = None


class ToolbarOwner(_Open):
    kind: Literal["app", "plugin", "library", "framework"] = "app"
    plugin: Optional[str] = None
    app: Optional[str] = None
    settingsTab: Optional[str] = None


class ToolbarItem(_Open):
    id: str
    icon: str
    label: str
    action: str = ""
    requires: Optional[str] = None
    badge: Optional[str] = None
    kind: Literal["action", "toggle", "sort", "filter"] = "action"
    value: Optional[str] = None
    count: Optional[str] = None


class ToolbarGroup(_Open):
    id: str
    items: list[ToolbarItem]


class ToolbarData(_Open):
    variant: Literal["icons", "icons-labels", "labels"]
    align: Literal["start", "center", "spread"]
    groups: list[ToolbarGroup]
    showSearch: bool
    density: Optional[Literal["compact", "regular", "roomy"]] = None
    surface: Optional[Literal["flat", "raised", "glass"]] = None
    itemStyle: Optional[Literal["button", "tile", "chip"]] = None
    label: Optional[str] = None
    attach: Optional[ToolbarAttach] = None
    owner: Optional[ToolbarOwner] = None


class ToolbarAsset(Asset):
    """A typed toolbar asset (the envelope + binding rules of ``Asset``, plus typed ``toolbar`` fields)."""

    type: Literal["toolbar"]  # type: ignore[assignment]
    toolbar: Optional[ToolbarData] = Field(default=None, exclude=True)

    @model_validator(mode="after")
    def _typed(self) -> "ToolbarAsset":
        self.toolbar = ToolbarData.model_validate(self.data)
        return self


def validate_asset(raw: Any, plugin: Optional[str] = None) -> tuple[bool, list[str]]:
    """Validate any asset@1 with Pydantic; ``plugin`` = the plugin that ships it. Returns ``(ok, errors)``."""
    if not _is_obj(raw):
        return False, ["Asset must be a JSON object"]
    model = ToolbarAsset if raw.get("type") == "toolbar" else Asset
    try:
        model.model_validate(raw, context={"plugin": plugin} if plugin is not None else None)
        return True, []
    except ValidationError as e:
        out: list[str] = []
        for err in e.errors():
            msg = str(err.get("msg", ""))
            msg = msg.removeprefix("Value error, ")
            loc = ".".join(str(x) for x in err.get("loc", ()))
            out.extend(msg.split("; ") if not loc or loc in {"type", "id", "name"} else [f"{loc}: {msg}"])
        return False, out


def check_fixture(fx: dict[str, Any]) -> list[str]:
    """Replay spec/fixtures/toolbar-binding.json: the binding messages exactly, and the Pydantic verdict (ok)."""
    bad: list[str] = []
    for c in fx["cases"]:
        got = toolbar_binding_errors(c["data"], c.get("plugin"))
        if got != c["errors"]:
            bad.append(f"{c['name']}: {got} != {c['errors']}")
        asset = {"$axf": "asset@1", "type": "toolbar", "id": "t-case", "name": "Case", "version": "1.0.0", "data": c["data"]}
        ok, errs = validate_asset(asset, c.get("plugin"))
        if ok != (not c["errors"]):
            bad.append(f"{c['name']}: pydantic ok={ok} {errs[:2]}")
    return bad
