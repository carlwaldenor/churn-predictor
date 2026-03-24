"""Pure forecast engine — no FastAPI dependencies, easy to unit test."""

import math
from datetime import date, timedelta

from schemas import (
    ForecastMonth,
    ForecastResult,
    MonthRow,
    NewPlanConfig,
    OneTimeEvent,
    PlanData,
    PlanForecast,
    PlanLevers,
    ScenarioConfig,
)


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _last_day_of_month(year: int, month: int) -> str:
    """Return the last day of month as YYYY-MM-DD."""
    if month == 12:
        next_first = date(year + 1, 1, 1)
    else:
        next_first = date(year, month + 1, 1)
    last = next_first - timedelta(days=1)
    return last.isoformat()


def _next_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _date_to_ym(date_str: str) -> tuple[int, int]:
    d = date.fromisoformat(date_str)
    return d.year, d.month


# ---------------------------------------------------------------------------
# Single-plan forecast
# ---------------------------------------------------------------------------

def _forecast_plan(
    plan_data: PlanData,
    levers: PlanLevers | None,
    one_time_events: list[OneTimeEvent],
    horizon_months: int,
) -> PlanForecast:
    is_annual = plan_data.plan.lower() == "annual"

    rows = sorted(plan_data.rows, key=lambda r: r.date)
    if not rows:
        raise ValueError(f"No rows for {plan_data.tier}_{plan_data.plan}")

    last = rows[-1]
    subs = last.total_subscribers
    # price = full subscription price per period ($/yr for annual, $/mo for monthly)
    price = plan_data.price or (last.mrr / subs * (12 if is_annual else 1) if subs else 0.0)

    # Build lookup by date for same-month-last-year access
    rows_by_date: dict[str, object] = {r.date: r for r in rows}

    # Fallback averages (used when no same-month-last-year data exists)
    n = len(rows)
    avg_churn_rate = (
        sum(abs(r.churn_count) / r.total_subscribers for r in rows if r.total_subscribers > 0) / n
        if n else 0.03
    )
    avg_total_sales = int(
        sum(r.new_subscriber_count + r.reactivation_count for r in rows) / n
    ) if n else 0

    # Lever lookups
    yoy_by_year: dict[int, object] = {}
    price_change_map: dict[str, float] = {}
    if levers:
        yoy_by_year = {y.year: y for y in levers.yoy_rates}
        price_change_map = {p.month: p.price for p in levers.price_changes}

    ote_by_month = {e.month: e for e in one_time_events}

    start_year, start_month = _date_to_ym(last.date)
    months: list[ForecastMonth] = []

    # Partial-year adjustment: if the last actual month is not December and a YoY
    # override exists for that year, distribute the remaining forecast months so the
    # full-year average hits prior_year_avg * (1 + yoy) exactly.  Locked actuals are
    # untouched; only the remaining forecast months are adjusted.
    partial_year_sales: float | None = None
    partial_year_churn: float | None = None

    if start_month < 12:
        yoy_partial = yoy_by_year.get(start_year)
        prior_rows = [r for r in rows if _date_to_ym(r.date)[0] == start_year - 1]
        n_prior = len(prior_rows)
        if yoy_partial is not None and n_prior > 0:
            prior_avg_sales = sum(
                r.new_subscriber_count + r.reactivation_count for r in prior_rows
            ) / n_prior
            prior_churn_rows = [r for r in prior_rows if r.total_subscribers > 0]
            prior_avg_churn = (
                sum(abs(r.churn_count) / r.total_subscribers for r in prior_churn_rows)
                / len(prior_churn_rows)
                if prior_churn_rows else avg_churn_rate
            )

            target_sales = prior_avg_sales * (1 + (yoy_partial.sales_growth or 0))
            target_churn = max(0.0, prior_avg_churn * (1 + (yoy_partial.churn_growth or 0)))

            actual_year_rows = [r for r in rows if _date_to_ym(r.date)[0] == start_year]
            n_actual = len(actual_year_rows)
            n_remaining = 12 - n_actual

            actual_sales_sum = sum(
                r.new_subscriber_count + r.reactivation_count for r in actual_year_rows
            )
            actual_churn_rows = [r for r in actual_year_rows if r.total_subscribers > 0]
            actual_churn_sum = sum(
                abs(r.churn_count) / r.total_subscribers for r in actual_churn_rows
            )

            if n_remaining > 0:
                partial_year_sales = max(
                    0.0, (12 * target_sales - actual_sales_sum) / n_remaining
                )
                partial_year_churn = max(
                    0.0, (12 * target_churn - actual_churn_sum) / n_remaining
                )

    year, month = start_year, start_month
    for _ in range(horizon_months):
        year, month = _next_month(year, month)
        month_str = _last_day_of_month(year, month)

        # Partial-year months: use the pre-computed adjusted targets
        if year == start_year and partial_year_sales is not None:
            base_total_sales = partial_year_sales
            base_churn_rate = partial_year_churn
        else:
            # Same month last year as baseline
            prev_year_date = _last_day_of_month(year - 1, month)
            prev_row = rows_by_date.get(prev_year_date)

            if prev_row and prev_row.total_subscribers > 0:
                base_total_sales = prev_row.new_subscriber_count + prev_row.reactivation_count
                base_churn_rate = abs(prev_row.churn_count) / prev_row.total_subscribers
            else:
                base_total_sales = avg_total_sales
                base_churn_rate = avg_churn_rate

            # Apply YoY growth rates for this year (not applied to partial year —
            # already baked into partial_year_sales / partial_year_churn above)
            yoy = yoy_by_year.get(year)
            if yoy:
                if yoy.sales_growth is not None:
                    base_total_sales = base_total_sales * (1 + yoy.sales_growth)
                if yoy.churn_growth is not None:
                    base_churn_rate = max(0.0, base_churn_rate * (1 + yoy.churn_growth))

        # Apply price changes effective this month
        if month_str in price_change_map:
            price = price_change_map[month_str]

        total_sales = max(0, round(base_total_sales))
        subs_start = subs  # capture before changes for accurate churn rate denominator
        churned = math.floor(subs_start * base_churn_rate)
        subs = max(0, subs_start + total_sales - churned)

        # Write synthetic row back so Year 2+ can look up Year 1's forecast
        # instead of falling back to the all-time historical average
        rows_by_date[month_str] = MonthRow(
            date=month_str,
            new_subscriber_count=total_sales,
            reactivation_count=0,
            churn_count=-churned,
            total_subscribers=subs_start,
            mrr=round(subs * price if not is_annual else subs * price / 12, 2),
        )

        # One-time events
        if month_str in ote_by_month:
            ote = ote_by_month[month_str]
            subs = max(0, subs + ote.subscriber_delta)

        mrr = subs * price if not is_annual else subs * price / 12
        arr = mrr * 12 if not is_annual else subs * price

        months.append(ForecastMonth(
            date=month_str,
            subscribers=subs,
            mrr=round(mrr, 2),
            arr=round(arr, 2),
            total_sales=total_sales,
            churned=churned,
            churn_rate=round(base_churn_rate, 6),
        ))

    return PlanForecast(tier=plan_data.tier, plan=plan_data.plan, months=months)


