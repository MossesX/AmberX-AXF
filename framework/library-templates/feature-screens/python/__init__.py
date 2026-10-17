"""{{LABEL}} — generated from the `{{TEMPLATE}}` library template (Python port of {{MODULE_ID}})."""
from __future__ import annotations

from axf.library import Kernel, Library


def register(kernel: Kernel) -> None:
    kernel.contribute("routes", "{{MODULE_ID}}", {"id": "{{ROUTE}}", "label": "{{LABEL}}"})
    kernel.contribute("actions", "{{MODULE_ID}}", {"id": "{{ROUTE}}.open", "label": "Open {{LABEL}}"})
    kernel.contribute("settings", "{{MODULE_ID}}", {"group": "{{ROUTE}}", "settings": [{"key": "{{ROUTE}}.enabled", "kind": "toggle", "default": True}]})


LIBRARY = Library(id="{{MODULE_ID}}", label="{{LABEL}}", version="{{VERSION}}", template="{{TEMPLATE}}", register=register)
