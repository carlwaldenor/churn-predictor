"""In-memory plan store with Supabase-backed persistence."""

import os
import uuid
from datetime import datetime, timezone

from supabase import create_client

from schemas import PlanData, ScenarioConfig

_sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# ---------------------------------------------------------------------------
# Plans — in-memory cache, loaded from Supabase on startup
# ---------------------------------------------------------------------------

_plans: dict[str, PlanData] = {}   # key = "{tier}_{plan}_{row_type}"


def store_plan(plan: PlanData) -> None:
    key = f"{plan.tier}_{plan.plan}_{plan.row_type}"
    _plans[key] = plan


def save_csv(filename: str, content: bytes) -> None:
    """Persist a raw CSV to Supabase so it survives server restarts."""
    _sb.table("ss_plans").upsert(
        {"filename": filename, "content": content.decode("utf-8", errors="replace")}
    ).execute()


def load_saved_csvs() -> None:
    """Re-parse all previously uploaded CSVs into the in-memory store.
    Called once at startup."""
    from csv_parser import parse_csv  # local import avoids circular dep
    rows = _sb.table("ss_plans").select("filename, content").execute().data
    for row in rows:
        try:
            plan = parse_csv(row["filename"], row["content"].encode())
            store_plan(plan)
        except Exception:
            pass


def get_plans() -> list[PlanData]:
    return list(_plans.values())


def clear_plans() -> None:
    _plans.clear()
    _sb.table("ss_plans").delete().neq("filename", "").execute()


# ---------------------------------------------------------------------------
# Scenarios — persisted in Supabase
# ---------------------------------------------------------------------------


def list_scenarios() -> list[ScenarioConfig]:
    rows = _sb.table("ss_scenarios").select("data").order("created_at").execute().data
    scenarios = []
    for row in rows:
        try:
            scenarios.append(ScenarioConfig.model_validate(row["data"]))
        except Exception:
            pass
    return scenarios


def get_scenario(scenario_id: str) -> ScenarioConfig | None:
    rows = _sb.table("ss_scenarios").select("data").eq("id", scenario_id).execute().data
    if not rows:
        return None
    return ScenarioConfig.model_validate(rows[0]["data"])


def save_scenario(scenario: ScenarioConfig) -> ScenarioConfig:
    if not scenario.id:
        scenario.id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    scenario.updated_at = now
    if not scenario.created_at:
        scenario.created_at = now
    _sb.table("ss_scenarios").upsert({
        "id": scenario.id,
        "data": scenario.model_dump(),
        "created_at": scenario.created_at,
        "updated_at": scenario.updated_at,
    }).execute()
    return scenario


def delete_scenario(scenario_id: str) -> bool:
    result = _sb.table("ss_scenarios").delete().eq("id", scenario_id).execute()
    return len(result.data) > 0
