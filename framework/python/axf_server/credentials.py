"""A server's credential store: one owner-only env file of KEY=value lines.

    store = CredStore(root / ".axf-console" / "secrets.env")
    store.read()            {KEY: value} (comments, blank lines and keys that aren't UPPER_SNAKE are ignored)
    store.set("GITHUB_TOKEN", tok)      writes the file atomically (0600) and puts the value in os.environ
    store.clear("GITHUB_TOKEN")
    store.load_into_env()   at start, so every feature (and every subprocess) sees the keys

Values are never sent anywhere by this module; a caller that shows credentials shows only whether each is set.
A value can't contain a line break (it would add a second key), so `set` refuses one.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Callable, MutableMapping

from . import storage

__all__ = ["KEY_RE", "CredStore", "CredentialError"]

KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
HEADER = "# Credentials for this server. Never commit this file.\n"


class CredentialError(ValueError):
    pass


class CredStore:
    def __init__(self, path: str | os.PathLike[str], *, header: str = HEADER,
                 environ: MutableMapping[str, str] | None = None, dir_mode: int | None = storage.PRIVATE_DIR) -> None:
        self.path = Path(path)
        self.header = header if header.endswith("\n") or not header else header + "\n"
        self.environ: MutableMapping[str, str] = os.environ if environ is None else environ
        self.dir_mode = dir_mode

    def read(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for line in storage.read_text(self.path).splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if KEY_RE.match(k.strip()):
                    out[k.strip()] = v.strip()
        return out

    def write(self, values: dict[str, str]) -> None:
        for k, v in values.items():
            _check(k, v)
        body = self.header + "".join(f"{k}={values[k]}\n" for k in sorted(values))
        storage.write_text(self.path, body, dir_mode=self.dir_mode)

    def set(self, key: str, value: str) -> None:
        _check(key, value)
        vals = self.read()
        vals[key] = value
        self.write(vals)
        self.environ[key] = value

    def clear(self, key: str) -> None:
        vals = self.read()
        vals.pop(key, None)
        self.write(vals)
        self.environ.pop(key, None)

    def is_set(self, key: str) -> bool:
        return bool(self.read().get(key))

    def load_into_env(self, only: Callable[[str], bool] | None = None) -> None:
        for k, v in self.read().items():
            if v and (only is None or only(k)):
                self.environ[k] = v


def _check(key: str, value: str) -> None:
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise CredentialError(f"{key!r} is not a credential name (UPPER_SNAKE_CASE)")
    if not isinstance(value, str) or any(c in value for c in "\r\n\0"):
        raise CredentialError(f"{key}: a value can't contain a line break")
