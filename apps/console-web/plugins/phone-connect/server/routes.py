"""REST routes for Phone Connect (phone-connect@1)."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "contract": "phone-connect@1"}
