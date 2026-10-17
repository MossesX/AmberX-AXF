"""{{LABEL}} — generated from the `{{TEMPLATE}}` library template (Python port of {{MODULE_ID}})."""
from __future__ import annotations

from axf.library import Kernel, Library

import urllib.request


class {{CLASS}}Client:
    def __init__(self, base_url: str = "{{P_BASE_URL}}") -> None:
        self.base_url = base_url

    def ping(self) -> int | None:
        try:
            with urllib.request.urlopen(self.base_url, timeout=10) as r:
                return r.status
        except Exception:
            return None


def register(kernel: Kernel) -> None:
    kernel.contribute("routes", "{{MODULE_ID}}", {"id": "{{ROUTE}}", "label": "{{LABEL}}"})
    kernel.contribute("actions", "{{MODULE_ID}}", {"id": "{{ROUTE}}.open", "label": "Open {{LABEL}}"})
    kernel.contribute("settings", "{{MODULE_ID}}", {"group": "{{ROUTE}}", "settings": [{"key": "{{ROUTE}}.enabled", "kind": "toggle", "default": True}]})
    kernel.register_service("{{MODULE_ID}}.client", {{CLASS}}Client())


LIBRARY = Library(id="{{MODULE_ID}}", label="{{LABEL}}", version="{{VERSION}}", template="{{TEMPLATE}}", register=register)
