"""{{LABEL}} — generated from the `{{TEMPLATE}}` library template (Python port of {{MODULE_ID}})."""
from __future__ import annotations

from axf.library import Kernel, Library

from dataclasses import dataclass, field
import time


@dataclass
class {{CLASS}}Item:
    id: str
    title: str
    done: bool = False
    created_at: float = field(default_factory=time.time)


class {{CLASS}}Repository:
    def __init__(self) -> None:
        self.items: list[{{CLASS}}Item] = []

    def add(self, title: str) -> {{CLASS}}Item:
        item = {{CLASS}}Item(id=format(time.time_ns(), "x"), title=title.strip())
        self.items.append(item)
        return item

    def toggle(self, item_id: str) -> None:
        for it in self.items:
            if it.id == item_id:
                it.done = not it.done

    def remove(self, item_id: str) -> None:
        self.items = [it for it in self.items if it.id != item_id]


def register(kernel: Kernel) -> None:
    kernel.contribute("routes", "{{MODULE_ID}}", {"id": "{{ROUTE}}", "label": "{{LABEL}}"})
    kernel.contribute("actions", "{{MODULE_ID}}", {"id": "{{ROUTE}}.open", "label": "Open {{LABEL}}"})
    kernel.contribute("settings", "{{MODULE_ID}}", {"group": "{{ROUTE}}", "settings": [{"key": "{{ROUTE}}.enabled", "kind": "toggle", "default": True}]})
    kernel.register_service("{{MODULE_ID}}.repository", {{CLASS}}Repository())


LIBRARY = Library(id="{{MODULE_ID}}", label="{{LABEL}}", version="{{VERSION}}", template="{{TEMPLATE}}", register=register)