# ---------------------------------------------------------------------------
# New-plan forecast (no historical rows — starts from zero at launch_month)
# ---------------------------------------------------------------------------

def _forecast_new_plan(
    new_plan: NewPlanConfig,
    one_time_events: list[OneTimeEvent],
    horizon_months: int,
    forecast_start_ym: tuple[int, int],
) -> PlanForecast:
    plan_type = new_plan.plan.lower()
    is_annual = plan_type == "annual"
    is_quarterly = plan_type == "quarterly"
    price = new_plan.price
    launch_year = int(new_plan.launch_month[:4])
    launch_month_num = int(new_plan.launch_month[5:7])

    yoy_by_year = {y.year: y for y in new_plan.yoy_rates}
    ote_by_month = {e.month: e for e in one_time_events}

    sched_sales = new_plan.monthly_sales_schedule or [0.0]
    sched_churn = new_plan.churn_rate_schedule or [0.03]

    # Quarterly plans have a 15-month schedule (3 locked + 12 real);
    # all other plan types use a 12-month schedule.
    schedule_months = 15 if is_quarterly else 12

    subs = 0
    year, month = forecast_start_ym
    months: list[ForecastMonth] = []

    month_since_launch = -1   # incremented when launched, 0-indexed
    post_sales: float | None = None   # running base after schedule ends
    post_churn: float | None = None
    prev_applied_year: int | None = None

    for _ in range(horizon_months):
        year, month = _next_month(year, month)
        month_str = _last_day_of_month(year, month)

        launched = (year > launch_year) or (year == launch_year and month >= launch_month_num)
        if not launched:
            months.append(ForecastMonth(
                date=month_str, subscribers=0, mrr=0.0, arr=0.0,
                total_sales=0, churned=0, churn_rate=0.0,
            ))
            continue

        month_since_launch += 1

        if month_since_launch < schedule_months:
            # Within the input schedule: use values directly
            si = min(month_since_launch, len(sched_sales) - 1)
            ci = min(month_since_launch, len(sched_churn) - 1)
            sales = float(sched_sales[si])
            churn = float(sched_churn[ci])
        else:
            # Year 2+: initialize running base once from the schedule
            if post_sales is None:
                if is_quarterly and len(sched_sales) > 3:
                    # Base = average of months 4–15 (indices 3:) — excludes the
                    # zero-churn lock-in period so the base rate is realistic.
                    real_sales = [float(v) for v in sched_sales[3:]]
                    real_churn = [float(v) for v in sched_churn[3:]]
                    post_sales = sum(real_sales) / len(real_sales)
                    post_churn = sum(real_churn) / len(real_churn)
                else:
                    post_sales = float(sched_sales[-1])
                    post_churn = float(sched_churn[-1])

            # Apply YoY growth once per calendar year
            yoy = yoy_by_year.get(year)
            if yoy and prev_applied_year != year:
                if yoy.sales_growth is not None:
                    post_sales = post_sales * (1 + yoy.sales_growth)
                if yoy.churn_growth is not None:
                    post_churn = max(0.0, post_churn * (1 + yoy.churn_growth))
                prev_applied_year = year

            sales = post_sales
            churn = post_churn

        total_sales = max(0, round(sales))
        subs_start = subs
        churned = math.floor(subs_start * churn)
        subs = max(0, subs_start + total_sales - churned)

        if month_str in ote_by_month:
            subs = max(0, subs + ote_by_month[month_str].subscriber_delta)

        if is_annual:
            mrr = subs * price / 12
            arr = subs * price
        else:
            mrr = subs * price
            arr = mrr * 12

        months.append(ForecastMonth(
            date=month_str,
            subscribers=subs,
            mrr=round(mrr, 2),
            arr=round(arr, 2),
            total_sales=total_sales,
            churned=churned,
            churn_rate=round(churn, 6),
        ))

    return PlanForecast(tier=new_plan.tier, plan=new_plan.plan, months=months)


