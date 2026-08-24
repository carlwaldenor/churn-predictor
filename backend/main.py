import os
from datetime import date, timedelta
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import chartmogul_client
import data_store
import engine

app = FastAPI(title="Churn Predictor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Upload CSV
# ---------------------------------------------------------------------------

@app.post("/api/upload-csv")
async def upload_csv(
    file_type: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
):
    if file_type not in data_store.VALID_FILE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file_type. Must be one of: {data_store.VALID_FILE_TYPES}",
        )
    contents = await file.read()
    try:
        row_count = data_store.save_csv(file_type, contents)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {exc}") from exc

    return {"success": True, "file_type": file_type, "row_count": row_count}


# ---------------------------------------------------------------------------
# CSV status
# ---------------------------------------------------------------------------

@app.get("/api/csv-status")
def csv_status():
    return data_store.get_status()


# ---------------------------------------------------------------------------
# ChartMogul sync
# ---------------------------------------------------------------------------

@app.post("/api/sync-chartmogul")
def sync_chartmogul():
    """
    Fetch daily growth and historical churn data directly from the ChartMogul API
    and store them in Supabase, replacing any previously uploaded files.

    Requires the CHARTMOGUL_API_KEY environment variable to be set on the server.
    Optionally reads CHARTMOGUL_MONTHLY_PLAN_IDS and CHARTMOGUL_ANNUAL_PLAN_IDS
    (comma-separated UUIDs) to skip the auto-detection step.

    Does NOT touch monthly_cohorts or annual_cohorts — those still require
    a manual CSV upload from ChartMogul's UI.
    """
    api_key = os.environ.get("CHARTMOGUL_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="CHARTMOGUL_API_KEY is not set on the server. Add it as an environment variable in Render.",
        )

    try:
        # Resolve plan UUIDs — prefer explicit env vars, fall back to auto-detect
        monthly_env = os.environ.get("CHARTMOGUL_MONTHLY_PLAN_IDS", "").strip()
        annual_env  = os.environ.get("CHARTMOGUL_ANNUAL_PLAN_IDS",  "").strip()

        if monthly_env and annual_env:
            monthly_uuids = [x.strip() for x in monthly_env.split(",") if x.strip()]
            annual_uuids  = [x.strip() for x in annual_env.split(",")  if x.strip()]
        else:
            groups = chartmogul_client.fetch_plan_groups(api_key)
            monthly_uuids = groups["monthly"]
            annual_uuids  = groups["annual"]

        # Date range: 3 years back for daily growth, 5 years back for churn rate
        today      = date.today()
        growth_start = (today - timedelta(days=365 * 3)).isoformat()
        churn_start  = (today - timedelta(days=365 * 5)).isoformat()
        end_date     = today.isoformat()

        # Fetch from ChartMogul
        monthly_growth = chartmogul_client.fetch_daily_growth(api_key, monthly_uuids, growth_start, end_date)
        annual_growth  = chartmogul_client.fetch_daily_growth(api_key, annual_uuids,  growth_start, end_date)
        churn_df       = chartmogul_client.fetch_historical_churn(api_key, churn_start, end_date)

        # Persist via the same path as manual CSV upload
        results = {}
        for file_type, df in [
            ("daily_growth_monthly", monthly_growth),
            ("daily_growth_annual",  annual_growth),
            ("historical_churn",     churn_df),
        ]:
            csv_bytes = df.to_csv(index=False).encode("utf-8")
            row_count = data_store.save_csv(file_type, csv_bytes)
            results[file_type] = row_count

        # Sync churn actuals for the past 13 months (captures last full month + rolling window)
        actuals_synced = 0
        try:
            months_to_sync = []
            for i in range(1, 14):  # 1..13 months ago (skip current partial month)
                d = today.replace(day=1) - timedelta(days=i * 28)
                months_to_sync.append(f"{d.year}-{d.month:02d}")
            months_to_sync = sorted(set(months_to_sync))

            actuals = chartmogul_client.fetch_churn_actuals_bulk(api_key, months_to_sync)
            for rec in actuals:
                data_store.save_churn_actual(rec["analysis_month"], rec["voluntary_churn"])
            actuals_synced = len(actuals)
        except Exception:
            pass  # don't fail the whole sync if actuals fetch errors

        return {
            "success": True,
            "synced_row_counts": results,
            "monthly_plan_count": len(monthly_uuids),
            "annual_plan_count":  len(annual_uuids),
            "churn_actuals_synced": actuals_synced,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Churn actuals lookup
# ---------------------------------------------------------------------------

@app.get("/api/churn-actual/{analysis_month}")
def churn_actual(analysis_month: str):
    """
    Return the stored voluntary churn count for a given month (YYYY-MM).
    Used by the Run Prediction tab to auto-fill the Reported Voluntary Churn field.
    Returns {"found": false} if no data has been synced for that month yet.
    """
    rec = data_store.load_churn_actual(analysis_month)
    if rec is None:
        return {"found": False, "analysis_month": analysis_month}
    return {
        "found": True,
        "analysis_month": analysis_month,
        "voluntary_churn": rec["voluntary_churn"],
        "synced_at": rec["synced_at"],
    }


# ---------------------------------------------------------------------------
# Predict
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    analysis_month: str          # YYYY-MM
    current_date: date           # YYYY-MM-DD
    dunning_duration: int = 30
    reported_total_churn: float
    reported_voluntary_churn: float
    annual_risk_weight: float = 2.0
    opening_balance: float
    new_sales: float = 0.0


@app.post("/api/predict")
def predict(req: PredictRequest):
    dfs = {ft: data_store.load_csv(ft) for ft in data_store.VALID_FILE_TYPES}

    required = ["monthly_cohorts", "annual_cohorts", "daily_growth_monthly", "daily_growth_annual"]
    missing = [ft for ft in required if dfs.get(ft) is None]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing CSV files: {missing}. Please upload all four data files first.",
        )

    params = {
        "analysis_month": req.analysis_month,
        "current_date": req.current_date,
        "dunning_duration": req.dunning_duration,
        "reported_total_churn": req.reported_total_churn,
        "reported_voluntary_churn": req.reported_voluntary_churn,
        "annual_risk_weight": req.annual_risk_weight,
        "opening_balance": req.opening_balance,
        "new_sales": req.new_sales,
    }

    try:
        result = engine.run_prediction(dfs, params)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

    # Persist run to Supabase (current_date serialised to string for JSON storage)
    inputs_dict = {**params, "current_date": req.current_date.isoformat()}
    try:
        data_store.save_prediction(req.analysis_month, inputs_dict, result)
    except Exception:
        pass  # never let a save failure break the prediction response

    return {"breakdown": result}


