"""Console credential store (core): <repo>/.axf-console/secrets.env, 0600, git-ignored (axf_server.credentials).

Loaded into the API's environment when the console starts, so every feature (and every subprocess) sees the keys,
whatever plugins are installed. The systems-check plugin is where you type them; values are never sent back to a
browser (only whether each one is set). Separate from the env file install-console.sh rewrites.

Projects (projects@1, framework/spec/PROJECTS.md): the vault is the shared one unless the active project owns its
`credentials`, then it is <repo>/.axf-console/projects/<id>/secrets.env (a whole vault, no per-key fallback). The store
re-resolves its file on every use; when the project in force changes, the credential keys in the environment are swapped
for the new vault's, so subprocesses started afterwards see the new project's keys.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server.credentials import KEY_RE, CredentialError, CredStore as _FrameworkCredStore  # noqa: F401

HEADER = "# AXF Dev Console credentials (saved from the systems check). Never commit this file.\n"


class CredStore(_FrameworkCredStore):
    """The framework's 0600 env-file store (axf_server.credentials) with the console's header line."""

    def __init__(self, path: Path) -> None:
        super().__init__(path, header=HEADER)


class ProjectCredStore(CredStore):
    """The vault of the project in force: `folder()` names the folder holding secrets.env, asked on every use."""

    def __init__(self, folder: Callable[[], Path]) -> None:
        self._folder = folder
        self._loaded: Path | None = None
        self._keys: set[str] = set()
        self._lock = threading.RLock()
        super().__init__(Path(folder()) / "secrets.env")

    @property  # type: ignore[override]
    def path(self) -> Path:
        try:
            return Path(self._folder()) / "secrets.env"
        except Exception:  # noqa: BLE001 — a damaged registry reads as the shared vault
            return self._fallback

    @path.setter
    def path(self, value: Path) -> None:
        self._fallback = Path(value)

    def sync_env(self) -> bool:
        """Swap the environment over to the current vault if the project in force changed. True when it swapped."""
        with self._lock:
            now = self.path
            if now == self._loaded:
                return False
            for k in self._keys:
                os.environ.pop(k, None)
            vals = _FrameworkCredStore.read(self)
            self._keys = {k for k, v in vals.items() if v}
            for k in self._keys:
                os.environ[k] = vals[k]
            self._loaded = now
            return True

    def load_into_env(self, only: Callable[[str], bool] | None = None) -> None:
        self._loaded = None
        self.sync_env()

    def read(self) -> dict[str, str]:
        self.sync_env()
        return super().read()

    def set(self, key: str, value: str) -> None:
        self.sync_env()
        super().set(key, value)
        self._keys.add(key)

    def clear(self, key: str) -> None:
        self.sync_env()
        super().clear(key)
        self._keys.discard(key)


# What can be stored. `secret` values are masked everywhere; `pattern` is a light format check (never a guarantee).
CREDENTIALS: dict[str, dict[str, Any]] = {
    "GITHUB_TOKEN": {"label": "GitHub token", "secret": True, "pattern": r"^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$",
                     "placeholder": "github_pat_… or ghp_…", "help": "Fine-grained token for MossesX/AmberX-AXF: Contents, Pull requests, Actions and Workflows read/write (classic: repo + workflow)."},
    "ANTHROPIC_API_KEY": {"label": "Anthropic API key", "secret": True, "pattern": r"^sk-ant-[A-Za-z0-9_\-]{20,}$",
                          "placeholder": "sk-ant-…", "help": "From console.anthropic.com → API keys. Used by API-key features and claude-pick's API mode."},
    "HOSTINGER_API_TOKEN": {"label": "Hostinger API token", "secret": True, "pattern": r"^[A-Za-z0-9_\-\.|:=+/]{20,512}$",
                            "placeholder": "token from hPanel", "help": "hPanel → Profile → API → New token."},
    "COOLIFY_URL": {"label": "Coolify URL", "secret": False, "pattern": r"^https?://[^\s/]+(:\d+)?/?$",
                    "placeholder": "http://coolify:8080", "help": "http://coolify:8080 reaches Coolify inside the VPS (the token never leaves the server); or your dashboard's https address. Plain http to an IP isn't accepted."},
    "COOLIFY_TOKEN": {"label": "Coolify API token", "secret": True, "pattern": r"^\S{10,}$",
                      "placeholder": "token from Coolify", "help": "Coolify → Keys & Tokens → API tokens (root or write permission)."},
    "AXHUB_URL": {"label": "axHub URL", "secret": False, "pattern": r"^https?://[^\s/]+(:\d+)?/?$",
                  "placeholder": "https://axhub.amberxai.com", "help": "Where your axHub runs."},
    "MOSHI_SSH_PUBKEY": {"label": "Moshi public key", "secret": False,
                         "pattern": r"^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/=]{60,1200}( [A-Za-z0-9@._ -]{1,64})?$",
                         "placeholder": "ssh-ed25519 AAAA… moshi", "help": "Moshi → Keys → your key → copy the public key (one line starting with ssh-ed25519). Public, not a secret."},
    "AXHUB_TOKEN": {"label": "axHub token", "secret": True, "pattern": r"^\S{10,}$",
                    "placeholder": "axHub access token", "help": "axHub → Clients → token for the Dev Console."},
}


STORE: CredStore | None = None


def init(root: Path, folder: Callable[[], Path] | None = None) -> CredStore:
    """Called once by main.py at start, before plugins load. `folder` = where the project in force keeps its vault
    (cx.scope_dir(<repo>/.axf-console, "credentials")); without it, the one shared vault (tests, tools)."""
    global STORE
    STORE = ProjectCredStore(folder) if folder else CredStore(root / ".axf-console" / "secrets.env")
    STORE.load_into_env()
    return STORE
