"""
Standalone script for the monthly cohort sync.
Runs directly in GitHub Actions — no HTTP timeout, no Render involved.
Requires env vars: CHARTMOGUL_API_KEY, SUPABASE_URL, SUPABASE_KEY
Optional:         CHARTMOGUL_MONTHLY_PLAN_IDS, CHARTMOGUL_ANNUAL_PLAN_IDS
"""
import os
import sys
from datetime import date, datetime

import chartmogul_client
import data_store

api_key = os.environ.get("CHARTMOGUL_API_KEY", "").strip()
if not api_key:
    print("ERROR: CHARTMOGUL_API_KEY is not set")
    sys.exit(1)

monthly_env = os.environ.get("CHARTMOGUL_MONTHLY_PLAN_IDS", "").strip()
annual_env  = os.environ.get("CHARTMOGUL_ANNUAL_PLAN_IDS",  "").strip()

if monthly_env and annual_env:
    monthly_uuids = [x.strip() for x in monthly_env.split(",") if x.strip()]
    annual_uuids  = [x.strip() for x in annual_env.split(",")  if x.strip()]
else:
    print("Auto-detecting plan groups from ChartMogul...")
    groups = chartmogul_client.fetch_plan_groups(api_key)
    monthly_uuids = groups["monthly"]
    annual_uuids  = groups["annual"]

print(f"Monthly plans: {len(monthly_uuids)}, Annual plans: {len(annual_uuids)}")

start_date = "2015-01-01"
end_date   = date.today().isoformat()
print(f"Fetching activities {start_date} → {end_date} (this may take several minutes)...")

# Quick sanity check: fetch one page of new_biz for a recent month
print("Debug: testing new_biz fetch for 2024-01...")
test = chartmogul_client._fetch_activities_all(api_key, "new_biz", "2024-01-01", "2024-02-01")
print(f"Debug: {len(test)} new_biz entries for 2024-01")
if test:
    sample = test[0]
    print(f"Debug: sample entry keys: {list(sample.keys())}")
    print(f"Debug: sample plan key: plan-uuid={sample.get('plan-uuid')}, plan_uuid={sample.get('plan_uuid')}")
    print(f"Debug: sample customer key: customer-uuid={sample.get('customer-uuid')}, customer_uuid={sample.get('customer_uuid')}")
else:
    print("Debug: NO entries returned — possible API issue or wrong type name")

monthly_df, annual_df = chartmogul_client.build_cohort_dataframes(
    api_key, monthly_uuids, annual_uuids, start_date, end_date
)

print(f"Monthly cohorts: {len(monthly_df)} rows")
print(f"Annual cohorts:  {len(annual_df)} rows")

for file_type, df in [("monthly_cohorts", monthly_df), ("annual_cohorts", annual_df)]:
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    row_count = data_store.save_csv(file_type, csv_bytes)
    print(f"Saved {file_type}: {row_count} rows to Supabase")

data_store.save_meta("last_cohort_sync", datetime.utcnow().isoformat())
print("Done.")