# ---------------------------------------------------------------------------
# Renewal pool history
# ---------------------------------------------------------------------------

@app.get("/api/renewal-pool-history")
def renewal_pool_history():
    dfs = {ft: data_store.load_csv(ft) for ft in data_store.VALID_FILE_TYPES}
    required = ["monthly_cohorts", "annual_cohorts", "daily_growth_monthly", "daily_growth_annual"]
    missing = [ft for ft in required if dfs.get(ft) is None]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing CSV files: {missing}. Please upload all four data files first.",
        )
    try:
        return engine.build_renewal_pool_series(dfs, months_back=12, months_forward=3)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Prediction run history
# ---------------------------------------------------------------------------

@app.get("/api/prediction-runs")
def get_prediction_runs():
    return data_store.load_predictions()


# ---------------------------------------------------------------------------
# Debug: inspect CSV column names (safe, can't crash)
# ---------------------------------------------------------------------------

@app.get("/api/debug-columns/{file_type}")
def debug_columns(file_type: str):
    """Return column names and first/last rows of a CSV — all values coerced to str."""
    try:
        df = data_store.load_csv(file_type)
        if df is None:
            return {"status": "not_uploaded"}
        df2 = engine._normalize_cohort_df(df)
        cols = [str(c) for c in df2.columns]
        def safe_row(r):
            return {str(k): str(v) for k, v in r.items()}
        return {
            "status": "ok",
            "shape": [int(df2.shape[0]), int(df2.shape[1])],
            "columns": cols,
            "first_row": safe_row(df2.iloc[0].to_dict()) if len(df2) > 0 else {},
            "last_row":  safe_row(df2.iloc[-1].to_dict()) if len(df2) > 0 else {},
        }
    except Exception as exc:
        import traceback
        return {"status": "error", "detail": traceback.format_exc()}


