"""Server part of the picker-dialog console plugin. Mounted at /api/plugins/picker-dialog/.

The routes live in routes.py (state, open / choose / close, settings get / set); the console adds the token check and
answers 404 while the plugin is disabled.
"""
from .routes import router  # noqa: F401
