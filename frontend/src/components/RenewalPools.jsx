import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts'

const MONTHLY_COLOR = '#6366f1'  // indigo-500
const ANNUAL_COLOR  = '#a5b4fc'  // indigo-300

const fmt = (v) =>
  v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{
      background: '#111827', borderRadius: 8, padding: '8px 12px',
      fontSize: 12, color: '#f3f4f6', lineHeight: 1.7,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <p style={{ fontWeight: 700, marginBottom: 4 }}>
        {label}{d?.is_future ? ' (projected)' : ''}
      </p>
      {payload.map((p) => (
        <p key={p.name}>
          <span style={{ color: p.fill }}>{p.name === 'monthly_pool' ? 'Monthly' : 'Annual'}: </span>
          <strong>{fmt(p.value)}</strong>
        </p>
      ))}
      <p style={{ borderTop: '1px solid #374151', marginTop: 4, paddingTop: 4 }}>
        Total: <strong>{fmt(d?.total_pool)}</strong>
      </p>
    </div>
  )
}

export default function RenewalPools({ csvStatus }) {
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const requiredReady = csvStatus &&
    ['monthly_cohorts', 'annual_cohorts', 'daily_growth_monthly', 'daily_growth_annual']
      .every(k => csvStatus[k]?.exists)

  useEffect(() => {
    if (!requiredReady) return
    setLoading(true)
    setError(null)
    axios.get('/api/renewal-pool-history')
      .then(({ data }) => setSeries(data))
      .catch((err) => setError(err.response?.data?.detail || err.message))
      .finally(() => setLoading(false))
  }, [requiredReady])

  if (!requiredReady) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-4xl mb-3">📋</p>
        <p className="text-sm">Upload all four data files first to see the renewal pool history.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-sm">Computing renewal pools…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20 text-red-400">
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  if (!series) return null

  // Format month labels for the chart: "Apr '25"
  const chartData = series.map((d) => {
    const [y, m] = d.month.split('-')
    const label = new Date(`${d.month}-01`).toLocaleString('en-US', { month: 'short' }) + ` '${y.slice(2)}`
    return { ...d, label }
  })

  // Find the last non-future index for the reference line
  const lastHistoricalIdx = chartData.reduce((acc, d, i) => (!d.is_future ? i : acc), -1)

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Renewal Pools</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Subscribers up for renewal each month — last 12 months + 3-month projection
        </p>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 16, right: 20, left: 10, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />

            {/* Reference line between historical and projected */}
            {lastHistoricalIdx >= 0 && lastHistoricalIdx < chartData.length - 1 && (
              <ReferenceLine
                x={chartData[lastHistoricalIdx + 1]?.label}
                stroke="#d1d5db"
                strokeDasharray="4 3"
                label={{ value: 'Projected →', position: 'insideTopLeft', fontSize: 10, fill: '#9ca3af' }}
              />
            )}

            <Bar
              dataKey="monthly_pool"
              name="Monthly"
              stackId="pool"
              fill={MONTHLY_COLOR}
              radius={[0, 0, 0, 0]}
              maxBarSize={40}
              fillOpacity={1}
              shape={(props) => {
                const { x, y, width, height, payload } = props
                return (
                  <rect
                    x={x} y={y} width={width} height={height}
                    fill={MONTHLY_COLOR}
                    opacity={payload.is_future ? 0.35 : 0.9}
                    rx={0} ry={0}
                  />
                )
              }}
            />
            <Bar
              dataKey="annual_pool"
              name="Annual"
              stackId="pool"
              fill={ANNUAL_COLOR}
              radius={[3, 3, 0, 0]}
              maxBarSize={40}
              shape={(props) => {
                const { x, y, width, height, payload } = props
                return (
                  <rect
                    x={x} y={y} width={width} height={height}
                    fill={ANNUAL_COLOR}
                    opacity={payload.is_future ? 0.35 : 0.9}
                    rx={3} ry={3}
                  />
                )
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        <div className="flex items-center gap-6 mt-2 justify-end text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: MONTHLY_COLOR, display: 'inline-block' }} />
            Monthly subscribers
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: ANNUAL_COLOR, display: 'inline-block' }} />
            Annual subscribers
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 mt-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Monthly Detail</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Month</th>
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Monthly</th>
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Annual</th>
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Pool</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((d, idx) => (
              <tr
                key={d.month}
                className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${d.is_future ? 'text-gray-400 italic' : 'text-gray-900'}`}
              >
                <td className="px-5 py-2.5 font-medium">
                  {d.month}
                  {d.is_future && (
                    <span className="ml-2 text-xs font-normal not-italic text-gray-400">projected</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right font-mono tabular-nums">{fmt(d.monthly_pool)}</td>
                <td className="px-5 py-2.5 text-right font-mono tabular-nums">{fmt(d.annual_pool)}</td>
                <td className="px-5 py-2.5 text-right font-mono tabular-nums font-semibold">{fmt(d.total_pool)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
