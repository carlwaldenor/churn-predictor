import ChurnChart from './ChurnChart'

const fmt = (val, decimals = 0) => {
  if (val === null || val === undefined) return '—'
  const n = Number(val)
  if (isNaN(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const fmtPct = (val) => {
  if (val === null || val === undefined) return '—'
  return `${Number(val).toFixed(2)}%`
}

const fmtRate = (val) => {
  if (val === null || val === undefined) return '—'
  return `${(Number(val) * 100).toFixed(4)}%`
}

const BREAKDOWN_ROWS = [
  { key: 'matured_monthly_pool', label: 'Matured Monthly Pool', format: (v) => fmt(v) },
  { key: 'matured_annual_pool', label: 'Matured Annual Pool', format: (v) => fmt(v) },
  { key: 'pending_monthly_pool', label: 'Pending Monthly Pool', format: (v) => fmt(v) },
  { key: 'pending_annual_pool', label: 'Pending Annual Pool', format: (v) => fmt(v) },
  { key: 'realized_involuntary_churn', label: 'Realized Involuntary Churn', format: (v) => fmt(v) },
  { key: 'rm', label: 'Monthly Failure Rate (Rₘ)', format: fmtRate },
  { key: 'current_monthly_failure_rate', label: 'Current Monthly Failure Rate', format: fmtRate },
  { key: 'current_annual_failure_rate', label: 'Current Annual Failure Rate', format: fmtRate },
  { key: 'future_uncollectibles', label: 'Future Uncollectibles', format: (v) => fmt(v) },
  { key: 'total_forecasted_churn', label: 'Total Forecasted Churn', format: (v) => fmt(v) },
  { key: 'churn_rate_pct', label: 'Churn Rate', format: fmtPct },
  { key: 'final_closing_balance', label: 'Final Closing Balance', format: (v) => fmt(v) },
]

function HeadlineCard({ title, value, accent }) {
  return (
    <div className={`rounded-xl border p-5 ${accent}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-current opacity-60">{title}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
    </div>
  )
}

export default function Results({ prediction }) {
  if (!prediction) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-4xl mb-3">📊</p>
        <p className="text-sm">No prediction yet. Go to <strong>Run Prediction</strong> to generate a forecast.</p>
      </div>
    )
  }

  const isLive = prediction.calibration_mode === 'live'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Results</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Forecast for <span className="font-medium text-gray-700">{prediction.analysis_month}</span>
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
            isLive
              ? 'bg-green-100 text-green-800'
              : 'bg-amber-100 text-amber-800'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${isLive ? 'bg-green-500' : 'bg-amber-500'}`} />
          {isLive ? 'Live Calibration' : 'Fallback (2%)'}
        </span>
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
        <HeadlineCard
          title="Total Forecasted Churn"
          value={fmt(prediction.total_forecasted_churn)}
          accent="border-red-200 bg-red-50 text-red-900"
        />
        <HeadlineCard
          title="Churn Rate"
          value={fmtPct(prediction.churn_rate_pct)}
          accent="border-orange-200 bg-orange-50 text-orange-900"
        />
        <HeadlineCard
          title="Predicted Closing Balance"
          value={fmt(prediction.final_closing_balance)}
          accent="border-indigo-200 bg-indigo-50 text-indigo-900"
        />
      </div>

      {/* Daily churn chart */}
      <ChurnChart
        series={prediction.daily_churn_series}
        tPivotDate={prediction.t_pivot_date}
      />

      {/* Detailed breakdown table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-8">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Detailed Breakdown</h3>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {BREAKDOWN_ROWS.map(({ key, label, format }, idx) => (
              <tr
                key={key}
                className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="px-5 py-3 text-gray-600 font-medium w-1/2">{label}</td>
                <td className="px-5 py-3 text-gray-900 text-right font-mono tabular-nums">
                  {format(prediction[key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
