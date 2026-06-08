from datetime import date
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
# Debug: cohort breakdown for a specific month
# ---------------------------------------------------------------------------

@app.get("/api/debug-pool/{analysis_month}")
def debug_pool(analysis_month: str):
    """Return per-cohort breakdown for _build_renewal_pool to diagnose pool issues."""
    import calendar as cal
    from datetime import date as _date
    dfs = {ft: data_store.load_csv(ft) for ft in data_store.VALID_FILE_TYPES}
    cohorts_df = dfs.get("monthly_cohorts")
    if cohorts_df is None:
        raise HTTPException(status_code=400, detail="monthly_cohorts not uploaded")

    cohorts_df = engine._normalize_cohort_df(cohorts_df)
    cohorts_df = engine._clean_df(cohorts_df)
    signup_col = engine._find_col(cohorts_df, ["signup_month", "signup", "month", "cohort_month"])
    size_col   = engine._find_col(cohorts_df, ["cohort_size", "cohort_value", "size", "subscribers", "count"])

    rows_info = []
    for _, row in cohorts_df.iterrows():
        signup_ym = engine._parse_ym(str(row[signup_col])) if signup_col else "?"
        reason = None
        if signup_ym >= analysis_month:
            reason = "excluded (signup >= analysis_month)"
        T = engine._months_elapsed(signup_ym, analysis_month) if reason is None else None
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
            cum_churn = engine._get_cumulative_churn(row, T - 1)
            survivors = max(0.0, cohort_size - cum_churn)
            if survivors == 0:
                reason = "survivors=0"
        rows_info.append({
            "signup_ym": signup_ym,
            "T": T,
            "cohort_size": cohort_size,
            "cum_churn_at_T1": cum_churn,
            "survivors": survivors,
            "reason_excluded": reason,
        })

    contributing = [r for r in rows_info if r["reason_excluded"] is None]
    excluded     = [r for r in rows_info if r["reason_excluded"] is not None]
    return {
        "analysis_month": analysis_month,
        "total_cohorts": len(rows_info),
        "contributing_cohorts": len(contributing),
        "excluded_cohorts": len(excluded),
        "total_survivors": round(sum(r["survivors"] for r in contributing), 2),
        "signup_col": signup_col,
        "size_col": size_col,
        "contributing": contributing[:50],   # cap at 50 rows to keep response small
        "excluded_sample": excluded[:20],
    }
