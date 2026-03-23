# Churn Predictor

A full-stack web application for forecasting monthly subscription churn using a 4-phase renewal pool engine.

## Architecture

```
churn-predictor/
  backend/     FastAPI (Python) — prediction engine + CSV persistence
  frontend/    React + Vite + Tailwind CSS — upload, inputs, results, walkthrough
  data/        Uploaded CSV files (persisted, excluded from git)
```

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 18+ / npm

---

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`

---

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

The Vite dev server proxies `/api/*` requests to `http://localhost:8000`, so no CORS issues during development.

---

## CSV File Schemas

### `monthly_cohorts.csv` / `annual_cohorts.csv`

| Column | Type | Description |
|--------|------|-------------|
| `signup_month` | `YYYY-MM` | Month the cohort signed up |
| `cohort_size` | integer | Initial subscriber count for the cohort |
| `t1`, `t2`, … `t96` | integer | Cumulative churn at each month age (T=1 means after 1 month) |

Missing T columns are treated as 0. Cohorts older than 96 months are ignored (treated as fully churned).

**Example:**
```csv
signup_month,cohort_size,t1,t2,t3,t4,t5,t6
2024-01,500,25,45,60,72,81,88
2024-02,480,22,40,55,66,74,81
```

### `daily_growth_monthly.csv` / `daily_growth_annual.csv`

| Column | Type | Description |
|--------|------|-------------|
| `date` | `YYYY-MM-DD` | Date of the sales event |
| `new_subscriber_count` | integer | New subscribers acquired that day |
| `reactivation_count` | integer | Reactivated subscribers that day |

**Example:**
```csv
date,new_subscriber_count,reactivation_count
2024-01-01,18,3
2024-01-02,24,5
2024-01-03,15,2
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload-csv` | Upload a CSV file (form: `file_type`, `file`) |
| `GET` | `/api/csv-status` | Returns upload status + row counts for all 4 files |
| `POST` | `/api/predict` | Run prediction (JSON body with runtime params) |

### POST `/api/predict` body

```json
{
  "analysis_month": "2025-02",
  "current_date": "2025-02-15",
  "dunning_duration": 30,
  "reported_total_churn": 250,
  "reported_voluntary_churn": 80,
  "annual_risk_weight": 2.0,
  "opening_balance": 10000
}
```

---

## Prediction Engine

The engine runs 4 phases:

1. **Renewal Pool** — For each cohort, compute surviving subscribers at renewal age T, then distribute them across days of the analysis month using daily sales weights.
2. **Dunning Time-Shift** — Split the renewal pool into *matured* (dunning already ran) and *pending* (dunning still in progress) using `current_date − dunning_duration` as the pivot.
3. **Dynamic Calibration** — Solve for the monthly failure rate Rₘ from realized involuntary churn and the matured pool. Falls back to 2% if no signal.
4. **Forecast** — Apply Rₘ to the pending pool to estimate future uncollectibles, then compute total forecasted churn and predicted closing balance.

---

## Deployment

### Backend — Railway or Render

1. Push to GitHub.
2. Create a new service pointing at the `backend/` directory.
3. Set start command: `uvicorn main:app --host 0.0.0.0 --port 8000`
4. Mount a persistent disk at `/app/data` (or set `DATA_DIR` env var) so uploaded CSVs survive redeploys.

### Frontend — Vercel

1. Set root directory to `frontend/`.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set environment variable `VITE_API_URL` if your backend is not at `/api` (update `vite.config.js` proxy accordingly).

> For production, update the Vite proxy target or replace `/api` calls with the full backend URL using an env variable.
