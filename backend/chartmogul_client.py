"""
ChartMogul API client — read-only, v1.

Fetches the three files that can be automated:
  - daily_growth_monthly   (MRR movements filtered to monthly plans)
  - daily_growth_annual    (MRR movements filtered to annual plans)
  - historical_churn       (monthly customer churn rate)

Cohort files still require a manual CSV upload from ChartMogul's UI.
"""

from typing import Optional

import pandas as pd
import requests

_BASE = "https://api.chartmogul.com/v1"
_TIMEOUT = 30  # seconds per request


# ---------------------------------------------------------------------------
# Low-level HTTP helper
# ---------------------------------------------------------------------------

def _get(api_key: str, path: str, params: Optional[dict] = None) -> dict:
    """Authenticated GET against the ChartMogul v1 API."""
    resp = requests.get(
        f"{_BASE}{path}",
        auth=(api_key, ""),
        params=params or {},
        timeout=_TIMEOUT,
    )
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        # Surface the response body so the caller can show a useful error
        body = ""
        try:
            body = resp.json().get("message") or resp.text
        except Exception:
            body = resp.text
        raise RuntimeError(f"ChartMogul API error {resp.status_code}: {body}") from exc
    return resp.json()


# ---------------------------------------------------------------------------
# Plan discovery
# ---------------------------------------------------------------------------

def fetch_plan_groups(api_key: str) -> dict:
    """
    Return plan UUIDs grouped as 'monthly' and 'annual' by inspecting
    each plan's interval_unit and interval_count.

    Monthly  : interval_unit='month', interval_count=1
    Annual   : interval_unit='year'  OR  interval_unit='month', interval_count=12
    """
    monthly: list[str] = []
    annual: list[str] = []

    page = 1
    while True:
        data = _get(api_key, "/plans", {"page": page, "per_page": 200})
        for plan in data.get("plans", []):
            uuid = plan.get("uuid")
            if not uuid:
                continue
            unit = plan.get("interval_unit", "")
            count = int(plan.get("interval_count") or 1)
            if unit == "month" and count == 1:
                monthly.append(uuid)
            elif unit == "year" or (unit == "month" and count == 12):
                annual.append(uuid)
        if page >= int(data.get("total_pages") or 1):
            break
        page += 1

    return {"monthly": monthly, "annual": annual}


# ---------------------------------------------------------------------------
# Daily growth (MRR movements → weight proxies)
# ---------------------------------------------------------------------------

