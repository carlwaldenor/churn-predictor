import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import axios from 'axios'
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmt = (n, dec = 0) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const fmtDate = (d) => {
  if (!d) return ''
  const [, m] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[parseInt(m, 10) - 1] + ' ' + d.slice(0, 4)
}

const PLAN_COLORS = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#06b6d4']
const planKey = (p) => `${p.tier}_${p.plan}`
const planLabel = (p) =>
  `${p.tier.charAt(0).toUpperCase() + p.tier.slice(1)} ${p.plan.charAt(0).toUpperCase() + p.plan.slice(1)}`

// Subtract N months from a YYYY-MM-DD string, return YYYY-MM-DD
function subtractMonths(dateStr, n) {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() - n)
  return d.toISOString().split('T')[0]
}

// Generate last-day-of-month date strings from today through end of endYear
function horizonMonthOptions(endYear = new Date().getFullYear() + 10) {
  const options = []
  const now = new Date()
  const target = new Date(endYear, 11, 31)
  let d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  while (d <= target) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const yyyy = last.getFullYear()
    const mm = String(last.getMonth() + 1).padStart(2, '0')
    const dd = String(last.getDate()).padStart(2, '0')
    options.push({ value: `${yyyy}-${mm}-${dd}`, label: fmtDate(`${yyyy}-${mm}-${dd}`) })
    d.setMonth(d.getMonth() + 1)
  }
  return options
}

function horizonYears(endYear) {
  const start = new Date().getFullYear()
  const years = []
  for (let y = start; y <= endYear; y++) years.push(y)
  return years
}

// Compute horizon_months from a target end year and the last actual date
function computeHorizonMonths(endYear, lastActualDate) {
  const baseYear  = lastActualDate ? parseInt(lastActualDate.split('-')[0]) : new Date().getFullYear()
  const baseMonth = lastActualDate ? parseInt(lastActualDate.split('-')[1]) : new Date().getMonth() + 1
  return Math.max(1, (endYear - baseYear) * 12 + (12 - baseMonth))
}

// Collapse monthly chart data into quarters or years (last point in period wins —
// MRR and subscribers are end-of-period snapshots, so the last month is correct).
function aggregateChartData(data, granularity) {
  if (granularity === 'month') return data
  const groups = new Map()
  for (const point of data) {
    const [year, month] = point.date.split('-').map(Number)
    const key = granularity === 'year'
      ? `${year}`
      : `${year}-Q${Math.ceil(month / 3)}`
    groups.set(key, point) // later months overwrite earlier ones → last of period
  }
  return Array.from(groups.values())
}

// X-axis tick label depending on granularity
function fmtTick(date, granularity) {
  if (!date) return ''
  if (granularity === 'month') return fmtDate(date)
  const [year, month] = date.split('-').map(Number)
  if (granularity === 'year') return String(year)
  return `Q${Math.ceil(month / 3)} ${year}`
}

// ---------------------------------------------------------------------------
// Build unified chart dataset (historical + projected)
// ---------------------------------------------------------------------------
function buildChartData(actualPlans, result, startDate) {
  // Index actual rows by plan key → date → row
  const planRowsMap = {}
  actualPlans.forEach((p) => {
    planRowsMap[planKey(p)] = {}
    ;(p.monthly_data || []).forEach((r) => { planRowsMap[planKey(p)][r.date] = r })
  })

  // Index forecast rows by plan key → date → month
  const forecastRowsMap = {}
  if (result) {
    result.plans.forEach((pf) => {
      forecastRowsMap[`${pf.tier}_${pf.plan}`] = {}
      pf.months.forEach((m) => { forecastRowsMap[`${pf.tier}_${pf.plan}`][m.date] = m })
    })
  }

  // Collect all dates
  const allActualDates = new Set()
  Object.values(planRowsMap).forEach((rows) => Object.keys(rows).forEach((d) => allActualDates.add(d)))
  const allForecastDates = new Set()
  if (result) result.totals.forEach((t) => allForecastDates.add(t.date))

  const lastActualDate = [...allActualDates].sort().at(-1) ?? null

  let allDates = [...new Set([...allActualDates, ...allForecastDates])].sort()
  if (startDate) allDates = allDates.filter((d) => d >= startDate)

  // Keys for new plans (forecast-only — no actuals)
  const newPlanKeys = result
    ? result.plans
        .map((pf) => `${pf.tier}_${pf.plan}`)
        .filter((k) => !actualPlans.some((p) => planKey(p) === k))
    : []

  return allDates.map((date) => {
    const isProjected = lastActualDate ? date > lastActualDate : false
    const isLastActual = date === lastActualDate
    const point = { date, isProjected }

    let totalActualMrr = 0
    let hasActual = false

    actualPlans.forEach((p) => {
      const key = planKey(p)
      const ar = planRowsMap[key]?.[date]
      const fr = forecastRowsMap[key]?.[date]

      // MRR: solid line for actuals, dashed for projected, bridge at pivot
      point[`${key}_actual_mrr`] = ar ? ar.mrr : null
      if (isProjected && fr) {
        point[`${key}_proj_mrr`] = fr.mrr
      } else if (isLastActual && ar) {
        point[`${key}_proj_mrr`] = ar.mrr // bridge point
      } else {
        point[`${key}_proj_mrr`] = null
      }

      if (ar) {
        totalActualMrr += ar.mrr
        hasActual = true
      }

      // Subscribers: single continuous series (actual data then forecast data)
      point[`${key}_subs`] = ar ? ar.total_subscribers : (isProjected && fr ? fr.subscribers : null)
    })

    // New plans — forecast only, always projected
    newPlanKeys.forEach((key) => {
      const fr = forecastRowsMap[key]?.[date]
      point[`${key}_actual_mrr`] = null
      point[`${key}_proj_mrr`] = fr ? fr.mrr : null
      point[`${key}_subs`] = fr ? fr.subscribers : null
    })

    // Total MRR
    point.total_actual_mrr = hasActual ? totalActualMrr : null
    if (isProjected && result) {
      const tr = result.totals.find((t) => t.date === date)
      point.total_proj_mrr = tr?.mrr ?? null
    } else if (isLastActual && hasActual) {
      point.total_proj_mrr = totalActualMrr // bridge point
    } else {
      point.total_proj_mrr = null
    }

    return point
  })
}

