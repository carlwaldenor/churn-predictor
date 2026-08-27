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
    "historical_churn",   # optional — enables year-over-year comparison chart
    "payment_failures",   # optional — enables rolling-average fallback Rm
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
    """Insert a new prediction run — every run is preserved for historical analysis."""
    _sb.table("cp_prediction_runs").insert({
        "analysis_month": analysis_month,
        "run_at": datetime.utcnow().isoformat(),
        "inputs": inputs,
        "breakdown": breakdown,
    }).execute()


def load_predictions() -> list:
    """Return the most recent run per month, ordered newest-month first.

    All runs are stored; this function deduplicates so the UI dropdown shows
    one entry per month (the latest). The full history is queryable in Supabase.
    """
    try:
        res = (
            _sb.table("cp_prediction_runs")
            .select("analysis_month, run_at, inputs, breakdown")
            .order("run_at", desc=True)   # newest run first across all months
            .execute()
        )
        # Keep only the most-recent run per analysis_month
        seen: set[str] = set()
        unique: list = []
        for row in (res.data or []):
            if row["analysis_month"] not in seen:
                seen.add(row["analysis_month"])
                unique.append(row)
        # Re-sort by month descending for the dropdown
        unique.sort(key=lambda r: r["analysis_month"], reverse=True)
        return unique
    except Exception:
        return []


def save_meta(key: str, value: str) -> None:
    """Store a scalar metadata value in cp_files under a reserved key."""
    _sb.table("cp_files").upsert({"file_type": key, "content": value}).execute()


def load_meta(key: str) -> str | None:
    rows = _sb.table("cp_files").select("content").eq("file_type", key).execute().data
    return rows[0]["content"] if rows else None


def save_churn_actual(analysis_month: str, voluntary_churn: int) -> None:
    """Upsert the voluntary churn count for a given month."""
    _sb.table("cp_churn_actuals").upsert({
        "analysis_month": analysis_month,
        "voluntary_churn": voluntary_churn,
        "synced_at": datetime.utcnow().isoformat(),
    }).execute()


def load_churn_actual(analysis_month: str) -> dict | None:
    """Return the stored churn actual for a month, or None if not found."""
    rows = (
        _sb.table("cp_churn_actuals")
        .select("analysis_month, voluntary_churn, synced_at")
        .eq("analysis_month", analysis_month)
        .execute()
        .data
    )
    return rows[0] if rows else None


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