def fetch_daily_growth(
    api_key: str,
    plan_uuids: list[str],
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Fetch daily MRR movements for the given plan UUIDs and date range.

    Returns a DataFrame with columns:
        date                   YYYY-MM-DD
        new_subscriber_count   MRR from new business (currency units, used as weight proxy)
        reactivation_count     MRR from reactivations
        churn_count            MRR churned (absolute value)

    The engine normalises these values to weights, so the currency unit
    is irrelevant — only the relative shape across days matters.
    """
    params: dict = {
        "start-date": start_date,
        "end-date": end_date,
        "interval": "day",
    }
    if plan_uuids:
        params["plans"] = ",".join(plan_uuids)

    data = _get(api_key, "/metrics/mrr", params)

    rows = []
    for entry in data.get("entries", []):
        rows.append({
            "date": entry.get("date", ""),
            "new_subscriber_count": float(entry.get("mrr-new-business") or 0),
            "reactivation_count":   float(entry.get("mrr-reactivation") or 0),
            "churn_count":          abs(float(entry.get("mrr-churn") or 0)),
        })

    if not rows:
        return pd.DataFrame(columns=["date", "new_subscriber_count", "reactivation_count", "churn_count"])
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Historical churn rate
# ---------------------------------------------------------------------------

def fetch_historical_churn(
    api_key: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Fetch monthly customer churn rate.

    Returns a DataFrame with columns:
        date                 YYYY-MM-DD (first day of month)
        customer_churn_rate  percentage (e.g. 2.5 means 2.5%)
    """
    data = _get(api_key, "/metrics/customer-churn-rate", {
        "start-date": start_date,
        "end-date": end_date,
        "interval": "month",
    })

    rows = []
    for entry in data.get("entries", []):
        rate = entry.get("customer-churn-rate")
        if rate is not None:
            rows.append({
                "date": entry.get("date", ""),
                "customer_churn_rate": float(rate),
            })

    if not rows:
        return pd.DataFrame(columns=["date", "customer_churn_rate"])
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Monthly churn actuals (subscriber counts via activities)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Cohort reconstruction from activities
# ---------------------------------------------------------------------------

def _fetch_activities_all(api_key: str, activity_type: str, start_date: str, end_date: str) -> list:
    """Cursor-paginated fetch for any activity type."""
    entries = []
    cursor = None
    while True:
        params = {
            "start-date": start_date,
            "end-date": end_date,
            "type": activity_type,
            "per_page": 200,
        }
        if cursor:
            params["cursor"] = cursor
        data = _get(api_key, "/activities", params)
        entries.extend(data.get("entries", []))
        if not data.get("has_more", False):
            break
        cursor = data.get("cursor")
        if not cursor:
            break
    return entries


def _customer_uuid(entry: dict) -> str:
    """Extract customer UUID from an activity entry regardless of key format."""
    return (entry.get("customer_uuid") or entry.get("customer-uuid")
            or entry.get("customerUuid") or "")


def _plan_uuid(entry: dict) -> str:
    return (entry.get("plan_uuid") or entry.get("plan-uuid")
            or entry.get("planUuid") or "")


def _to_month(date_str: str) -> str:
    """Return YYYY-MM from any date string, or ''."""
    return date_str[:7] if date_str and len(date_str) >= 7 else ""


def _months_diff(from_ym: str, to_ym: str) -> int:
    fy, fm = int(from_ym[:4]), int(from_ym[5:7])
    ty, tm = int(to_ym[:4]), int(to_ym[5:7])
    return (ty - fy) * 12 + (tm - fm)


def build_cohort_dataframes(
    api_key: str,
    monthly_uuids: list,
    annual_uuids: list,
    start_date: str,
    end_date: str,
) -> tuple:
    """
    Reconstruct monthly_cohorts and annual_cohorts DataFrames from ChartMogul
    activities. Returns (monthly_df, annual_df).

    Uses new_biz activities for signup month + plan type, churn activities for
    churn age. Only the earliest new_biz per customer is used so reactivations
    don't shift a customer's cohort assignment.

    Output columns: signup_month, cohort_value, 0, 1, 2, ..., N
    where each numbered column is cumulative churned subscribers at that age.
    """
    monthly_set = set(monthly_uuids)
    annual_set = set(annual_uuids)

    # 1. Build customer index from new_biz activities (sorted asc → keep earliest)
    new_biz = sorted(
        _fetch_activities_all(api_key, "new_biz", start_date, end_date),
        key=lambda e: e.get("date", ""),
    )
    customer_info: dict = {}  # uuid → {signup_month, plan_type}
    for entry in new_biz:
        uuid = _customer_uuid(entry)
        if not uuid or uuid in customer_info:
            continue
        pu = _plan_uuid(entry)
        plan_type = "monthly" if pu in monthly_set else "annual" if pu in annual_set else "unknown"
        month = _to_month(entry.get("date", ""))
        if month:
            customer_info[uuid] = {"signup_month": month, "plan_type": plan_type}

    # 2. Initialise cohort size counts
    monthly_cohorts: dict = {}  # signup_month → {size, churns: {age: count}}
    annual_cohorts: dict = {}
    for info in customer_info.values():
        m = info["signup_month"]
        target = (monthly_cohorts if info["plan_type"] == "monthly"
                  else annual_cohorts if info["plan_type"] == "annual" else None)
        if target is not None:
            target.setdefault(m, {"size": 0, "churns": {}})["size"] += 1

    # 3. Assign churn events to cohorts
    churn_entries = _fetch_activities_all(api_key, "churn", start_date, end_date)
    for entry in churn_entries:
        uuid = _customer_uuid(entry)
        churn_month = _to_month(entry.get("date", ""))
        if not uuid or not churn_month:
            continue
        info = customer_info.get(uuid)
        if not info:
            continue
        age = _months_diff(info["signup_month"], churn_month)
        if age < 0 or age > 120:
            continue
        target = (monthly_cohorts if info["plan_type"] == "monthly"
                  else annual_cohorts if info["plan_type"] == "annual" else None)
        if target is None or info["signup_month"] not in target:
            continue
        c = target[info["signup_month"]]["churns"]
        c[age] = c.get(age, 0) + 1

    # 4. Build DataFrames with cumulative churn columns
    def _make_df(cohorts: dict) -> pd.DataFrame:
        if not cohorts:
            return pd.DataFrame(columns=["signup_month", "cohort_value"] + [str(i) for i in range(95)])
        max_age = min(94, max(
            (max(c["churns"].keys(), default=0) for c in cohorts.values()), default=0
        ))
        rows = []
        for signup_month in sorted(cohorts.keys()):
            c = cohorts[signup_month]
            row: dict = {"signup_month": signup_month, "cohort_value": c["size"]}
            cumulative = 0
            for age in range(max_age + 1):
                cumulative += c["churns"].get(age, 0)
                row[str(age)] = cumulative
            rows.append(row)
        return pd.DataFrame(rows)

    return _make_df(monthly_cohorts), _make_df(annual_cohorts)


def fetch_churn_actuals_for_month(api_key: str, analysis_month: str) -> dict:
    """
    Count voluntary cancellation activities for a single month (YYYY-MM).

    Uses the /v1/activities endpoint, type=cancellation. Each entry represents
    a customer whose subscription was cancelled in that month. Note: ChartMogul
    records both voluntary cancellations and payment-failure churns as
    'cancellation' events; if you need to separate them, filter by the activity's
    cancellation_type field once the API response is inspected.

    Returns:
        {
            "analysis_month": "YYYY-MM",
            "voluntary_churn": <int>,   # count of cancellation events
        }
    """
    year, month = map(int, analysis_month.split("-"))
    start = f"{year}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1}-01-01"
    else:
        end = f"{year}-{month + 1:02d}-01"

    # The activities endpoint uses cursor-based pagination (has_more + cursor),
    # not page numbers. Pass the cursor from each response as the next request's
    # cursor parameter until has_more is false.
    count = 0
    cursor = None
    while True:
        params = {
            "start-date": start,
            "end-date": end,
            "type": "churn",
            "per_page": 200,
        }
        if cursor:
            params["cursor"] = cursor

        data = _get(api_key, "/activities", params)
        count += len(data.get("entries", []))

        if not data.get("has_more", False):
            break
        cursor = data.get("cursor")
        if not cursor:
            break

    return {"analysis_month": analysis_month, "voluntary_churn": count}


def fetch_churn_actuals_bulk(api_key: str, months: list) -> list:
    """
    Fetch churn actuals for a list of YYYY-MM strings.
    Returns a list of dicts: [{analysis_month, voluntary_churn}, ...]
    """
    results = []
    for m in months:
        try:
            results.append(fetch_churn_actuals_for_month(api_key, m))
        except Exception:
            pass  # skip months that fail; don't abort the whole bulk
    return results