// ---------------------------------------------------------------------------
// Scenario editor
// ---------------------------------------------------------------------------
function LeverInput({ label, value, placeholder, onChange, suffix }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{suffix}</span>
        )}
      </div>
    </div>
  )
}

function PlanToggle({ enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={enabled ? 'Exclude from scenario' : 'Include in scenario'}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

function ScenarioEditor({ actualPlans, scenario, onChange, newPlans, allPlanMetas }) {
  const [drafts, setDrafts] = useState({})

  const setField = (field, val) => onChange({ ...scenario, [field]: val })

  const isExcluded = (key) => (scenario.excluded_plans || []).includes(key)
  const togglePlan = (key) => {
    const cur = scenario.excluded_plans || []
    onChange({
      ...scenario,
      excluded_plans: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    })
  }

  const getLevers = (key) => scenario.plan_overrides[key] || { yoy_rates: [], price_changes: [] }
  const setLevers = (key, levers) =>
    onChange({ ...scenario, plan_overrides: { ...scenario.plan_overrides, [key]: levers } })

  const getYoy = (key, year) => {
    const levers = getLevers(key)
    return levers.yoy_rates.find((y) => y.year === year) || { year, sales_growth: null, churn_growth: null }
  }

  const setYoy = (key, year, field, rawVal) => {
    const levers = getLevers(key)
    const val = rawVal === '' ? null : parseFloat(rawVal) / 100
    const existing = levers.yoy_rates.filter((y) => y.year !== year)
    const updated = { year, ...getYoy(key, year), [field]: val }
    setLevers(key, { ...levers, yoy_rates: [...existing, updated].sort((a, b) => a.year - b.year) })
  }

  // Draft-based helpers so the input shows exactly what the user types.
  // .toFixed(2) was converting "1" → "1.00" mid-keystroke, blocking double-digit entry.
  const yoyDraftKey = (key, year, field) => `${key}|${year}|${field}`

  const getYoyVal = (key, year, field) => {
    const dk = yoyDraftKey(key, year, field)
    if (dk in drafts) return drafts[dk]
    const y = getYoy(key, year)
    if (y[field] == null) return ''
    // Strip float artifacts (0.14 * 100 = 14.000000000002) but keep real decimals
    return String(parseFloat((y[field] * 100).toPrecision(8)))
  }

  const onYoyChange = (key, year, field, val) => {
    setDrafts((prev) => ({ ...prev, [yoyDraftKey(key, year, field)]: val }))
  }

  const onYoyBlur = (key, year, field) => {
    const dk = yoyDraftKey(key, year, field)
    if (dk in drafts) {
      setYoy(key, year, field, drafts[dk])
      setDrafts((prev) => { const n = { ...prev }; delete n[dk]; return n })
    }
  }

  // "Apply to all years" default row helpers
  const defaultDraftKey = (key, field) => `${key}|default|${field}`

  const getDefaultVal = (key, field) => {
    const dk = defaultDraftKey(key, field)
    if (dk in drafts) return drafts[dk]
    // Show common value if all years agree, otherwise empty
    const vals = years.map((year) => getYoy(key, year)[field]).filter((v) => v != null)
    if (vals.length === 0) return ''
    const first = vals[0]
    return vals.every((v) => Math.abs(v - first) < 0.000001)
      ? String(parseFloat((first * 100).toPrecision(8)))
      : ''
  }

  const onDefaultChange = (key, field, val) => {
    setDrafts((prev) => ({ ...prev, [defaultDraftKey(key, field)]: val }))
  }

  const onDefaultBlur = (key, field) => {
    const dk = defaultDraftKey(key, field)
    if (dk in drafts) {
      const rawVal = drafts[dk]
      const val = rawVal === '' ? null : parseFloat(rawVal) / 100
      const levers = getLevers(key)
      // Build all year updates in one setLevers call — calling setYoy per-year
      // fails because each read of getLevers() sees the pre-update closure state.
      const yearSet = new Set(years)
      const preserved = levers.yoy_rates.filter((y) => !yearSet.has(y.year))
      const updated = years.map((year) => ({
        ...(levers.yoy_rates.find((y) => y.year === year) || { year, sales_growth: null, churn_growth: null }),
        [field]: val,
      }))
      setLevers(key, { ...levers, yoy_rates: [...preserved, ...updated].sort((a, b) => a.year - b.year) })
      setDrafts((prev) => { const n = { ...prev }; delete n[dk]; return n })
    }
  }

  const addPriceChange = (key) => {
    const levers = getLevers(key)
    const opts = horizonMonthOptions()
    const firstAvailable = opts.find((o) => !levers.price_changes.some((p) => p.month === o.value))
    if (!firstAvailable) return
    setLevers(key, { ...levers, price_changes: [...levers.price_changes, { month: firstAvailable.value, price: '' }] })
  }

  const updatePriceChange = (key, idx, field, val) => {
    const levers = getLevers(key)
    const updated = levers.price_changes.map((p, i) => i === idx ? { ...p, [field]: val } : p)
    setLevers(key, { ...levers, price_changes: updated })
  }

  const removePriceChange = (key, idx) => {
    const levers = getLevers(key)
    setLevers(key, { ...levers, price_changes: levers.price_changes.filter((_, i) => i !== idx) })
  }

  const endYear = scenario.horizon_end_year ?? new Date().getFullYear() + 5
  const years = horizonYears(endYear)
  const monthOptions = horizonMonthOptions(endYear)

  // Per-plan per-year historical averages
  const planActualsMap = useMemo(() => {
    const map = {}
    actualPlans.forEach((p) => {
      const key = planKey(p)
      const byYear = {}
      ;(p.monthly_data || []).forEach((r) => {
        const yr = parseInt(r.date.slice(0, 4), 10)
        if (!byYear[yr]) byYear[yr] = []
        byYear[yr].push(r)
      })
      map[key] = {}
      Object.entries(byYear).forEach(([yr, rows]) => {
        const n = rows.length
        const avgSales = Math.round(
          rows.reduce((s, r) => s + r.new_subscriber_count + (r.reactivation_count || 0), 0) / n
        )
        const churnRows = rows.filter((r) => r.total_subscribers > 0)
        const avgChurnPct = churnRows.length
          ? (churnRows.reduce((s, r) => s + Math.abs(r.churn_count) / r.total_subscribers, 0) / churnRows.length) * 100
          : null
        map[key][parseInt(yr, 10)] = { avgSales, avgChurnPct }
      })
    })
    return map
  }, [actualPlans])

  // Read the effective YoY for a key/year/field — uses draft value if mid-edit, else committed
  const getEffectiveYoy = (key, year, field) => {
    const dk = yoyDraftKey(key, year, field)
    if (dk in drafts) {
      const parsed = parseFloat(drafts[dk])
      return isNaN(parsed) ? 0 : parsed / 100
    }
    return getYoy(key, year)[field] ?? 0
  }

  // Per-plan per-year projected values.
  // For complete years: copy actual averages directly.
  // For the last year if it's partial (< 12 months of actuals): blend locked actuals with
  // YoY-estimated remaining months so the display reflects the full-year projection.
  const planProjected = useMemo(() => {
    const result = {}
    actualPlans.forEach((p) => {
      const key = planKey(p)
      const actualsForKey = planActualsMap[key] || {}
      const actualYears = Object.keys(actualsForKey).map(Number).sort()
      if (!actualYears.length) return
      const lastYear = actualYears[actualYears.length - 1]

      // Detect partial year
      const lastYearRows = (p.monthly_data || []).filter(
        (r) => parseInt(r.date.slice(0, 4), 10) === lastYear
      )
      const isPartial = lastYearRows.length < 12

      result[key] = {}
      // Copy all complete actual years
      actualYears.forEach((yr) => {
        if (yr !== lastYear || !isPartial) result[key][yr] = { ...actualsForKey[yr] }
      })

      let prevSales
      let prevChurn

      if (isPartial) {
        // Prior full year averages as the YoY base
        const priorYear = lastYear - 1
        const priorAvgSales = actualsForKey[priorYear]?.avgSales ?? actualsForKey[lastYear].avgSales
        const priorAvgChurnPct = actualsForKey[priorYear]?.avgChurnPct ?? actualsForKey[lastYear].avgChurnPct

        const nActual = lastYearRows.length
        const nRemaining = 12 - nActual
        const actualSalesSum = lastYearRows.reduce(
          (s, r) => s + r.new_subscriber_count + (r.reactivation_count || 0), 0
        )
        const churnRows = lastYearRows.filter((r) => r.total_subscribers > 0)
        const actualChurnSum = churnRows.reduce(
          (s, r) => s + (Math.abs(r.churn_count) / r.total_subscribers) * 100, 0
        )

        const salesGrowth = getEffectiveYoy(key, lastYear, 'sales_growth')
        const churnGrowth = getEffectiveYoy(key, lastYear, 'churn_growth')

        const estRemainingSales = priorAvgSales * (1 + salesGrowth)
        const estRemainingChurnPct = priorAvgChurnPct != null
          ? priorAvgChurnPct * (1 + churnGrowth)
          : null

        prevSales = Math.round((actualSalesSum + nRemaining * estRemainingSales) / 12)
        prevChurn = estRemainingChurnPct != null
          ? (actualChurnSum + nRemaining * estRemainingChurnPct) / 12
          : (churnRows.length > 0 ? actualChurnSum / churnRows.length : null)

        result[key][lastYear] = { avgSales: prevSales, avgChurnPct: prevChurn }
      } else {
        prevSales = actualsForKey[lastYear].avgSales
        prevChurn = actualsForKey[lastYear].avgChurnPct
      }

      // Compound into forecast years
      years.forEach((year) => {
        if (year <= lastYear) {
          if (!isPartial) {
            prevSales = actualsForKey[year]?.avgSales ?? prevSales
            prevChurn = actualsForKey[year]?.avgChurnPct ?? prevChurn
          }
          return
        }
        const salesGrowth = getEffectiveYoy(key, year, 'sales_growth')
        const churnGrowth = getEffectiveYoy(key, year, 'churn_growth')
        const sales = Math.round(prevSales * (1 + salesGrowth))
        const churnPct = prevChurn != null ? prevChurn * (1 + churnGrowth) : null
        result[key][year] = { avgSales: sales, avgChurnPct: churnPct }
        prevSales = sales
        prevChurn = churnPct
      })
    })
    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualPlans, planActualsMap, drafts, scenario.plan_overrides, years])

  return (
    <div className="w-[30rem] shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Scenario</h3>
        <input
          type="text"
          value={scenario.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder="Scenario name"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">Horizon</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {[3, 5, 10].map((n) => {
              const endYear = new Date().getFullYear() + n
              const active = scenario.horizon_end_year === endYear
              return (
                <button
                  key={n}
                  onClick={() => setField('horizon_end_year', endYear)}
                  className={`flex-1 py-2 font-medium transition-colors ${
                    active ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  +{n}y
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Through end of {scenario.horizon_end_year ?? new Date().getFullYear() + 5}
          </p>
        </div>
      </div>

      <div className="flex-1 px-5 py-4 space-y-7">
        {actualPlans.length === 0 && (
          <p className="text-xs text-gray-400">Upload actuals CSVs to edit levers.</p>
        )}
        {actualPlans.map((p, i) => {
          const key = planKey(p)
          const levers = getLevers(key)
          const enabled = !isExcluded(key)
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length], opacity: enabled ? 1 : 0.4 }} />
                  <p className={`text-xs font-semibold uppercase tracking-wide ${enabled ? 'text-gray-700' : 'text-gray-400'}`}>{planLabel(p)}</p>
                </div>
                <PlanToggle enabled={enabled} onToggle={() => togglePlan(key)} />
              </div>

              {enabled && <>
              <p className="text-xs font-medium text-gray-500 mb-2">YoY Growth Rates</p>
              <div className="rounded-lg border border-gray-200 overflow-hidden mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Year</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Sales %</th>
                      <th className="px-2 py-2 text-right font-medium text-gray-400 text-[10px] leading-tight">Avg<br/>Sales</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Churn %</th>
                      <th className="px-2 py-2 text-right font-medium text-gray-400 text-[10px] leading-tight">Avg<br/>Churn</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {/* Default row — applies to all years on blur */}
                    <tr className="bg-emerald-50">
                      <td className="px-3 py-1.5 text-emerald-700 font-semibold text-xs">All years</td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={getDefaultVal(key, 'sales_growth')}
                            onChange={(e) => onDefaultChange(key, 'sales_growth', e.target.value)}
                            onBlur={() => onDefaultBlur(key, 'sales_growth')}
                            placeholder="—"
                            className="w-full text-right rounded border border-emerald-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-emerald-400 text-xs pointer-events-none">%</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5" />
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={getDefaultVal(key, 'churn_growth')}
                            onChange={(e) => onDefaultChange(key, 'churn_growth', e.target.value)}
                            onBlur={() => onDefaultBlur(key, 'churn_growth')}
                            placeholder="—"
                            className="w-full text-right rounded border border-emerald-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-emerald-400 text-xs pointer-events-none">%</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5" />
                    </tr>
                    {years.map((year) => {
                      const proj = planProjected[key]?.[year]
                      return (
                      <tr key={year}>
                        <td className="px-3 py-1.5 text-gray-700 font-medium">{year}</td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={getYoyVal(key, year, 'sales_growth')}
                              onChange={(e) => onYoyChange(key, year, 'sales_growth', e.target.value)}
                              onBlur={() => onYoyBlur(key, year, 'sales_growth')}
                              placeholder="0"
                              className="w-full text-right rounded border border-gray-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-[11px] text-gray-400 whitespace-nowrap">
                          {proj?.avgSales != null ? proj.avgSales : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={getYoyVal(key, year, 'churn_growth')}
                              onChange={(e) => onYoyChange(key, year, 'churn_growth', e.target.value)}
                              onBlur={() => onYoyBlur(key, year, 'churn_growth')}
                              placeholder="0"
                              className="w-full text-right rounded border border-gray-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-[11px] text-gray-400 whitespace-nowrap">
                          {proj?.avgChurnPct != null ? `${proj.avgChurnPct.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-xs font-medium text-gray-500 mb-2">Price Changes</p>
              <div className="space-y-2">
                {levers.price_changes.map((pc, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={pc.month}
                      onChange={(e) => updatePriceChange(key, idx, 'month', e.target.value)}
                      className="flex-1 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      {monthOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <div className="relative w-20 shrink-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pc.price}
                        onChange={(e) => updatePriceChange(key, idx, 'price', e.target.value)}
                        placeholder={`${p.price.toFixed(2)}${p.plan?.toLowerCase() === 'annual' ? '/yr' : '/mo'}`}
                        className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <button onClick={() => removePriceChange(key, idx)} className="text-gray-400 hover:text-red-500 transition-colors shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <button onClick={() => addPriceChange(key)} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-colors">
                  + Add price change
                </button>
              </div>
              </>}
            </div>
          )
        })}

        {/* ── New plan YoY ── */}
        {(newPlans || []).map((np, i) => {
          const key = `${np.tier}_${np.plan}`
          const levers = getLevers(key)
          const color = PLAN_COLORS[(actualPlans.length + i) % PLAN_COLORS.length]
          const label = `${np.tier.charAt(0).toUpperCase() + np.tier.slice(1)} ${np.plan.charAt(0).toUpperCase() + np.plan.slice(1)} (new)`
          const npEnabled = !isExcluded(key)
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, opacity: npEnabled ? 1 : 0.4 }} />
                  <p className={`text-xs font-semibold uppercase tracking-wide ${npEnabled ? 'text-gray-700' : 'text-gray-400'}`}>{label}</p>
                </div>
                <PlanToggle enabled={npEnabled} onToggle={() => togglePlan(key)} />
              </div>
              {npEnabled && <>
              <p className="text-xs font-medium text-gray-500 mb-2">YoY Growth Rates</p>
              <div className="rounded-lg border border-gray-200 overflow-hidden mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Year</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Sales %</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Churn %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr className="bg-emerald-50">
                      <td className="px-3 py-1.5 text-emerald-700 font-semibold text-xs">All years</td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <input type="text" inputMode="decimal" value={getDefaultVal(key, 'sales_growth')} onChange={(e) => onDefaultChange(key, 'sales_growth', e.target.value)} onBlur={() => onDefaultBlur(key, 'sales_growth')} placeholder="—"
                            className="w-full text-right rounded border border-emerald-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-emerald-400 text-xs pointer-events-none">%</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <input type="text" inputMode="decimal" value={getDefaultVal(key, 'churn_growth')} onChange={(e) => onDefaultChange(key, 'churn_growth', e.target.value)} onBlur={() => onDefaultBlur(key, 'churn_growth')} placeholder="—"
                            className="w-full text-right rounded border border-emerald-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-emerald-400 text-xs pointer-events-none">%</span>
                        </div>
                      </td>
                    </tr>
                    {years.map((year) => (
                      <tr key={year}>
                        <td className="px-3 py-1.5 text-gray-700 font-medium">{year}</td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input type="text" inputMode="decimal" value={getYoyVal(key, year, 'sales_growth')} onChange={(e) => onYoyChange(key, year, 'sales_growth', e.target.value)} onBlur={() => onYoyBlur(key, year, 'sales_growth')} placeholder="—"
                              className="w-full text-right rounded border border-gray-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input type="text" inputMode="decimal" value={getYoyVal(key, year, 'churn_growth')} onChange={(e) => onYoyChange(key, year, 'churn_growth', e.target.value)} onBlur={() => onYoyBlur(key, year, 'churn_growth')} placeholder="—"
                              className="w-full text-right rounded border border-gray-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Start date filter
// ---------------------------------------------------------------------------
const FILTERS = [
  { id: '6M', label: '6M', months: 6 },
  { id: '1Y', label: '1Y', months: 12 },
  { id: '2Y', label: '2Y', months: 24 },
  { id: 'all', label: 'All', months: null },
]

function StartFilter({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-400 mr-1">Show from</span>
      {FILTERS.map((f) => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            value === f.id
              ? 'bg-gray-900 text-white'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MRR chart — custom tooltip
// ---------------------------------------------------------------------------
function MrrTooltip({ active, payload, label, chartData, planMetas }) {
  if (!active || !payload?.length) return null
  const point = chartData.find((d) => d.date === label)
  if (!point) return null

  const rows = planMetas
    .map(({ key, label: name, color }) => {
      const mrr = point[`${key}_actual_mrr`] ?? point[`${key}_proj_mrr`] ?? null
      return { name, color, mrr }
    })
    .filter((r) => r.mrr != null)

  const totalMrr = point.total_actual_mrr ?? point.total_proj_mrr ?? null
  if (rows.length === 0 && totalMrr == null) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs min-w-[230px]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-semibold text-gray-800">{fmtDate(label)}</span>
        {point.isProjected
          ? <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 rounded-full px-1.5 py-0.5 font-medium">Forecast</span>
          : <span className="text-[10px] bg-blue-50 text-blue-500 border border-blue-100 rounded-full px-1.5 py-0.5 font-medium">Actual</span>
        }
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left text-gray-400 font-medium pb-1.5 pr-2">Plan</th>
            <th className="text-right text-gray-400 font-medium pb-1.5 pr-3">MRR</th>
            <th className="text-right text-gray-400 font-medium pb-1.5">ARR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, color, mrr }) => (
            <tr key={name}>
              <td className="py-0.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-gray-700">{name}</span>
                </div>
              </td>
              <td className="py-0.5 text-right font-mono text-gray-900 pr-3">{fmt(mrr)}</td>
              <td className="py-0.5 text-right font-mono text-gray-400">{fmt(mrr * 12)}</td>
            </tr>
          ))}
          {totalMrr != null && rows.length > 1 && (
            <tr className="border-t border-gray-100">
              <td className="pt-1.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-gray-900" />
                  <span className="text-gray-800 font-semibold">Total</span>
                </div>
              </td>
              <td className="pt-1.5 text-right font-mono font-semibold text-gray-900 pr-3">{fmt(totalMrr)}</td>
              <td className="pt-1.5 text-right font-mono font-semibold text-gray-500">{fmt(totalMrr * 12)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function MrrChart({ chartData, planMetas, firstForecastDate, granularity = 'month' }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 10, bottom: 0 }}>
        <XAxis dataKey="date" tickFormatter={(d) => fmtTick(d, granularity)} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={(props) => <MrrTooltip {...props} chartData={chartData} planMetas={planMetas} />} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />

        {firstForecastDate && (
          <ReferenceLine
            x={firstForecastDate}
            stroke="#cbd5e1"
            strokeDasharray="4 2"
            label={{ value: 'Forecast →', position: 'insideTopLeft', fontSize: 10, fill: '#94a3b8', dy: -2 }}
          />
        )}

        {/* Per plan: solid actual + dashed projected */}
        {planMetas.map(({ key, label, color }) => (
          <Line key={`${key}_a`} dataKey={`${key}_actual_mrr`} name={label} stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
        ))}
        {planMetas.map(({ key, color }) => (
          <Line key={`${key}_p`} dataKey={`${key}_proj_mrr`} stroke={color} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} legendType="none" />
        ))}

        {/* Total: solid + dashed */}
        <Line dataKey="total_actual_mrr" name="Total" stroke="#111827" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="total_proj_mrr" stroke="#111827" strokeWidth={2.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} legendType="none" />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Subscriber stacked area chart — custom tooltip
// ---------------------------------------------------------------------------
function SubsTooltip({ active, payload, label, chartData, planMetas }) {
  if (!active || !payload?.length) return null
  const point = chartData.find((d) => d.date === label)
  if (!point) return null

  const rows = planMetas
    .map(({ key, label: name, color }) => {
      const subs = point[`${key}_subs`] ?? null
      return { name, color, subs }
    })
    .filter((r) => r.subs != null)

  if (rows.length === 0) return null
  const totalSubs = rows.reduce((s, r) => s + r.subs, 0)

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs min-w-[210px]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-semibold text-gray-800">{fmtDate(label)}</span>
        {point.isProjected
          ? <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 rounded-full px-1.5 py-0.5 font-medium">Forecast</span>
          : <span className="text-[10px] bg-blue-50 text-blue-500 border border-blue-100 rounded-full px-1.5 py-0.5 font-medium">Actual</span>
        }
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left text-gray-400 font-medium pb-1.5 pr-2">Plan</th>
            <th className="text-right text-gray-400 font-medium pb-1.5">Subscribers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, color, subs }) => (
            <tr key={name}>
              <td className="py-0.5 pr-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-gray-700">{name}</span>
                </div>
              </td>
              <td className="py-0.5 text-right font-mono text-gray-900">{fmt(subs)}</td>
            </tr>
          ))}
          {rows.length > 1 && (
            <tr className="border-t border-gray-100">
              <td className="pt-1.5 pr-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-gray-900" />
                  <span className="text-gray-800 font-semibold">Total</span>
                </div>
              </td>
              <td className="pt-1.5 text-right font-mono font-semibold text-gray-900">{fmt(totalSubs)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function SubsChart({ chartData, planMetas, firstForecastDate, granularity = 'month' }) {
  // Compute where the forecast starts as a % of the x-axis width for the gradient
  const pivotPct = (() => {
    if (!firstForecastDate || !chartData.length) return '100%'
    const idx = chartData.findIndex((d) => d.date >= firstForecastDate)
    if (idx < 0) return '100%'
    return `${((idx / chartData.length) * 100).toFixed(1)}%`
  })()

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 10, bottom: 0 }}>
        {/* Gradient per plan: full opacity → lighter at the forecast boundary */}
        <defs>
          {planMetas.map(({ key, color }) => (
            <linearGradient key={key} id={`subs_grad_${key}`} x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset={pivotPct} stopColor={color} stopOpacity={0.75} />
              <stop offset={pivotPct} stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.35} />
            </linearGradient>
          ))}
        </defs>

        <XAxis dataKey="date" tickFormatter={(d) => fmtTick(d, granularity)} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => fmt(v)} />
        <Tooltip content={(props) => <SubsTooltip {...props} chartData={chartData} planMetas={planMetas} />} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />

        {planMetas.map(({ key, label, color }) => (
          <Area key={key} dataKey={`${key}_subs`} name={label} stackId="s"
            stroke={color} fill={`url(#subs_grad_${key})`} fillOpacity={1}
            dot={false} isAnimationActive={false} connectNulls={false} />
        ))}

        {firstForecastDate && (
          <ReferenceLine
            x={firstForecastDate}
            stroke="#94a3b8"
            strokeDasharray="4 2"
            label={{ value: 'Forecast →', position: 'insideTopLeft', fontSize: 10, fill: '#94a3b8', dy: -2 }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------
function KpiStrip({ result }) {
  const last = result.totals.at(-1)
  const avgChurn = result.totals.reduce((s, t) => s + t.churn_rate, 0) / result.totals.length
  return (
    <div className="grid grid-cols-4 gap-4">
      {[
        { label: 'End Subscribers', value: fmt(last?.subscribers) },
        { label: 'End MRR', value: fmt(last?.mrr) },
        { label: 'End ARR', value: fmt(last?.arr) },
        { label: 'Avg Monthly Churn', value: `${(avgChurn * 100).toFixed(2)}%` },
      ].map((k) => (
        <div key={k.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
          <p className="text-2xl font-bold text-gray-900">{k.value}</p>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Breakdown table
// ---------------------------------------------------------------------------
const BREAKDOWN_PREVIEW_ROWS = 6

function BreakdownTable({ totals }) {
  const [showAll, setShowAll] = useState(false)

  const exportCsv = () => {
    const header = ['Date', 'Subscribers', 'MRR', 'ARR', 'Total Sales', 'Churned', 'Churn Rate %']
    const rows = totals.map((t) => [
      t.date, t.subscribers, t.mrr.toFixed(2), t.arr.toFixed(2),
      t.total_sales, t.churned, (t.churn_rate * 100).toFixed(2),
    ])
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'forecast.csv'
    a.click()
  }

  const visibleRows = showAll ? totals : totals.slice(0, BREAKDOWN_PREVIEW_ROWS)
  const hasMore = totals.length > BREAKDOWN_PREVIEW_ROWS

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-800">Monthly Breakdown — Forecast</h4>
        <button onClick={exportCsv} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-colors flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          Export CSV
        </button>
      </div>

      <div className="relative">
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Month', 'Subscribers', 'MRR', 'ARR', 'Total Sales', 'Churned', 'Churn %'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-right first:text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 bg-white">
                {visibleRows.map((t) => (
                  <tr key={t.date} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 font-medium whitespace-nowrap">{fmtDate(t.date)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900 font-mono">{fmt(t.subscribers)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900 font-mono">{fmt(t.mrr)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900 font-mono">{fmt(t.arr)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 font-mono">{fmt(t.total_sales)}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 font-mono">{fmt(t.churned)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 font-mono">{(t.churn_rate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Fade-out overlay when collapsed */}
        {hasMore && !showAll && (
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white to-transparent rounded-b-xl pointer-events-none" />
        )}
      </div>

      {/* Show all / collapse button */}
      {hasMore && (
        <div className="mt-3 text-center">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
          >
            {showAll ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
                Show fewer rows
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                Show all {totals.length} rows
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Serialize scenario for API (strip empty/null fields)
// ---------------------------------------------------------------------------
function serializeScenario(scenario, lastActualDate, newPlans = []) {
  const plan_overrides = {}
  for (const [key, levers] of Object.entries(scenario.plan_overrides)) {
    plan_overrides[key] = {
      yoy_rates: (levers.yoy_rates || []).filter((y) => y.sales_growth != null || y.churn_growth != null),
      price_changes: (levers.price_changes || [])
        .filter((p) => p.price !== '' && p.price != null)
        .map((p) => ({ month: p.month, price: parseFloat(p.price) })),
    }
  }
  const endYear = scenario.horizon_end_year ?? new Date().getFullYear() + 5
  const horizon_months = computeHorizonMonths(endYear, lastActualDate)
  const new_plans = newPlans
    .filter((np) => np.tier && np.plan && np.price != null && np.launch_month)
    .map((np) => {
      const key = `${np.tier}_${np.plan}`
      const overrideYoy = (scenario.plan_overrides[key]?.yoy_rates || [])
        .filter((y) => y.sales_growth != null || y.churn_growth != null)
      return {
        tier: np.tier,
        plan: np.plan,
        price: parseFloat(np.price) || 0,
        launch_month: np.launch_month,
        monthly_sales_schedule: (np.monthly_sales_schedule || []).map((v) => parseFloat(v) || 0),
        churn_rate_schedule: (np.churn_rate_schedule || []).map((v) => (parseFloat(v) || 0) / 100),
        yoy_rates: overrideYoy,
      }
    })
  return { ...scenario, horizon_months, plan_overrides, new_plans }
}

// ---------------------------------------------------------------------------
// Main Forecast page
// ---------------------------------------------------------------------------
const newScenario = () => ({
  id: '', name: 'Base Case', horizon_end_year: new Date().getFullYear() + 5,
  plan_overrides: {}, one_time_events: [], excluded_plans: [], created_at: '', updated_at: '',
})

export default function Forecast({ actualPlans, newPlans, onNewPlansChange }) {
  const [scenario, setScenario] = useState(newScenario())
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savedScenarios, setSavedScenarios] = useState([])
  const [saving, setSaving] = useState(false)
  const [startFilter, setStartFilter] = useState('all')
  const [chartGranularity, setChartGranularity] = useState('month')

  useEffect(() => {
    axios.get('/api/scenarios').then(({ data }) => setSavedScenarios(data)).catch(() => {})
  }, [])

  // Last date of actual data (pivot point between historical and forecast)
  const lastActualDate = useMemo(() => {
    let max = null
    actualPlans.forEach((p) => {
      ;(p.monthly_data || []).forEach((r) => { if (!max || r.date > max) max = r.date })
    })
    return max
  }, [actualPlans])

  // Start date from filter
  const startDate = useMemo(() => {
    const f = FILTERS.find((x) => x.id === startFilter)
    if (!f?.months || !lastActualDate) return null
    return subtractMonths(lastActualDate, f.months)
  }, [startFilter, lastActualDate])

  const firstForecastDate = result?.totals?.[0]?.date ?? null

  const allPlanMetas = useMemo(() => {
    const metas = actualPlans.map((p, i) => ({
      key: planKey(p), label: planLabel(p), color: PLAN_COLORS[i % PLAN_COLORS.length],
    }))
    // Append new plans (forecast-only, no historical data)
    const existingKeys = new Set(metas.map((m) => m.key))
    ;(newPlans || []).forEach((np, i) => {
      const key = `${np.tier}_${np.plan}`
      if (!existingKeys.has(key)) {
        const label = `${np.tier.charAt(0).toUpperCase() + np.tier.slice(1)} ${np.plan.charAt(0).toUpperCase() + np.plan.slice(1)} (new)`
        metas.push({ key, label, color: PLAN_COLORS[(actualPlans.length + i) % PLAN_COLORS.length] })
        existingKeys.add(key)
      }
    })
    return metas
  }, [actualPlans, newPlans])

  // planMetas used by charts: excludes toggled-off plans
  const excluded = useMemo(() => new Set(scenario.excluded_plans || []), [scenario.excluded_plans])
  const planMetas = useMemo(
    () => allPlanMetas.filter((m) => !excluded.has(m.key)),
    [allPlanMetas, excluded],
  )

  const chartData = useMemo(
    () => buildChartData(actualPlans, result, startDate),
    [actualPlans, result, startDate],
  )

  const displayChartData = useMemo(
    () => aggregateChartData(chartData, chartGranularity),
    [chartData, chartGranularity],
  )

  // In aggregated views the raw firstForecastDate may not exist as a tick,
  // so derive the reference line position from the aggregated data directly.
  const displayForecastDate = useMemo(
    () => displayChartData.find((d) => d.isProjected)?.date ?? null,
    [displayChartData],
  )

  const hasChartData = chartData.length > 0

  const runForecast = useCallback(async () => {
    if (actualPlans.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const payload = serializeScenario({ ...scenario, id: scenario.id || 'preview' }, lastActualDate, newPlans)
      const { data } = await axios.post('/api/forecast', payload)
      setResult(data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }, [scenario, lastActualDate, newPlans, actualPlans])

  // Auto-rerun when new plans are added/removed/changed
  const prevNewPlansRef = useRef(newPlans)
  useEffect(() => {
    if (prevNewPlansRef.current === newPlans) return
    prevNewPlansRef.current = newPlans
    if (actualPlans.length > 0) runForecast()
  }, [newPlans, actualPlans, runForecast])

  const saveScenario = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = serializeScenario(scenario, lastActualDate, newPlans)
      let saved
      if (scenario.id) {
        const { data: saveData } = await axios.put(`/api/scenarios/${scenario.id}`, payload)
        saved = saveData
      } else {
        const { data: saveData } = await axios.post('/api/scenarios', payload)
        saved = saveData
      }
      // Re-attach horizon_end_year (not round-tripped through backend)
      setScenario({ ...saved, horizon_end_year: scenario.horizon_end_year ?? new Date().getFullYear() + 5 })
      onNewPlansChange(saved.new_plans || [])
      const { data: listData } = await axios.get('/api/scenarios')
      setSavedScenarios(listData)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || String(err))
    }
    setSaving(false)
  }

  const deleteScenario = async (id) => {
    await axios.delete(`/api/scenarios/${id}`)
    const { data } = await axios.get('/api/scenarios')
    setSavedScenarios(data)
    if (scenario.id === id) { setScenario(newScenario()); onNewPlansChange([]) }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Saved scenarios sidebar */}
      <div className="w-44 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Scenarios</span>
          <button onClick={() => { setScenario(newScenario()); onNewPlansChange([]) }} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">+ New</button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {savedScenarios.length === 0 && (
            <p className="px-4 py-3 text-xs text-gray-400">No saved scenarios</p>
          )}
          {savedScenarios.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${scenario.id === s.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50 text-gray-700'}`}
              onClick={() => { setScenario({ ...s, horizon_end_year: s.horizon_end_year ?? new Date().getFullYear() + 5 }); onNewPlansChange(s.new_plans || []) }}
            >
              <span className="text-sm truncate">{s.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteScenario(s.id) }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-1 transition-opacity"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Lever editor */}
      <ScenarioEditor actualPlans={actualPlans} scenario={scenario} onChange={setScenario} newPlans={newPlans} allPlanMetas={allPlanMetas} />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 shrink-0">
          <div className="flex-1" />
          {error && <p className="text-xs text-red-600 mr-2">{error}</p>}
          <button
            onClick={saveScenario}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={runForecast}
            disabled={loading || actualPlans.length === 0}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            Run Forecast
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {actualPlans.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.519l2.74-1.22m0 0-5.94-2.28m5.94 2.28-2.28 5.941" /></svg>
              <p className="text-sm text-gray-500">Upload actuals CSV files to get started</p>
            </div>
          )}

          {/* KPI strip — only after forecast */}
          {/* Charts — always visible once data is loaded */}
          {hasChartData && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <StartFilter value={startFilter} onChange={setStartFilter} />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400 mr-1">Step</span>
                    {[
                      { id: 'month', label: 'Monthly' },
                      { id: 'quarter', label: 'Quarterly' },
                      { id: 'year', label: 'Yearly' },
                    ].map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setChartGranularity(g.id)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          chartGranularity === g.id
                            ? 'bg-gray-900 text-white'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                  {!result && (
                    <span className="text-xs text-gray-400">Run a forecast to see projections</span>
                  )}
                </div>
                {result && (
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-5 border-t-2 border-gray-400" />
                      Actual
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-5 border-t-2 border-dashed border-gray-400" />
                      Forecast
                    </span>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                <h4 className="text-sm font-semibold text-gray-800 mb-4">MRR by Plan</h4>
                <MrrChart chartData={displayChartData} planMetas={planMetas} firstForecastDate={displayForecastDate} granularity={chartGranularity} />
              </div>

              <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                <h4 className="text-sm font-semibold text-gray-800 mb-4">Subscribers by Plan</h4>
                <SubsChart chartData={displayChartData} planMetas={planMetas} firstForecastDate={displayForecastDate} granularity={chartGranularity} />
              </div>
            </>
          )}

          {/* Breakdown table — only after forecast */}
          {result && (
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <BreakdownTable totals={result.totals} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
