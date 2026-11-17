"""Phone Connect (phone-connect@1): the console side of the companion app. Mounted at /api/plugins/phone-connect/.

Contract: framework/spec/PHONE-CONNECT.md; reference engine framework/core/phone-connect.mjs (this package's engine.py is
its Python port, held to framework/spec/fixtures/phone-connect.json by test.py). Data: data-store@1 namespace `phone`.
"""
from fastapi import APIRouter

router = APIRouter()
