const fmt = (val, decimals = 0) => {
  if (val === null || val === undefined) return '—'
  const n = Number(val)
  if (isNaN(n)) return String(val)
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const fmtRate = (val) => {
  if (val === null || val === undefined) return '—'
  return `${(Number(val) * 100).toFixed(4)}%`
}

function Step({ number, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 flex flex-col items-center">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold">
          {number}
        </div>
        <div className="w-px flex-1 bg-gray-200 mt-2" />
      </div>
      <div className="pb-8 flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
        <div className="text-sm text-gray-600 leading-relaxed space-y-1">
          {children}
        </div>
      </div>
    </div>
  )
}

function Pill({ label, value, color = 'indigo' }) {
  const colours = {
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    green: 'bg-green-50 text-green-800 border-green-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${colours[color]}`}>
      <span className="text-gray-500">{label}:</span> {value}
    </span>
  )
}

export default function Walkthrough({ prediction, inputs }) {
  if (!prediction || !inputs) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-4xl mb-3">📖</p>
        <p className="text-sm">Run a prediction first to see the calculation walkthrough.</p>
      </div>
    )
  }

  const p = prediction
  const isLive = p.calibration_mode === 'live'

  const rmFormula = isLive
    ? `${fmt(p.realized_involuntary_churn)} ÷ (${fmt(p.matured_monthly_pool)} + ${inputs.annual_risk_weight} × ${fmt(p.matured_annual_pool)})`
    : 'Fallback applied — realized involuntary churn or matured pool was zero'

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Calculation Walkthrough</h2>
        <p className="text-sm text-gray-500 mt-1">
          Step-by-step derivation of the forecast for{' '}
          <span className="font-medium text-gray-700">{p.analysis_month}</span>.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <Step number={1} title="Phase 1 — Renewal Pool">
          <p>
            Cohort data was used to compute the renewal pool for each subscription type —
            the number of subscribers whose billing date falls within {p.analysis_month}.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Pill label="Monthly pool" value={fmt(p.total_monthly_pool) + ' renewals'} color="indigo" />
            <Pill label="Annual pool" value={fmt(p.total_annual_pool) + ' renewals'} color="indigo" />
          </div>
          <p className="mt-2 text-gray-400 text-xs">
            Each cohort's survivors = cohort_size − cumulative_churn_at(T−1). Survivors are distributed
            across days of the analysis month using daily sales weights from the growth files.
            Cohorts older than 96 months are treated as fully churned.
          </p>
        </Step>

        <Step number={2} title="Phase 2 — Dunning Time-Shift (T-pivot)">
          <p>
            Dunning duration is <strong>{p.dunning_duration} days</strong>. Subtracting from current
            date <strong>{p.current_date}</strong> gives a pivot date of{' '}
            <strong>{p.t_pivot_date}</strong> (day {p.t_pivot_day} of the month).
          </p>
          <p className="mt-1">
            Renewals whose billing day falls <em>before or on</em> day {p.t_pivot_day} are considered
            matured — the dunning process has already run. The rest are still pending.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Pill label="Matured monthly" value={fmt(p.matured_monthly_pool)} color="green" />
            <Pill label="Matured annual" value={fmt(p.matured_annual_pool)} color="green" />
            <Pill label="Pending monthly" value={fmt(p.pending_monthly_pool)} color="amber" />
            <Pill label="Pending annual" value={fmt(p.pending_annual_pool)} color="amber" />
          </div>
        </Step>

        <Step number={3} title="Phase 3 — Dynamic Calibration (Rₘ)">
          <p>
            Realized involuntary churn = reported total churn − reported voluntary churn
          </p>
          <p className="mt-1 font-mono text-xs bg-gray-50 rounded px-3 py-2 text-gray-700">
            {fmt(p.reported_total_churn)} − {fmt(p.reported_voluntary_churn)} = {fmt(p.realized_involuntary_churn)}
          </p>
          <p className="mt-2">
            {isLive
              ? `Rₘ is solved from the matured pool:`
              : `Realized involuntary churn or matured pool was zero — using historical fallback Rₘ = 2%.`}
          </p>
          {isLive && (
            <p className="mt-1 font-mono text-xs bg-gray-50 rounded px-3 py-2 text-gray-700">
              Rₘ = {rmFormula} = {fmtRate(p.rm)}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <Pill
              label="Calibration"
              value={isLive ? 'Live' : 'Fallback 2%'}
              color={isLive ? 'green' : 'amber'}
            />
            <Pill label="Rₘ" value={fmtRate(p.rm)} color="indigo" />
            <Pill label="Annual failure rate" value={fmtRate(p.current_annual_failure_rate)} color="indigo" />
          </div>
        </Step>

        <Step number={4} title="Phase 4 — Forecast">
          <p>
            Future uncollectibles are estimated by applying the failure rates to the pending pools:
          </p>
          <p className="mt-1 font-mono text-xs bg-gray-50 rounded px-3 py-2 text-gray-700">
            ({fmt(p.pending_monthly_pool)} × {fmtRate(p.rm)}) + ({fmt(p.pending_annual_pool)} × {fmtRate(p.current_annual_failure_rate)})
            {' '}= {fmt(p.future_uncollectibles)}
          </p>
          <p className="mt-2">Total forecasted churn adds future uncollectibles to what's already been reported:</p>
          <p className="mt-1 font-mono text-xs bg-gray-50 rounded px-3 py-2 text-gray-700">
            {fmt(p.reported_total_churn)} + {fmt(p.future_uncollectibles)} = {fmt(p.total_forecasted_churn)}
          </p>
          <p className="mt-2">Final closing balance:</p>
          <p className="mt-1 font-mono text-xs bg-gray-50 rounded px-3 py-2 text-gray-700">
            {fmt(p.opening_balance)} (opening) + {fmt(p.total_sales)} (new sales) − {fmt(p.total_forecasted_churn)} (churn)
            {' '}= {fmt(p.final_closing_balance)}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Pill label="Churn rate" value={`${Number(p.churn_rate_pct).toFixed(2)}%`} color="red" />
            <Pill label="Closing balance" value={fmt(p.final_closing_balance)} color="green" />
          </div>
        </Step>
      </div>
    </div>
  )
}
