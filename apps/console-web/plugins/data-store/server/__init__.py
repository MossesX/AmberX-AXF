"""Data store plugin (server part): the console's window on axf-data. Routes live in routes.py."""
from .routes import router  # noqa: F401 — the console mounts `router` at /api/plugins/data-store/
