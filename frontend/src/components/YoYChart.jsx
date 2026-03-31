import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts'

const HIST_COLOR = '#94a3b8'  // slate-400
const PRED_COLOR = '#6366f1'  // indigo-500

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: '#111827', borderRadius: 8, padding: '8px 12px',
      fontSize: 12, color: '#f3f4f6', lineHeight: 1.6,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <p style={{ fontWeight: 700, marginBottom: 2 }}>
        {d.year}{d.is_predicted ? ' — Predicted' : ''}
      </p>
      <p>Churn rate: <strong>{d.churn_rate_pct.toFixed(2)}%</strong></p>
    </div>
  )
}

export default function YoYChart({ series, analysisMonth }) {
  if (!series || series.length === 0) return null

  const monthLabel = new Date(`${analysisMonth}-01`).toLocaleString('default', { month: 'long' })

  return (
    <div className="bg-white rounded-xl border border-gray-200 mt-8 p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-1">
        {monthLabel} Churn Rate — Year over Year
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        Historical actual rates vs. this month's prediction
      </p>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={series} margin={{ top: 8, right: 20, left: 10, bottom: 0 }}>
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 'auto']}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="churn_rate_pct" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {series.map((entry) => (
              <Cell
                key={entry.year}
                fill={entry.is_predicted ? PRED_COLOR : HIST_COLOR}
                opacity={entry.is_predicted ? 1 : 0.65}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-6 mt-3 justify-end text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            background: HIST_COLOR, display: 'inline-block', opacity: 0.65,
          }} />
          Historical
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            background: PRED_COLOR, display: 'inline-block',
          }} />
          Predicted
        </span>
      </div>
    </div>
  )
}
