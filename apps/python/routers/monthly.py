"""Monthly HiveReport endpoints."""
import logging
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.monthly_report import compute_monthly_stats, generate_monthly_report

log = logging.getLogger(__name__)
router = APIRouter(prefix="/monthly", tags=["monthly"])


class MonthRequest(BaseModel):
    year: int | None = None
    month: int | None = None


@router.post("/snapshot")
async def trigger_snapshot(req: MonthRequest = MonthRequest()) -> dict:
    """Compute and store monthly stats for the given month (defaults to current)."""
    today = date.today()
    year = req.year or today.year
    month = req.month or today.month
    stats = await compute_monthly_stats(year, month)
    if "error" in stats:
        raise HTTPException(status_code=500, detail=stats["error"])
    return stats


@router.post("/generate")
async def trigger_generate(req: MonthRequest = MonthRequest()) -> dict:
    """Run Claude synthesis and create a monthly report content pack."""
    today = date.today()
    year = req.year or today.year
    month = req.month or today.month
    result = await generate_monthly_report(year, month)
    if result is None:
        raise HTTPException(status_code=500, detail="Monthly report generation failed")
    return result
