"""{{LABEL}} — generated from the `{{TEMPLATE}}` library template (Python port of {{MODULE_ID}})."""
from __future__ import annotations

from axf.library import Kernel, Library


class {{CLASS}}Provider:
    name = "base"

    def status(self) -> str:
        raise NotImplementedError


class Mock{{CLASS}}Provider({{CLASS}}Provider):
    name = "mock"

    def status(self) -> str:
        return "Mock {{LABEL}} provider ready"


class {{CLASS}}Service:
    def __init__(self, provider: {{CLASS}}Provider | None = None) -> None:
        self.provider = provider or Mock{{CLASS}}Provider()


def register(kernel: Kernel) -> None:
    kernel.contribute("routes", "{{MODULE_ID}}", {"id": "{{ROUTE}}", "label": "{{LABEL}}"})
    kernel.contribute("actions", "{{MODULE_ID}}", {"id": "{{ROUTE}}.open", "label": "Open {{LABEL}}"})
    kernel.contribute("settings", "{{MODULE_ID}}", {"group": "{{ROUTE}}", "settings": [{"key": "{{ROUTE}}.enabled", "kind": "toggle", "default": True}]})
    kernel.register_service("{{MODULE_ID}}.service", {{CLASS}}Service())


LIBRARY = Library(id="{{MODULE_ID}}", label="{{LABEL}}", version="{{VERSION}}", template="{{TEMPLATE}}", register=register)
