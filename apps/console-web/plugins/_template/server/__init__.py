"""Server part of the example console plugin. Mounted at /api/plugins/<folder>/.

Every route here requires the console token (for every method) and answers 404 while the plugin is
disabled; the console adds both checks when it mounts the router. Keep secrets in environment variables.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello from the example plugin's server part."}
