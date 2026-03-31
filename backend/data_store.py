import io
import os
from datetime import datetime

import pandas as pd
from supabase import create_client

_sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

VALID_FILE_TYPES = [
    "monthly_cohorts",
    "annual_cohorts",
    "daily_growth_monthly",
    "daily_growth_annual",
]


def save_csv(file_type: str, file_bytes: bytes) -> int:
    df = pd.read_csv(io.BytesIO(file_bytes))  # validate before storing
    _sb.table("cp_files").upsert(
        {"file_type": file_type, "content": file_bytes.decode("utf-8", errors="replace")}
    ).execute()
    return len(df)


def load_csv(file_type: str) -> pd.DataFrame | None:
    rows = _sb.table("cp_files").select("content").eq("file_type", file_type).execute().data
    if not rows:
        return None
    return pd.read_csv(io.StringIO(rows[0]["content"]))


def save_prediction(analysis_month: str, inputs: dict, breakdown: dict) -> None:
    """Upsert a prediction run — re-running the same month overwrites."""
    _sb.table("cp_prediction_runs").upsert({
        "analysis_month": analysis_month,
        "run_at": datetime.utcnow().isoformat(),
        "inputs": inputs,
        "breakdown": breakdown,
    }).execute()


def load_predictions() -> list:
    """Return all saved runs ordered newest-month first."""
    try:
        res = (
            _sb.table("cp_prediction_runs")
            .select("analysis_month, run_at, inputs, breakdown")
            .order("analysis_month", desc=True)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def get_status() -> dict:
    rows = _sb.table("cp_files").select("file_type, content").execute().data
    existing = {row["file_type"]: row["content"] for row in rows}
    result = {}
    for ft in VALID_FILE_TYPES:
        if ft in existing:
            try:
                df = pd.read_csv(io.StringIO(existing[ft]))
                result[ft] = {"exists": True, "row_count": len(df)}
            except Exception:
                result[ft] = {"exists": False, "row_count": 0}
        else:
            result[ft] = {"exists": False, "row_count": 0}
    return result
