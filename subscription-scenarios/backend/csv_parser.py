"""Parse uploaded CSV files into PlanData objects.

Filename convention: {tier}_{plan}_actuals.csv  or  {tier}_{plan}_budget.csv
Examples:
  premium_monthly_actuals.csv
  elite_annual_budget.csv

The plan segment can itself contain underscores (e.g. "semi_annual"), so we
split on the last two underscores: everything before the second-to-last is
the tier, the second-to-last token is the plan type, and the last token
(before .csv) is the row_type.

Actually simpler: split on "_" and treat the last token as row_type,
second-to-last as plan, everything before as tier.
"""

import io
import re
from typing import Optional

import pandas as pd

from schemas import MonthRow, PlanData


def parse_filename(filename: str) -> tuple[str, str, str]:
    """Return (tier, plan, row_type) from a filename like premium_monthly_actuals.csv."""
    stem = re.sub(r"\.csv$", "", filename.lower().strip())
    parts = stem.split("_")
    if len(parts) < 3:
        raise ValueError(
            f"Cannot parse filename '{filename}'. "
            "Expected format: {{tier}}_{{plan}}_actuals.csv or {{tier}}_{{plan}}_budget.csv"
        )
    row_type = parts[-1]
    if row_type not in ("actuals", "budget"):
        raise ValueError(f"Filename '{filename}': last segment must be 'actuals' or 'budget', got '{row_type}'")
    plan = parts[-2]
    tier = "_".join(parts[:-2])
    return tier, plan, row_type


def _derive_price(rows: list[MonthRow], plan: str = "") -> float:
    """Estimate current price from the most recent 3 months of data.

    Returns the full subscription price per period:
      - Monthly plans → $/month
      - Annual plans  → $/year  (monthly MRR equivalent × 12)

    Using recent rows avoids distortion from years-old lower pricing.
    """
    recent = [r for r in rows[-3:] if r.total_subscribers > 0 and r.mrr > 0]
    if not recent:
        recent = [r for r in rows if r.total_subscribers > 0 and r.mrr > 0]
    if not recent:
        return 0.0
    avg_monthly_equiv = sum(r.mrr / r.total_subscribers for r in recent) / len(recent)
    return avg_monthly_equiv * 12 if plan.lower() == "annual" else avg_monthly_equiv


def parse_csv(filename: str, content: bytes) -> PlanData:
    """Parse CSV bytes into a PlanData object."""
    tier, plan, row_type = parse_filename(filename)

    df = pd.read_csv(io.BytesIO(content))
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    required = {"date", "new_subscriber_count", "reactivation_count",
                "churn_count", "total_subscribers", "mrr"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"'{filename}' is missing columns: {missing}")

    # Drop rows with empty/NaN date (trailing garbage rows common in exports)
    df = df[df["date"].notna() & (df["date"].astype(str).str.strip() != "")].copy()

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df[df["date"].notna()].copy()
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    df = df.sort_values("date").reset_index(drop=True)

    # Drop rows where all numeric columns are NaN
    numeric_cols = ["new_subscriber_count", "reactivation_count", "churn_count", "total_subscribers", "mrr"]
    df = df.dropna(subset=numeric_cols, how="all").reset_index(drop=True)

    rows = []
    for _, row in df.iterrows():
        rows.append(MonthRow(
            date=str(row["date"]),
            new_subscriber_count=int(pd.to_numeric(row["new_subscriber_count"], errors="coerce") or 0),
            reactivation_count=int(pd.to_numeric(row["reactivation_count"], errors="coerce") or 0),
            churn_count=int(pd.to_numeric(row["churn_count"], errors="coerce") or 0),
            total_subscribers=int(pd.to_numeric(row["total_subscribers"], errors="coerce") or 0),
            mrr=float(pd.to_numeric(row["mrr"], errors="coerce") or 0.0),
        ))

    price = _derive_price(rows, plan)
    return PlanData(tier=tier, plan=plan, row_type=row_type, price=price, rows=rows)
