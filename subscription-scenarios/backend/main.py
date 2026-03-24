import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import data_store
import engine
from csv_parser import parse_csv
from schemas import ScenarioConfig, ForecastResult

app = FastAPI(title="EP Subscription Scenarios API")


@app.on_event("startup")
def startup():
    data_store.load_saved_csvs()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    """Upload one or more CSV files. Returns parsed PlanData list."""
    results = []
    errors = []
    for f in files:
        content = await f.read()
        try:
            plan = parse_csv(f.filename, content)
            data_store.store_plan(plan)
            data_store.save_csv(f.filename, content)
            results.append({
                "filename": f.filename,
                "tier": plan.tier,
                "plan": plan.plan,
                "row_type": plan.row_type,
                "rows": len(plan.rows),
                "price": plan.price,
            })
        except Exception as exc:
            errors.append({"filename": f.filename, "error": str(exc)})

    return {"imported": results, "errors": errors}


@app.get("/api/plans")
def get_plans():
    """List currently loaded plans with derived baselines."""
    plans = data_store.get_plans()
    result = []
    for p in plans:
        rows = p.rows
        n = len(rows)
        avg_churn_rate = (
            sum(abs(r.churn_count) / r.total_subscribers for r in rows if r.total_subscribers > 0) / n
            if n else 0.0
        )
        avg_total_sales = int(sum(r.new_subscriber_count + r.reactivation_count for r in rows) / n) if n else 0
        result.append({
            "key": f"{p.tier}_{p.plan}_{p.row_type}",
            "tier": p.tier,
            "plan": p.plan,
            "row_type": p.row_type,
            "price": p.price,
            "row_count": n,
            "date_range": f"{rows[0].date} → {rows[-1].date}" if rows else "—",
            "avg_churn_rate": round(avg_churn_rate, 6),
            "avg_total_sales": avg_total_sales,
            "monthly_data": [
                {
                    "date": r.date,
                    "mrr": r.mrr,
                    "total_subscribers": r.total_subscribers,
                    "new_subscriber_count": r.new_subscriber_count,
                    "reactivation_count": r.reactivation_count,
                    "churn_count": r.churn_count,
                }
                for r in rows
            ],
        })
    return result


@app.delete("/api/plans")
def clear_plans():
    data_store.clear_plans()
    return {"cleared": True}


# ---------------------------------------------------------------------------
# Forecast
# ---------------------------------------------------------------------------

@app.post("/api/forecast", response_model=ForecastResult)
def forecast(scenario: ScenarioConfig):
    """Run a forecast for the given scenario config against loaded plans."""
    plans = data_store.get_plans()
    if not plans:
        raise HTTPException(status_code=400, detail="No plans loaded. Upload CSV files first.")
    try:
        return engine.run_forecast(plans, scenario)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

@app.get("/api/scenarios")
def list_scenarios():
    return data_store.list_scenarios()


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    s = data_store.get_scenario(scenario_id)
    if not s:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return s


@app.post("/api/scenarios")
def create_scenario(scenario: ScenarioConfig):
    now = datetime.now(timezone.utc).isoformat()
    if not scenario.id:
        scenario.id = str(uuid.uuid4())[:8]
    if not scenario.created_at:
        scenario.created_at = now
    return data_store.save_scenario(scenario)


@app.put("/api/scenarios/{scenario_id}")
def update_scenario(scenario_id: str, scenario: ScenarioConfig):
    scenario.id = scenario_id
    return data_store.save_scenario(scenario)


@app.delete("/api/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str):
    if not data_store.delete_scenario(scenario_id):
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"deleted": scenario_id}


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# New plans (forecast-only, persisted independently of scenarios)
# ---------------------------------------------------------------------------

@app.get("/api/new-plans")
def get_new_plans():
    return data_store.load_new_plans()


@app.post("/api/new-plans")
def save_new_plans(plans: list = Body(...)):
    data_store.save_new_plans(plans)
    return {"ok": True}
