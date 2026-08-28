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

monthly_external_ids = []
annual_external_ids  = []

if monthly_env and annual_env:
    monthly_uuids = [x.strip() for x in monthly_env.split(",") if x.strip()]
    annual_uuids  = [x.strip() for x in annual_env.split(",")  if x.strip()]
else:
    print("Auto-detecting plan groups from ChartMogul...")
    groups = chartmogul_client.fetch_plan_groups(api_key)
    monthly_uuids        = groups["monthly"]
    annual_uuids         = groups["annual"]
    monthly_external_ids = groups["monthly_external_ids"]
    annual_external_ids  = groups["annual_external_ids"]

print(f"Monthly plans: {len(monthly_uuids)} UUIDs + {len(monthly_external_ids)} ext IDs")
print(f"Annual plans:  {len(annual_uuids)} UUIDs + {len(annual_external_ids)} ext IDs")

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
    print(f"Debug: plan-uuid={sample.get('plan-uuid')!r}  plan_uuid={sample.get('plan_uuid')!r}")
    print(f"Debug: customer-uuid={sample.get('customer-uuid')!r}  customer_uuid={sample.get('customer_uuid')!r}")
    act_uuid = sample.get('plan-uuid') or sample.get('plan_uuid') or ''
    act_ext  = sample.get('plan-external-id') or ''
    in_monthly = act_uuid in set(monthly_uuids) or act_ext in set(monthly_external_ids)
    in_annual  = act_uuid in set(annual_uuids)  or act_ext in set(annual_external_ids)
    print(f"Debug: plan-external-id={act_ext!r}")
    print(f"Debug: matches monthly={in_monthly}, annual={in_annual}")
    print(f"Debug: sample monthly ext ID: {monthly_external_ids[0] if monthly_external_ids else 'none'}")
else:
    print("Debug: NO entries returned — possible API issue or wrong type name")

monthly_df, annual_df = chartmogul_client.build_cohort_dataframes(
    api_key, monthly_uuids, annual_uuids, start_date, end_date,
    monthly_external_ids=monthly_external_ids,
    annual_external_ids=annual_external_ids,
)

print(f"Monthly cohorts: {len(monthly_df)} rows")
print(f"Annual cohorts:  {len(annual_df)} rows")

for file_type, df in [("monthly_cohorts", monthly_df), ("annual_cohorts", annual_df)]:
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    row_count = data_store.save_csv(file_type, csv_bytes)
    print(f"Saved {file_type}: {row_count} rows to Supabase")

data_store.save_meta("last_cohort_sync", datetime.utcnow().isoformat())
print("Done.")