# ---------------------------------------------------------------------------
# Debug: cohort breakdown for a specific month
# ---------------------------------------------------------------------------

def _safe(v):
    """Convert a value to a JSON-safe Python primitive."""
    if v is None:
        return None
    try:
        import math
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        # Keep ints as ints
        if isinstance(v, (int,)) or (hasattr(v, 'item') and isinstance(v.item(), int)):
            return int(v)
        return f
    except (TypeError, ValueError):
        return str(v)


@app.get("/api/debug-pool/{analysis_month}")
def debug_pool(analysis_month: str):
    """Return per-cohort breakdown for _build_renewal_pool to diagnose pool issues."""
    try:
        df_raw = data_store.load_csv("monthly_cohorts")
        if df_raw is None:
            raise HTTPException(status_code=400, detail="monthly_cohorts not uploaded")

        cohorts_df = engine._normalize_cohort_df(df_raw)
        cohorts_df = engine._clean_df(cohorts_df)
        signup_col = engine._find_col(cohorts_df, ["signup_month", "signup", "month", "cohort_month"])
        size_col   = engine._find_col(cohorts_df, ["cohort_size", "cohort_value", "size", "subscribers", "count"])

        rows_info = []
        for _, row in cohorts_df.iterrows():
            try:
                signup_ym = engine._parse_ym(str(row[signup_col])) if signup_col else "?"
            except Exception:
                signup_ym = "?"
            reason = None
            if signup_ym == "?" or not signup_ym:
                reason = "excluded (bad signup_ym)"
            elif signup_ym >= analysis_month:
                reason = "excluded (signup >= analysis_month)"
            T = None
            if reason is None:
                try:
                    T = int(engine._months_elapsed(signup_ym, analysis_month))
                except Exception as e:
                    reason = f"excluded (_months_elapsed error: {e})"
            if T is not None and (T <= 0 or T > 96):
                reason = f"excluded (T={T} out of range)"
            cohort_size = None
            cum_churn = None
            survivors = None
            if reason is None and size_col:
                try:
                    cohort_size = float(row[size_col])
                except Exception:
                    reason = "bad cohort_size"
            if reason is None:
                try:
                    cum_churn = float(engine._get_cumulative_churn(row, T - 1))
                    survivors = float(max(0.0, cohort_size - cum_churn))
                    if survivors == 0.0:
                        reason = "survivors=0"
                except Exception as e:
                    reason = f"error computing survivors: {e}"
            rows_info.append({
                "signup_ym": str(signup_ym),
                "T": T,
                "cohort_size": _safe(cohort_size),
                "cum_churn_at_T1": _safe(cum_churn),
                "survivors": _safe(survivors),
                "reason_excluded": reason,
            })

        contributing = [r for r in rows_info if r["reason_excluded"] is None]
        excluded     = [r for r in rows_info if r["reason_excluded"] is not None]
        total_surv   = float(sum(r["survivors"] for r in contributing)) if contributing else 0.0

        return {
            "analysis_month": str(analysis_month),
            "total_cohorts": int(len(rows_info)),
            "contributing_cohorts": int(len(contributing)),
            "excluded_cohorts": int(len(excluded)),
            "total_survivors": round(total_surv, 2),
            "signup_col": str(signup_col) if signup_col else None,
            "size_col": str(size_col) if size_col else None,
            "contributing": contributing[:50],
            "excluded_sample": excluded[:20],
        }
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        raise HTTPException(status_code=500, detail=traceback.format_exc()) from exc
