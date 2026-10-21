"""Console credential store (core): <repo>/.axf-console/secrets.env, 0600, git-ignored (axf_server.credentials).

Loaded into the API's environment when the console starts, so every feature (and every subprocess) sees the keys,
whatever plugins are installed. The systems-check plugin is where you type them; values are never sent back to a
browser (only whether each one is set). Separate from the env file install-console.sh rewrites.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server.credentials import KEY_RE, CredentialError, CredStore as _FrameworkCredStore  # noqa: F401

HEADER = "# AXF Dev Console credentials (saved from the systems check). Never commit this file.\n"


class CredStore(_FrameworkCredStore):
    """The framework's 0600 env-file store (axf_server.credentials) with the console's header line."""

    def __init__(self, path: Path) -> None:
        super().__init__(path, header=HEADER)


# What can be stored. `secret` values are masked everywhere; `pattern` is a light format check (never a guarantee).
CREDENTIALS: dict[str, dict[str, Any]] = {
    "GITHUB_TOKEN": {"label": "GitHub token", "secret": True, "pattern": r"^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$",
                     "placeholder": "github_pat_… or ghp_…", "help": "Fine-grained token for MossesX/AmberX-AXF: Contents read/write, Actions read."},
    "ANTHROPIC_API_KEY": {"label": "Anthropic API key", "secret": True, "pattern": r"^sk-ant-[A-Za-z0-9_\-]{20,}$",
                          "placeholder": "sk-ant-…", "help": "From console.anthropic.com → API keys. Used by API-key features and claude-pick's API mode."},
    "HOSTINGER_API_TOKEN": {"label": "Hostinger API token", "secret": True, "pattern": r"^[A-Za-z0-9_\-\.|:=+/]{20,512}$",
                            "placeholder": "token from hPanel", "help": "hPanel → Profile → API → New token."},
    "COOLIFY_URL": {"label": "Coolify URL", "secret": False, "pattern": r"^https?://[^\s/]+(:\d+)?/?$",
                    "placeholder": "https://coolify.amberxai.com", "help": "The address of your Coolify dashboard."},
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


def init(root: Path) -> CredStore:
    """Called once by main.py at start, before plugins load."""
    global STORE
    STORE = CredStore(root / ".axf-console" / "secrets.env")
    STORE.load_into_env()
    return STORE
