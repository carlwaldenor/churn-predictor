from pydantic import BaseModel


class MonthRow(BaseModel):
    date: str                        # "2025-01-31"
    new_subscriber_count: int
    reactivation_count: int
    churn_count: int                 # negative integer
    total_subscribers: int
    mrr: float


class PlanData(BaseModel):
    tier: str                        # "premium"
    plan: str                        # "monthly"
    row_type: str                    # "actuals" or "budget"
    price: float                     # derived: mrr / total_subscribers
    rows: list[MonthRow]


class YoyRate(BaseModel):
    year: int
    sales_growth: float | None = None   # fractional: 0.05 = +5%
    churn_growth: float | None = None   # fractional: -0.10 = -10%


class PriceChange(BaseModel):
    month: str                          # "2026-04-30" (last day of month)
    price: float


class PlanLevers(BaseModel):
    yoy_rates: list[YoyRate] = []
    price_changes: list[PriceChange] = []


class OneTimeEvent(BaseModel):
    month: str                       # "2026-06-30"
    subscriber_delta: int            # positive = win-back, negative = loss
    mrr_delta: float


class NewPlanConfig(BaseModel):
    tier: str                                    # e.g. "premium"
    plan: str                                    # "monthly" | "quarterly" | "annual"
    price: float                                 # full price per period ($/mo or $/yr)
    launch_month: str                            # "YYYY-MM" — first month to generate sales
    monthly_sales_schedule: list[float] = []     # 12 values (non-quarterly) or 15 (quarterly): new subs per month from launch
    churn_rate_schedule: list[float] = []        # same length; first 3 values are 0 for quarterly (Q1 lock-in period)
    yoy_rates: list[YoyRate] = []


class ScenarioConfig(BaseModel):
    id: str = ""
    name: str = "Base Case"
    horizon_months: int = 12
    plan_overrides: dict[str, PlanLevers] = {}  # key = "premium_monthly"
    new_plans: list[NewPlanConfig] = []
    one_time_events: list[OneTimeEvent] = []
    excluded_plans: list[str] = []              # keys of plans to skip, e.g. ["plus_annual"]
    created_at: str = ""
    updated_at: str = ""


class ForecastMonth(BaseModel):
    date: str
    subscribers: int
    mrr: float
    arr: float
    total_sales: int
    churned: int
    churn_rate: float


class PlanForecast(BaseModel):
    tier: str
    plan: str
    months: list[ForecastMonth]


class ForecastResult(BaseModel):
    scenario_id: str
    plans: list[PlanForecast]
    totals: list[ForecastMonth]      # summed across all plans