# ---------------------------------------------------------------------------
# Multi-plan forecast
# ---------------------------------------------------------------------------

def run_forecast(
    plans: list[PlanData],
    scenario: ScenarioConfig,
) -> ForecastResult:
    """Run the forecast for all plans and return aggregated ForecastResult."""
    actuals_plans = [p for p in plans if p.row_type == "actuals"]
    if not actuals_plans:
        actuals_plans = plans

    # Determine the common forecast start (last actual date across all plans)
    all_last_dates = [
        sorted(p.rows, key=lambda r: r.date)[-1].date
        for p in actuals_plans if p.rows
    ]
    if all_last_dates:
        forecast_start_ym = _date_to_ym(max(all_last_dates))
    else:
        today = date.today()
        forecast_start_ym = (today.year, today.month)

    excluded = set(scenario.excluded_plans or [])

    plan_forecasts: list[PlanForecast] = []
    for plan_data in actuals_plans:
        key = f"{plan_data.tier}_{plan_data.plan}"
        if key in excluded:
            continue
        levers = scenario.plan_overrides.get(key)
        pf = _forecast_plan(
            plan_data,
            levers,
            scenario.one_time_events,
            scenario.horizon_months,
        )
        plan_forecasts.append(pf)

    for new_plan in scenario.new_plans:
        if f"{new_plan.tier}_{new_plan.plan}" in excluded:
            continue
        pf = _forecast_new_plan(
            new_plan,
            scenario.one_time_events,
            scenario.horizon_months,
            forecast_start_ym,
        )
        plan_forecasts.append(pf)

    # Aggregate totals across all plans
    all_dates: list[str] = []
    seen: set[str] = set()
    for pf in plan_forecasts:
        for m in pf.months:
            if m.date not in seen:
                all_dates.append(m.date)
                seen.add(m.date)
    all_dates.sort()

    totals: list[ForecastMonth] = []
    for d in all_dates:
        t_subs = t_mrr = t_arr = t_sales = t_churned = 0
        for pf in plan_forecasts:
            row = next((m for m in pf.months if m.date == d), None)
            if row:
                t_subs += row.subscribers
                t_mrr += row.mrr
                t_arr += row.arr
                t_sales += row.total_sales
                t_churned += row.churned
        totals.append(ForecastMonth(
            date=d,
            subscribers=t_subs,
            mrr=round(t_mrr, 2),
            arr=round(t_arr, 2),
            total_sales=t_sales,
            churned=t_churned,
            churn_rate=round(t_churned / t_subs, 6) if t_subs else 0.0,
        ))

    return ForecastResult(
        scenario_id=scenario.id,
        plans=plan_forecasts,
        totals=totals,
    )
