import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts'

function formatDateLabel(dateStr) {
  const [, month, day] = dateStr.split('-')
  const d = new Date(Date.UTC(2000, parseInt(month, 10) - 1, parseInt(day, 10)))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const n = (v) =>
  (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm min-w-[200px]">
      <p className="font-semibold text-gray-800 mb-1">{formatDateLabel(d.date)}</p>
      <p className={`text-xs font-medium mb-2 ${d.is_actual ? 'text-green-600' : 'text-amber-600'}`}>
        {d.is_actual ? 'Actual' : 'Projected'}
      </p>
      <div className="space-y-1 border-t border-gray-100 pt-2">
        <div className="flex justify-between gap-6">
          <span className="text-gray-500 flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-400" />
            Voluntary
          </span>
          <span className="font-mono font-medium text-gray-900">{n(d.daily_voluntary)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-500 flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" />
            Involuntary
          </span>
          <span className="font-mono font-medium text-gray-900">{n(d.daily_involuntary)}</span>
        </div>
        <div className="flex justify-between gap-6 pt-1 border-t border-gray-100">
          <span className="text-gray-700 font-medium">Total Daily</span>
          <span className="font-mono font-semibold text-gray-900">{n(d.daily_total)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-500">Cumulative</span>
          <span className="font-mono font-medium text-gray-900">{n(d.cumulative_total)}</span>
        </div>
      </div>
    </div>
  )
}

const LEGEND_ITEMS = [
  { color: '#f97316', label: 'Voluntary (actual)' },
  { color: '#ef4444', label: 'Involuntary (actual)' },
  { color: '#f97316', label: 'Voluntary (projected)', opacity: 0.35 },
  { color: '#ef4444', label: 'Involuntary (projected)', opacity: 0.35 },
]

const CustomLegend = () => (
  <div className="flex flex-wrap gap-x-5 gap-y-1 justify-center mt-1 text-xs text-gray-500">
    {LEGEND_ITEMS.map(({ color, label, opacity = 1 }) => (
      <span key={label} className="flex items-center gap-1.5">
        <span
          className="inline-block w-3 h-3 rounded-sm"
          style={{ background: color, opacity }}
        />
        {label}
      </span>
    ))}
  </div>
)

export default function ChurnChart({ series, tPivotDate }) {
  if (!series || series.length === 0) return null

  // Build chartData with four stacked fields split at the pivot
  const pivotIdx = series.findLastIndex((d) => d.is_actual)

  const chartData = series.map((d, i) => ({
    date: d.date,
    is_actual: d.is_actual,
    daily_voluntary: d.daily_voluntary,
    daily_involuntary: d.daily_involuntary,
    daily_total: d.daily_total,
    cumulative_total: d.cumulative_total,
    // Actual stack: non-null for actual days (+ bridge at pivot)
    involuntary_actual: d.is_actual || i === pivotIdx ? d.daily_involuntary : null,
    voluntary_actual: d.is_actual || i === pivotIdx ? d.daily_voluntary : null,
    // Projected stack: non-null for projected days (+ bridge at pivot)
    involuntary_projected: !d.is_actual || i === pivotIdx ? d.daily_involuntary : null,
    voluntary_projected: !d.is_actual || i === pivotIdx ? d.daily_voluntary : null,
  }))

  // X-axis ticks: day 1 and every 5th day
  const xTicks = series
    .filter((d) => {
      const day = parseInt(d.date.split('-')[2], 10)
      return day === 1 || day % 5 === 0
    })
    .map((d) => d.date)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">Daily Churn</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Stacked by type &nbsp;·&nbsp; Solid = actual &nbsp;·&nbsp; Faded = projected
        </p>
      </div>
      <div className="px-2 pt-4 pb-2">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 20, left: 10, bottom: 0 }}>
            <XAxis
              dataKey="date"
              ticks={xTicks}
              tickFormatter={formatDateLabel}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
              width={50}
              tickFormatter={(v) => v.toLocaleString('en-US')}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Actual stack — solid (voluntary at bottom, involuntary on top) */}
            <Area
              dataKey="voluntary_actual"
              stackId="actual"
              stroke="none"
              fill="#f97316"
              fillOpacity={1}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />
            <Area
              dataKey="involuntary_actual"
              stackId="actual"
              stroke="none"
              fill="#ef4444"
              fillOpacity={1}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />

            {/* Projected stack — faded with dashed border */}
            <Area
              dataKey="voluntary_projected"
              stackId="projected"
              stroke="#f97316"
              strokeWidth={1}
              strokeDasharray="4 3"
              fill="#f97316"
              fillOpacity={0.25}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />
            <Area
              dataKey="involuntary_projected"
              stackId="projected"
              stroke="#ef4444"
              strokeWidth={1}
              strokeDasharray="4 3"
              fill="#ef4444"
              fillOpacity={0.25}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />

            {tPivotDate && (
              <ReferenceLine
                x={tPivotDate}
                stroke="#6366f1"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{
                  value: 'Dunning cutoff',
                  position: 'insideTopRight',
                  fontSize: 11,
                  fill: '#6366f1',
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <CustomLegend />
      </div>
    </div>
  )
}
