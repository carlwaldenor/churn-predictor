"""
ChartMogul API client — read-only, v1.

Fetches the three files that can be automated:
  - daily_growth_monthly   (MRR movements filtered to monthly plans)
  - daily_growth_annual    (MRR movements filtered to annual plans)
  - historical_churn       (monthly customer churn rate)

Cohort files still require a manual CSV upload from ChartMogul's UI.
"""

import time
from typing import Optional

import pandas as pd
import requests

_BASE = "https://api.chartmogul.com/v1"
_TIMEOUT = 30  # seconds per request
_RETRY_DELAYS = [10, 30, 90]  # seconds between retries on 5xx


# ---------------------------------------------------------------------------
# Low-level HTTP helper
# ---------------------------------------------------------------------------

def _get(api_key: str, path: str, params: Optional[dict] = None) -> dict:
    """Authenticated GET against the ChartMogul v1 API, with retry on 5xx."""
    url = f"{_BASE}{path}"
    last_exc: Exception = RuntimeError("no attempts made")
    for attempt, delay in enumerate([0] + _RETRY_DELAYS):
        if delay:
            print(f"ChartMogul 5xx — retrying in {delay}s (attempt {attempt + 1}/{len(_RETRY_DELAYS) + 1})...")
            time.sleep(delay)
        resp = requests.get(url, auth=(api_key, ""), params=params or {}, timeout=_TIMEOUT)
        if resp.status_code < 500:
            break
        body = ""
        try:
            body = resp.json().get("message") or resp.text
        except Exception:
            body = resp.text
        last_exc = RuntimeError(f"ChartMogul API error {resp.status_code}: {body}")
    else:
        raise last_exc
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
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
    Return plan UUIDs and external IDs grouped as 'monthly' and 'annual'.

    Monthly  : interval_unit='month', interval_count=1
    Annual   : interval_unit='year'  OR  interval_unit='month', interval_count=12

    Activities expose 'plan-external-id' (not 'plan-uuid'), so both sets
    are returned so callers can match on whichever field is available.
    """
    monthly_uuids: list[str] = []
    annual_uuids: list[str] = []
    monthly_ext: list[str] = []
    annual_ext: list[str] = []

    page = 1
    while True:
        data = _get(api_key, "/plans", {"page": page, "per_page": 200})
        for plan in data.get("plans", []):
            uuid = plan.get("uuid")
            if not uuid:
                continue
            ext_id = plan.get("external_id") or ""
            unit = plan.get("interval_unit", "")
            count = int(plan.get("interval_count") or 1)
            if unit == "month" and count == 1:
                monthly_uuids.append(uuid)
                if ext_id:
                    monthly_ext.append(ext_id)
            elif unit == "year" or (unit == "month" and count == 12):
                annual_uuids.append(uuid)
                if ext_id:
                    annual_ext.append(ext_id)
        if page >= int(data.get("total_pages") or 1):
            break
        page += 1

    return {
        "monthly": monthly_uuids,
        "annual": annual_uuids,
        "monthly_external_ids": monthly_ext,
        "annual_external_ids": annual_ext,
    }


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
    monthly_external_ids: list = None,
    annual_external_ids: list = None,
) -> tuple:
    """
    Reconstruct monthly_cohorts and annual_cohorts DataFrames from ChartMogul
    activities. Returns (monthly_df, annual_df).

    Each subscription period — whether it starts as new_biz or reactivation —
    is treated as a separate cohort entry. This correctly captures reactivated
    customers as renewal risks in the month they resubscribed.

    A churn is matched to the most recent period start (new_biz or reactivation)
    before that churn date for the same customer, so churns are attributed to the
    right cohort even when a customer has subscribed multiple times.

    Output columns: signup_month, cohort_value, 0, 1, 2, ..., N
    where each numbered column is cumulative churned subscribers at that age.
    """
    monthly_set = set(monthly_uuids)
    annual_set = set(annual_uuids)
    monthly_ext_set = set(monthly_external_ids or [])
    annual_ext_set = set(annual_external_ids or [])

    def _classify_plan(entry: dict) -> str:
        """Return 'monthly', 'annual', or 'unknown' for an activity entry."""
        pu = _plan_uuid(entry)
        pe = entry.get("plan-external-id") or entry.get("plan_external_id") or ""
        if pu in monthly_set or pe in monthly_ext_set:
            return "monthly"
        if pu in annual_set or pe in annual_ext_set:
            return "annual"
        return "unknown"

    # 1. Collect all period-start events (new_biz + reactivation), sorted by date
    starts = sorted(
        _fetch_activities_all(api_key, "new_biz", start_date, end_date) +
        _fetch_activities_all(api_key, "reactivation", start_date, end_date),
        key=lambda e: e.get("date", ""),
    )

    # periods: uuid → list of {start_month, plan_type}, sorted asc by start_month
    periods: dict = {}
    for entry in starts:
        uuid = _customer_uuid(entry)
        month = _to_month(entry.get("date", ""))
        if not uuid or not month:
            continue
        plan_type = _classify_plan(entry)
        periods.setdefault(uuid, []).append({"start_month": month, "plan_type": plan_type})

    # 2. Initialise cohort size counts — one entry per subscription period
    monthly_cohorts: dict = {}  # start_month → {size, churns: {age: count}}
    annual_cohorts: dict = {}
    for plist in periods.values():
        for p in plist:
            target = (monthly_cohorts if p["plan_type"] == "monthly"
                      else annual_cohorts if p["plan_type"] == "annual" else None)
            if target is not None:
                target.setdefault(p["start_month"], {"size": 0, "churns": {}})["size"] += 1

    # 3. Assign each churn to the most recent period start before the churn date
    churn_entries = _fetch_activities_all(api_key, "churn", start_date, end_date)
    for entry in churn_entries:
        uuid = _customer_uuid(entry)
        churn_month = _to_month(entry.get("date", ""))
        if not uuid or not churn_month:
            continue
        plist = periods.get(uuid)
        if not plist:
            continue
        # Find the latest period that started on or before the churn month
        active = None
        for p in plist:
            if p["start_month"] <= churn_month:
                active = p
            else:
                break
        if not active:
            continue
        age = _months_diff(active["start_month"], churn_month)
        if age < 0 or age > 120:
            continue
        target = (monthly_cohorts if active["plan_type"] == "monthly"
                  else annual_cohorts if active["plan_type"] == "annual" else None)
        if target is None or active["start_month"] not in target:
            continue
        c = target[active["start_month"]]["churns"]
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


def fetch_month_defaults(api_key: str, analysis_month: str) -> dict:
    """
    Fetch all auto-fillable prediction inputs for a given month from ChartMogul.

    Returns:
        opening_balance       int   — active subscribers at start of the month
        reported_total_churn  int   — churn activity count for the month
        new_sales             int   — new_biz + reactivation activity count
    """
    year, month = map(int, analysis_month.split("-"))
    start = f"{year}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1}-01-01"
    else:
        end = f"{year}-{month + 1:02d}-01"

    # Opening balance: customer count at end of the previous month
    # (ChartMogul customer-count returns end-of-period count, so querying the
    # previous month gives us the subscriber count at the start of this month.)
    if month == 1:
        prev_start = f"{year - 1}-12-01"
    else:
        prev_start = f"{year}-{month - 1:02d}-01"
    customer_data = _get(api_key, "/metrics/customer-count", {
        "start-date": prev_start,
        "end-date": start,
        "interval": "month",
    })
    opening_balance = None
    entries = customer_data.get("entries", [])
    if entries:
        opening_balance = int(entries[-1].get("customers") or 0)

    # Total churn count for the month
    churn_result = fetch_churn_actuals_for_month(api_key, analysis_month)
    total_churn = churn_result["voluntary_churn"]

    # New sales: new_biz + reactivation activity counts
    new_biz = _fetch_activities_all(api_key, "new_biz", start, end)
    reactivations = _fetch_activities_all(api_key, "reactivation", start, end)
    new_sales = len(new_biz) + len(reactivations)

    return {
        "analysis_month": analysis_month,
        "opening_balance": opening_balance,
        "reported_total_churn": total_churn,
        "new_sales": new_sales,
    }


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
