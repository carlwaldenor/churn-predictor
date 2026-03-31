"""
Churn Prediction Engine — 4-phase model
"""
import calendar
import re
from datetime import date, datetime as _dt, timedelta
from typing import Optional
import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_cohort_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalise cohort DataFrame column names so the engine can find them
    regardless of how the CSV was exported:
      - Renames an unnamed first column (e.g. "Unnamed: 0") → "signup_month"
      - Strips whitespace, lowercases, replaces spaces with underscores
        so "Cohort value" → "cohort_value", matching the alias list.
      - Numeric age columns ("0", "1", …) are left unchanged.
    """
    df = df.copy()
    if str(df.columns[0]).startswith("Unnamed") or str(df.columns[0]).strip() == "":
        df = df.rename(columns={df.columns[0]: "signup_month"})
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    return df


def _parse_ym(val: str) -> str:
    """
    Parse a signup_month value to canonical "YYYY-MM" string.
    Handles: "2018-06", "2018-06-01", "Jun 2018", "June 2018".
    Returns the original string if no format matches (will fail downstream).
    """
    val = val.strip()
    if re.match(r"^\d{4}-\d{2}$", val):
        return val
    if re.match(r"^\d{4}-\d{2}-\d{2}$", val):
        return val[:7]
    for fmt in ("%b %Y", "%B %Y", "%m/%Y", "%Y/%m"):
        try:
            d = _dt.strptime(val, fmt)
            return f"{d.year:04d}-{d.month:02d}"
        except ValueError:
            continue
    return val


def _clean_df(df: pd.DataFrame) -> pd.DataFrame:
    """Replace non-numeric sentinel values with 0 across the whole DataFrame."""
    df = df.replace({"—": 0, "nan": 0, "": 0, "-": 0})
    return df


def _months_elapsed(signup_ym: str, analysis_ym: str) -> int:
    """Return integer months between signup_ym and analysis_ym (both YYYY-MM)."""
    sy, sm = map(int, signup_ym.split("-"))
    ay, am = map(int, analysis_ym.split("-"))
    return (ay - sy) * 12 + (am - sm)


def _get_daily_weights(growth_df: Optional[pd.DataFrame], month_str: str, n_days: int) -> list[float]:
    """
    Return a list of n_days weight values (summing to 1.0) derived from
    daily total_sales in growth_df for the given month_str (YYYY-MM).
    Falls back to uniform weights if data is missing.
    """
    uniform = [1.0 / n_days] * n_days

    if growth_df is None or growth_df.empty:
        return uniform

    # Ensure date column exists
    date_col = None
    for c in growth_df.columns:
        if "date" in c.lower():
            date_col = c
            break
    if date_col is None:
        return uniform

    # Filter to the target month
    mask = growth_df[date_col].astype(str).str.startswith(month_str)
    month_data = growth_df[mask].copy()
    if month_data.empty:
        return uniform

    # Compute total_sales
    new_col = _find_col(month_data, ["new_subscriber_count", "new_subscribers", "new"])
    react_col = _find_col(month_data, ["reactivation_count", "reactivations", "reactivation"])

    new_vals = month_data[new_col].fillna(0) if new_col else pd.Series(0, index=month_data.index)
    react_vals = month_data[react_col].fillna(0) if react_col else pd.Series(0, index=month_data.index)
    month_data = month_data.copy()
    month_data["_total_sales"] = pd.to_numeric(new_vals, errors="coerce").fillna(0) + \
                                  pd.to_numeric(react_vals, errors="coerce").fillna(0)

    # Build day-indexed weights array
    weights = [0.0] * n_days
    for _, row in month_data.iterrows():
        try:
            day = int(str(row[date_col]).split("-")[2]) - 1  # 0-indexed
            if 0 <= day < n_days:
                weights[day] += float(row["_total_sales"])
        except (ValueError, IndexError):
            continue

    total = sum(weights)
    if total <= 0:
        return uniform
    return [w / total for w in weights]


def _find_col(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
    """Return the first column name from candidates that exists in df (case-insensitive)."""
    lower_map = {c.lower(): c for c in df.columns}
    for candidate in candidates:
        if candidate.lower() in lower_map:
            return lower_map[candidate.lower()]
    return None


def _get_cumulative_churn(row: pd.Series, t: int) -> float:
    """Return cumulative churn at age t months from a cohort row.
    Tries "tN" format first (e.g. "t11"), then plain numeric string "N" (e.g. "11")
    to support CSVs that export columns as bare numbers.
    """
    if t <= 0:
        return 0.0
    for col in (f"t{t}", str(t)):
        if col in row.index:
            try:
                return float(row[col])
            except (ValueError, TypeError):
                return 0.0
    return 0.0


def _get_daily_sales(
    growth_monthly: Optional[pd.DataFrame],
    growth_annual: Optional[pd.DataFrame],
    date_str: str,
) -> float:
    """Sum new_subscriber_count + reactivation_count for a specific ISO date."""
    total = 0.0
    for df in [growth_monthly, growth_annual]:
        if df is None or df.empty:
            continue
        date_col = _find_col(df, ["date"])
        new_col = _find_col(df, ["new_subscriber_count", "new_subscribers", "new"])
        react_col = _find_col(df, ["reactivation_count", "reactivations", "reactivation"])
        if date_col is None:
            continue
        rows = df[df[date_col].astype(str) == date_str]
        if rows.empty:
            continue
        n = pd.to_numeric(rows[new_col], errors="coerce").fillna(0).sum() if new_col else 0
        r = pd.to_numeric(rows[react_col], errors="coerce").fillna(0).sum() if react_col else 0
        total += float(n + r)
    return total


def _get_daily_csv_churn(
    growth_monthly: Optional[pd.DataFrame],
    growth_annual: Optional[pd.DataFrame],
    date_str: str,
) -> float:
    """Sum churn_count for a specific ISO date from both growth DataFrames."""
    total = 0.0
    for df in [growth_monthly, growth_annual]:
        if df is None or df.empty:
            continue
        date_col = _find_col(df, ["date"])
        churn_col = _find_col(df, ["churn_count", "churn"])
        if date_col is None or churn_col is None:
            continue
        mask = df[date_col].astype(str) == date_str
        rows = df[mask]
        if not rows.empty:
            total += float(pd.to_numeric(rows[churn_col], errors="coerce").fillna(0).sum())
    # ChartMogul exports churn_count as negative values; normalise to positive
    return abs(total)


def _build_daily_churn_series(
    monthly_pool: list[float],
    annual_pool: list[float],
    dfs: dict,
    annual_risk_weight: float,
    Rm: float,
    t_pivot_date: date,
    current_date: date,
    analysis_month: str,
    reported_voluntary_churn: float,
    reported_total_churn: float,
    matured_pool_weight: float,
    future_uncollectibles: float,
) -> list[dict]:
    """Build the per-day churn series for the analysis month.

    Uses two independent pivots:

      Voluntary pivot (chart_cutoff = min(current_date, month-end)):
        Days ≤ chart_cutoff have known voluntary churn (is_actual = True).
        Scaled from CSV shape or pool weight to sum to reported_voluntary_churn.
        Future days use a rate-based estimate (not counted in cumulative).

      Involuntary pivot (t_pivot_date = current_date − dunning_duration):
        Days ≤ t_pivot_date: dunning has resolved → distribute
          realized_involuntary_churn by pool-weight share (involuntary_is_actual).
        Days > t_pivot_date: still in dunning → distribute
          future_uncollectibles by pool-weight share (projected involuntary).

    Cumulative reaches total_forecasted_churn at month-end:
      actual voluntary days contribute daily_voluntary;
      all days contribute daily_involuntary (realized + projected).
    """
    ay, am = map(int, analysis_month.split("-"))
    days_in_month = calendar.monthrange(ay, am)[1]
    last_day_of_month = date(ay, am, days_in_month)

    # Voluntary churn is known for all days up to today (capped at month-end)
    chart_cutoff = min(current_date, last_day_of_month)

    # Pool weight per day
    pool_weights = [
        (monthly_pool[i] if i < len(monthly_pool) else 0.0)
        + (annual_pool[i] if i < len(annual_pool) else 0.0) * annual_risk_weight
        for i in range(days_in_month)
    ]
    total_pool_weight = sum(pool_weights)

    # Pending pool weight: days whose dunning window has not yet closed
    pending_pool_weight = sum(
        pool_weights[i]
        for i in range(days_in_month)
        if date(ay, am, i + 1) > t_pivot_date
    )

    # Realized involuntary churn (may be 0 when fallback is active)
    realized_involuntary_churn = reported_total_churn - reported_voluntary_churn

    # Voluntary rate per unit of pool weight (for future projected days)
    voluntary_rate = (
        reported_voluntary_churn / matured_pool_weight
        if matured_pool_weight > 0 else 0.0
    )

    # ------------------------------------------------------------------
    # Pass 1: gather raw values for every day
    # ------------------------------------------------------------------
    raw = []
    for day_idx in range(days_in_month):
        day_num = day_idx + 1
        date_obj = date(ay, am, day_num)
        date_str = date_obj.isoformat()

        is_actual = date_obj <= chart_cutoff              # voluntary is known
        involuntary_is_actual = date_obj <= t_pivot_date  # dunning has resolved

        weight_share = (
            pool_weights[day_idx] / total_pool_weight
            if total_pool_weight > 0
            else 1.0 / days_in_month
        )

        # CSV shape signal (used as voluntary shape for actual days)
        csv_val = _get_daily_csv_churn(
            dfs.get("daily_growth_monthly"),
            dfs.get("daily_growth_annual"),
            date_str,
        )
        # For projected voluntary days: use CSV if available, else rate-based
        projected_voluntary = (
            csv_val if (not is_actual and csv_val > 0)
            else voluntary_rate * pool_weights[day_idx]
        )

        raw.append({
            "date_str": date_str,
            "is_actual": is_actual,
            "involuntary_is_actual": involuntary_is_actual,
            "raw_value": csv_val,               # shape signal for actual-day scaling
            "projected_voluntary": projected_voluntary,
            "pool_weight": pool_weights[day_idx],
            "weight_share": weight_share,
        })

    # ------------------------------------------------------------------
    # Scale factors for voluntary distribution across actual days
    # ------------------------------------------------------------------
    actual_csv_sum  = sum(r["raw_value"] for r in raw if r["is_actual"])
    actual_pool_sum = sum(r["pool_weight"] for r in raw if r["is_actual"])
    n_actual        = sum(1 for r in raw if r["is_actual"])

    # ------------------------------------------------------------------
    # Pass 2: compute final daily values and running cumulative
    # ------------------------------------------------------------------
    series = []
    cumulative = 0.0

    for r in raw:
        # --- Voluntary ---
        if r["is_actual"]:
            if actual_csv_sum > 0:
                daily_voluntary = r["raw_value"] / actual_csv_sum * reported_voluntary_churn
            elif actual_pool_sum > 0:
                daily_voluntary = r["pool_weight"] / actual_pool_sum * reported_voluntary_churn
            else:
                daily_voluntary = reported_voluntary_churn / n_actual if n_actual else 0.0
        else:
            daily_voluntary = r["projected_voluntary"]

        # --- Involuntary (independent of voluntary pivot) ---
        if r["involuntary_is_actual"]:
            # Dunning resolved: distribute realized involuntary by pool-weight share
            daily_involuntary = (
                r["pool_weight"] / matured_pool_weight * realized_involuntary_churn
                if matured_pool_weight > 0 else 0.0
            )
        else:
            # Still in dunning: distribute future_uncollectibles by pool-weight share
            daily_involuntary = (
                r["pool_weight"] / pending_pool_weight * future_uncollectibles
                if pending_pool_weight > 0 else 0.0
            )

        daily_total = daily_voluntary + daily_involuntary

        # Cumulative reaches total_forecasted_churn at month-end:
        #   actual voluntary days → include daily_voluntary
        #   all days              → include daily_involuntary
        #   projected voluntary   → excluded (not model-predicted)
        cumulative += daily_total if r["is_actual"] else daily_involuntary

        series.append({
            "date": r["date_str"],
            "daily_involuntary": round(daily_involuntary, 2),
            "daily_voluntary": round(daily_voluntary, 2),
            "daily_total": round(daily_total, 2),
            "cumulative_total": round(cumulative, 2),
            "is_actual": r["is_actual"],
            "involuntary_is_actual": r["involuntary_is_actual"],
        })

    return series



# ---------------------------------------------------------------------------
# Phase 1 — Renewal Pool Engine
# ---------------------------------------------------------------------------

def _build_renewal_pool(
    cohorts_df: Optional[pd.DataFrame],
    growth_df: Optional[pd.DataFrame],
    analysis_month: str,
    max_age: int = 96,
    annual: bool = False,
) -> list[float]:
    """
    Build a per-day renewal pool for analysis_month.
    Returns a list of length = days_in_month.

    When annual=True only cohorts whose signup calendar month matches the
    analysis calendar month are included — annual subscriptions renew once
    per year in the same month they were originally signed up.
    """
    ay, am = map(int, analysis_month.split("-"))
    days_in_month = calendar.monthrange(ay, am)[1]
    pool = [0.0] * days_in_month

    if cohorts_df is None or cohorts_df.empty:
        return pool

    cohorts_df = _normalize_cohort_df(cohorts_df)
    cohorts_df = _clean_df(cohorts_df)

    # Find signup_month column
    signup_col = _find_col(cohorts_df, ["signup_month", "signup", "month", "cohort_month"])
    size_col = _find_col(cohorts_df, ["cohort_size", "cohort_value", "size", "subscribers", "count"])

    if signup_col is None or size_col is None:
        return pool

    for _, row in cohorts_df.iterrows():
        signup_ym = _parse_ym(str(row[signup_col]))
        # Must be strictly before analysis_month
        if signup_ym >= analysis_month:
            continue

        # Annual cohorts: only include cohorts whose signup calendar month
        # matches the analysis calendar month (they renew once a year)
        if annual:
            signup_month_num = int(signup_ym.split("-")[1])
            if signup_month_num != am:
                continue

        T = _months_elapsed(signup_ym, analysis_month)
        if T <= 0 or T > max_age:
            continue

        try:
            cohort_size = float(row[size_col])
        except (ValueError, TypeError):
            continue

        cum_churn = _get_cumulative_churn(row, T - 1)
        survivors = max(0.0, cohort_size - cum_churn)
        if survivors == 0:
            continue

        weights = _get_daily_weights(growth_df, signup_ym, days_in_month)
        for day_idx, w in enumerate(weights):
            pool[day_idx] += survivors * w

    return pool


# ---------------------------------------------------------------------------
# Phase 2 — Dunning Time-Shift
# ---------------------------------------------------------------------------

def _dunning_split(pool: list[float], current_date: date, dunning_duration: int) -> tuple[float, float]:
    """
    Returns (matured, pending) sums from pool.
    T_pivot = current_date - dunning_duration days.
    Days at index < t_pivot_day are matured; rest are pending.
    """
    t_pivot_date = current_date - timedelta(days=dunning_duration)
    t_pivot_day = t_pivot_date.day  # 1-based day of month

    matured = sum(pool[d] for d in range(min(t_pivot_day, len(pool))))
    pending = sum(pool[d] for d in range(t_pivot_day, len(pool)))
    return matured, pending


# ---------------------------------------------------------------------------
# Main prediction entry point
# ---------------------------------------------------------------------------

def run_prediction(dfs: dict, params: dict) -> dict:
    """
    dfs: {
        "monthly_cohorts": DataFrame | None,
        "annual_cohorts": DataFrame | None,
        "daily_growth_monthly": DataFrame | None,
        "daily_growth_annual": DataFrame | None,
    }
    params: {
        "analysis_month": "YYYY-MM",
        "current_date": date,
        "dunning_duration": int,
        "reported_total_churn": float,
        "reported_voluntary_churn": float,
        "annual_risk_weight": float,
        "opening_balance": float,
        "new_sales": float,
    }
    """
    analysis_month: str = params["analysis_month"]
    current_date: date = params["current_date"]
    dunning_duration: int = int(params["dunning_duration"])
    reported_total_churn: float = float(params["reported_total_churn"])
    reported_voluntary_churn: float = float(params["reported_voluntary_churn"])
    annual_risk_weight: float = float(params["annual_risk_weight"])
    opening_balance: float = float(params["opening_balance"])
    new_sales: float = float(params.get("new_sales", 0.0))

    ay, am = map(int, analysis_month.split("-"))

    # -----------------------------------------------------------------------
    # Phase 1 — Build renewal pools
    # -----------------------------------------------------------------------
    monthly_pool = _build_renewal_pool(
        dfs.get("monthly_cohorts"),
        dfs.get("daily_growth_monthly"),
        analysis_month,
    )
    annual_pool = _build_renewal_pool(
        dfs.get("annual_cohorts"),
        dfs.get("daily_growth_annual"),
        analysis_month,
        annual=True,
    )

    total_monthly_pool = sum(monthly_pool)
    total_annual_pool = sum(annual_pool)

    # -----------------------------------------------------------------------
    # Phase 2 — Dunning time-shift
    # -----------------------------------------------------------------------
    matured_monthly, pending_monthly = _dunning_split(monthly_pool, current_date, dunning_duration)
    matured_annual, pending_annual = _dunning_split(annual_pool, current_date, dunning_duration)

    t_pivot_date = current_date - timedelta(days=dunning_duration)
    t_pivot_day = t_pivot_date.day

    # -----------------------------------------------------------------------
    # Phase 3 — Dynamic calibration
    # -----------------------------------------------------------------------
    realized_involuntary_churn = reported_total_churn - reported_voluntary_churn
    denom = matured_monthly + annual_risk_weight * matured_annual

    if realized_involuntary_churn <= 0 or denom <= 0:
        Rm = 0.02
        calibration_mode = "fallback_2pct"
    else:
        Rm = realized_involuntary_churn / denom
        calibration_mode = "live"

    current_monthly_failure_rate = Rm
    current_annual_failure_rate = Rm * annual_risk_weight

    # -----------------------------------------------------------------------
    # Phase 4 — Forecast
    # -----------------------------------------------------------------------
    future_uncollectibles = (pending_monthly * Rm) + (pending_annual * Rm * annual_risk_weight)

    # denom = matured_monthly + annual_risk_weight * matured_annual (already computed above)
    daily_churn_series = _build_daily_churn_series(
        monthly_pool,
        annual_pool,
        dfs,
        annual_risk_weight,
        Rm,
        t_pivot_date,
        current_date,
        analysis_month,
        reported_voluntary_churn,
        reported_total_churn,
        matured_pool_weight=denom,
        future_uncollectibles=future_uncollectibles,
    )

    total_forecasted_churn = reported_total_churn + future_uncollectibles

    # Total sales comes directly from user input (avoids double-counting
    # plan-filtered CSVs that don't sum to the ChartMogul unfiltered total)
    total_sales = new_sales

    final_closing_balance = opening_balance + total_sales - total_forecasted_churn
    churn_rate_pct = (total_forecasted_churn / opening_balance * 100) if opening_balance else 0.0

    return {
        # Pool totals
        "total_monthly_pool": round(total_monthly_pool, 2),
        "total_annual_pool": round(total_annual_pool, 2),
        # Dunning split
        "t_pivot_date": t_pivot_date.isoformat(),
        "t_pivot_day": t_pivot_day,
        "matured_monthly_pool": round(matured_monthly, 2),
        "matured_annual_pool": round(matured_annual, 2),
        "pending_monthly_pool": round(pending_monthly, 2),
        "pending_annual_pool": round(pending_annual, 2),
        # Calibration
        "realized_involuntary_churn": round(realized_involuntary_churn, 2),
        "rm": round(Rm, 6),
        "current_monthly_failure_rate": round(current_monthly_failure_rate, 6),
        "current_annual_failure_rate": round(current_annual_failure_rate, 6),
        "calibration_mode": calibration_mode,
        # Forecast
        "future_uncollectibles": round(future_uncollectibles, 2),
        "total_sales": round(total_sales, 2),
        "total_forecasted_churn": round(total_forecasted_churn, 2),
        "churn_rate_pct": round(churn_rate_pct, 4),
        "final_closing_balance": round(final_closing_balance, 2),
        # Daily churn time-series
        "daily_churn_series": daily_churn_series,
        # Echo back inputs for walkthrough
        "analysis_month": analysis_month,
        "current_date": current_date.isoformat(),
        "dunning_duration": dunning_duration,
        "reported_total_churn": reported_total_churn,
        "reported_voluntary_churn": reported_voluntary_churn,
        "annual_risk_weight": annual_risk_weight,
        "opening_balance": opening_balance,
    }
