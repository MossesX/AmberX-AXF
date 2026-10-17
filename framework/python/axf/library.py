"""Library contract for the Python port — mirrors the Kotlin AxfModule / web AxfWebLibrary.

A library is a `Library` value with a `register(kernel)` hook. The kernel (to be ported from the Kotlin
kernel, verified by framework/spec/fixtures) exposes extension points and a service registry; until it
exists, `MemoryKernel` below records contributions so libraries can be imported and smoke-tested.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


class Kernel(Protocol):
    def contribute(self, point: str, owner: str, value: Any) -> None: ...
    def service(self, name: str) -> Any: ...
    def register_service(self, name: str, value: Any) -> None: ...


@dataclass
class Library:
    id: str
    label: str
    version: str
    template: str = ""
    depends_on: list[str] = field(default_factory=list)
    provides: list[str] = field(default_factory=list)
    register: Callable[[Kernel], None] | None = None


@dataclass
class MemoryKernel:
    """Stand-in kernel: records what libraries contribute (used by `axf compile-library` for the import smoke test)."""
    contributions: list[tuple[str, str, Any]] = field(default_factory=list)
    services: dict[str, Any] = field(default_factory=dict)

    def contribute(self, point: str, owner: str, value: Any) -> None:
        self.contributions.append((point, owner, value))

    def service(self, name: str) -> Any:
        return self.services.get(name)

    def register_service(self, name: str, value: Any) -> None:
        self.services[name] = value
