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

    count = 0
    page = 1
    while True:
        data = _get(api_key, "/activities", {
            "start-date": start,
            "end-date": end,
            "type": "cancellation",
            "per_page": 200,
            "page": page,
        })
        entries = data.get("entries", [])
        count += len(entries)
        total_pages = int(data.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1

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
