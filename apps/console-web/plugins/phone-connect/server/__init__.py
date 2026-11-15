"""Phone Connect server part, mounted at /api/plugins/phone-connect/ (console token + enabled check added by the console).

Routes live in routes.py; the device registry and pairing in devices.py, the command queue in commands.py, the
recorder in recorder.py and the auto-approval rules in rules.py. Data stays in .axf-console/plugins/phone-connect.
"""
from .recorder import boot as _boot
from .routes import router  # noqa: F401

_boot()
