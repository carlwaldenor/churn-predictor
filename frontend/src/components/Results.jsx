import { useState } from 'react'
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
  {
    key: 'matured_monthly_pool', label: 'Matured Monthly Pool', format: (v) => fmt(v),
    definition: 'Monthly subscriptions whose full dunning window has elapsed — their payment outcome (recovered or failed) is already determined.',
  },
  {
    key: 'matured_annual_pool', label: 'Matured Annual Pool', format: (v) => fmt(v),
    definition: 'Annual subscriptions whose dunning window has fully elapsed this month — outcome already known.',
  },
  {
    key: 'pending_monthly_pool', label: 'Pending Monthly Pool', format: (v) => fmt(v),
    definition: 'Monthly subscriptions currently inside their dunning window — payment outcome still unknown, subject to the failure rate forecast.',
  },
  {
    key: 'pending_annual_pool', label: 'Pending Annual Pool', format: (v) => fmt(v),
    definition: 'Annual subscriptions currently inside their dunning window — payment outcome still unknown.',
  },
  {
    key: 'realized_involuntary_churn', label: 'Realized Involuntary Churn', format: (v) => fmt(v),
    definition: 'Confirmed payment failures from the matured pool (Reported Total Churn − Voluntary Churn). Zero triggers the fallback failure rate.',
  },
  {
    key: 'rm', label: 'Monthly Failure Rate (Rₘ)', format: fmtRate,
    definition: 'Calibrated failure rate per unit of monthly pool weight. Derived from Realized Involuntary Churn ÷ Matured Pool, or the 2.9 % fallback (EP historical average) when no involuntary churn is observed.',
  },
  {
    key: 'current_monthly_failure_rate', label: 'Current Monthly Failure Rate', format: fmtRate,
    definition: 'The monthly-equivalent payment failure rate applied to the pending monthly pool when forecasting future uncollectibles. Equal to Rₘ.',
  },
  {
    key: 'current_annual_failure_rate', label: 'Current Annual Failure Rate', format: fmtRate,
    definition: 'Rₘ × Annual Risk Weight — the failure rate applied to annual subscriptions, scaled for their longer billing cycle.',
  },
  {
    key: 'future_uncollectibles', label: 'Future Uncollectibles', format: (v) => fmt(v),
    definition: 'Predicted involuntary churn still to materialise: (Pending Monthly × Rₘ) + (Pending Annual × Rₘ × Annual Risk Weight).',
  },
  {
    key: 'total_forecasted_churn', label: 'Total Forecasted Churn', format: (v) => fmt(v),
    definition: 'Reported Total Churn + Future Uncollectibles — the full estimated churn for the analysis month.',
  },
  {
    key: 'churn_rate_pct', label: 'Churn Rate', format: fmtPct,
    definition: 'Total Forecasted Churn ÷ Opening Balance, expressed as a percentage.',
  },
  {
    key: 'final_closing_balance', label: 'Final Closing Balance', format: (v) => fmt(v),
    definition: 'Opening Balance − Total Forecasted Churn + New Sales.',
  },
]

function InfoTooltip({ text }) {
  const [visible, setVisible] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: '6px', verticalAlign: 'middle', flexShrink: 0 }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {/* Badge */}
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, borderRadius: '50%',
        backgroundColor: visible ? '#6b7280' : '#9ca3af',
        color: '#fff', fontSize: 10, fontWeight: 700,
        cursor: 'default', userSelect: 'none', flexShrink: 0, lineHeight: 1,
      }}>?</span>

      {/* Tooltip bubble */}
      {visible && (
        <span style={{
          position: 'absolute', left: 0, bottom: '100%', marginBottom: 8,
          zIndex: 50, width: 260, borderRadius: 8,
          backgroundColor: '#111827', padding: '8px 12px',
          fontSize: 12, color: '#f3f4f6', lineHeight: 1.6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}>
          {text}
          {/* Caret */}
          <span style={{
            position: 'absolute', left: 4, top: '100%',
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid #111827',
          }} />
        </span>
      )}
    </span>
  )
}

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
          {isLive ? 'Live Calibration' : 'Fallback (2.9%)'}
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
      <div className="bg-white rounded-xl border border-gray-200 mt-8">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Detailed Breakdown</h3>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {BREAKDOWN_ROWS.map(({ key, label, format, definition }, idx) => (
              <tr
                key={key}
                className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="px-5 py-3 text-gray-600 font-medium w-1/2">
                  {label}
                  {definition && <InfoTooltip text={definition} />}
                </td>
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
