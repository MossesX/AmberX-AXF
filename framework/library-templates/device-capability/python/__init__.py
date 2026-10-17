"""{{LABEL}} — generated from the `{{TEMPLATE}}` library template (Python port of {{MODULE_ID}})."""
from __future__ import annotations

from axf.library import Kernel, Library


class {{CLASS}}Capability:
    permission = "{{P_PERMISSION}}"

    def state(self) -> str:
        return "unknown"  # desktop: replace with the platform check (e.g. QMediaDevices for the camera)


def register(kernel: Kernel) -> None:
    kernel.contribute("routes", "{{MODULE_ID}}", {"id": "{{ROUTE}}", "label": "{{LABEL}}"})
    kernel.contribute("actions", "{{MODULE_ID}}", {"id": "{{ROUTE}}.open", "label": "Open {{LABEL}}"})
    kernel.contribute("settings", "{{MODULE_ID}}", {"group": "{{ROUTE}}", "settings": [{"key": "{{ROUTE}}.enabled", "kind": "toggle", "default": True}]})
    kernel.register_service("{{MODULE_ID}}.capability", {{CLASS}}Capability())


LIBRARY = Library(id="{{MODULE_ID}}", label="{{LABEL}}", version="{{VERSION}}", template="{{TEMPLATE}}", register=register)
