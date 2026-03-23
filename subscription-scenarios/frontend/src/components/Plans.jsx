import { useState } from 'react'
import axios from 'axios'

const TYPE_STYLE = {
  actuals: 'bg-blue-50 text-blue-700',
  budget: 'bg-amber-50 text-amber-700',
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function addMonths(ym, n) {
  let [y, m] = ym
  m += n
  while (m > 12) { m -= 12; y++ }
  return [y, m]
}

function formatYM([y, m]) {
  return `${y}-${String(m).padStart(2, '0')}`
}

function parseYM(str) {
  return [parseInt(str.slice(0, 4)), parseInt(str.slice(5, 7))]
}

function generateLaunchOptions(lastActualDate) {
  const base = lastActualDate
    ? addMonths(parseYM(lastActualDate), 1)
    : [new Date().getFullYear(), new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2]
  return Array.from({ length: 60 }, (_, i) => {
    const ym = addMonths(base, i)
    return { value: formatYM(ym), label: `${MONTH_NAMES[ym[1] - 1]} ${ym[0]}` }
  })
}

// Quarterly plans need 15 months: 3 locked (no churn) + 12 real
const scheduleLen = (plan) => plan === 'quarterly' ? 15 : 12

function computeMonthLabels(launchMonth, count = 12) {
  if (!launchMonth) return Array.from({ length: count }, (_, i) => `Month ${i + 1}`)
  const base = parseYM(launchMonth)
  return Array.from({ length: count }, (_, i) => {
    const ym = addMonths(base, i)
    return `${MONTH_NAMES[ym[1] - 1]} ${ym[0]}`
  })
}

function resizeSchedules(draft, newPlan) {
  const newLen = scheduleLen(newPlan)
  const sales = [...draft.monthly_sales_schedule]
  const churn = [...draft.churn_rate_schedule]
  while (sales.length < newLen) sales.push('')
  while (churn.length < newLen) churn.push('3')
  // Lock first 3 churn rows to '0' for quarterly
  const churnOut = churn.slice(0, newLen)
  if (newPlan === 'quarterly') { churnOut[0] = '0'; churnOut[1] = '0'; churnOut[2] = '0' }
  return { monthly_sales_schedule: sales.slice(0, newLen), churn_rate_schedule: churnOut }
}

const emptyDraft = (defaultLaunchMonth) => ({
  tier: '', plan: 'monthly', price: '', launch_month: defaultLaunchMonth,
  monthly_sales_schedule: Array(12).fill(''),
  churn_rate_schedule: Array(12).fill('3'),
})

// ---------------------------------------------------------------------------
// Creation form only — no list here
// ---------------------------------------------------------------------------
function NewPlanBuilder({ newPlans, onNewPlansChange, lastActualDate }) {
  const launchOptions = generateLaunchOptions(lastActualDate)
  const defaultLaunch = launchOptions[0]?.value ?? ''
  const [draft, setDraft] = useState(emptyDraft(defaultLaunch))

  const setDraftField = (field, val) => setDraft((d) => {
    const next = { ...d, [field]: val }
    if (field === 'plan') Object.assign(next, resizeSchedules(d, val))
    return next
  })
  const setSalesRow = (i, val) => setDraft((d) => {
    const s = [...d.monthly_sales_schedule]; s[i] = val; return { ...d, monthly_sales_schedule: s }
  })
  const setChurnRow = (i, val) => setDraft((d) => {
    const c = [...d.churn_rate_schedule]; c[i] = val; return { ...d, churn_rate_schedule: c }
  })

  const schedLen = scheduleLen(draft.plan)
  const monthLabels = computeMonthLabels(draft.launch_month, schedLen)
  const priceSuffix = draft.plan === 'annual' ? '/yr' : '/mo'

  const handleAdd = () => {
    if (!draft.tier.trim() || !draft.price) return
    onNewPlansChange([...newPlans, { ...draft, yoy_rates: [] }])
    setDraft(emptyDraft(defaultLaunch))
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Plan</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-sm font-medium text-gray-700">Define a forecast-only plan</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tier</label>
              <input type="text" value={draft.tier} onChange={(e) => setDraftField('tier', e.target.value)} placeholder="e.g. elite"
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={draft.plan} onChange={(e) => setDraftField('plan', e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Price</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={draft.price} onChange={(e) => setDraftField('price', e.target.value)} placeholder="0.00"
                  className="w-full rounded border border-gray-200 px-2 py-1.5 pr-8 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{priceSuffix}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Launch month</label>
              <select value={draft.launch_month} onChange={(e) => setDraftField('launch_month', e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                {launchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {draft.plan === 'quarterly' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Quarterly plans require 15 months of inputs. Months 1–3 have no churn (subscribers are locked in their first quarter). Months 4–15 represent real churn, and Year 2+ growth rates are based on the average of those 12 months.
            </p>
          )}
          <div className="overflow-auto rounded border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-28">Month</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">New subs</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Churn %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {Array.from({ length: schedLen }, (_, i) => {
                  const isLocked = draft.plan === 'quarterly' && i < 3
                  const isBoundary = draft.plan === 'quarterly' && i === 3
                  return (
                    <tr key={i} className={`${i % 2 === 0 ? '' : 'bg-gray-50/50'}${isBoundary ? ' border-t-2 border-amber-300' : ''}`}>
                      <td className="px-3 py-1.5 text-xs font-medium">
                        <span className={isLocked ? 'text-amber-600' : 'text-gray-500'}>{monthLabels[i]}</span>
                        {isLocked && <span className="ml-1 text-[10px] text-amber-500">(Q1 lock-in)</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="text" inputMode="numeric" value={draft.monthly_sales_schedule[i]} onChange={(e) => setSalesRow(i, e.target.value)} placeholder="0"
                          className="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      </td>
                      <td className="px-3 py-1.5">
                        {isLocked ? (
                          <span className="inline-block w-24 px-2 py-1 text-xs text-amber-500 bg-amber-50 border border-amber-200 rounded text-center">0% locked</span>
                        ) : (
                          <div className="relative w-24">
                            <input type="text" inputMode="decimal" value={draft.churn_rate_schedule[i]} onChange={(e) => setChurnRow(i, e.target.value)} placeholder="3"
                              className="w-full rounded border border-gray-200 px-2 py-1 pr-5 text-xs text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] pointer-events-none">%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button onClick={handleAdd} disabled={!draft.tier.trim() || !draft.price}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
              Add Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline edit panel rendered as a full-width <tr>
// ---------------------------------------------------------------------------
function NewPlanEditRow({ np, colSpan, launchOptions, onSave, onCancel }) {
  const [buf, setBuf] = useState(() => JSON.parse(JSON.stringify(np)))
  const suffix = buf.plan === 'annual' ? '/yr' : '/mo'
  const editSchedLen = scheduleLen(buf.plan)
  const labels = computeMonthLabels(buf.launch_month, editSchedLen)
  const setField = (field, val) => setBuf((b) => {
    const next = { ...b, [field]: val }
    if (field === 'plan') Object.assign(next, resizeSchedules(b, val))
    return next
  })
  const setSales = (i, val) => setBuf((b) => { const s = [...b.monthly_sales_schedule]; s[i] = val; return { ...b, monthly_sales_schedule: s } })
  const setChurn = (i, val) => setBuf((b) => { const c = [...b.churn_rate_schedule]; c[i] = val; return { ...b, churn_rate_schedule: c } })

  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-4 bg-gray-50 border-t border-gray-100">
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tier</label>
              <input type="text" value={buf.tier} onChange={(e) => setField('tier', e.target.value)}
                className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={buf.plan} onChange={(e) => setField('plan', e.target.value)}
                className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Price</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={buf.price} onChange={(e) => setField('price', e.target.value)}
                  className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 pr-8 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{suffix}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Launch month</label>
              <select value={buf.launch_month} onChange={(e) => setField('launch_month', e.target.value)}
                className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                {launchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {buf.plan === 'quarterly' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Quarterly plans require 15 months of inputs. Months 1–3 have no churn (subscribers are locked in their first quarter). Months 4–15 represent real churn, and Year 2+ growth rates are based on the average of those 12 months.
            </p>
          )}
          <div className="overflow-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-white border-b border-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-28">Month</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">New subs</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Churn %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Array.from({ length: editSchedLen }, (_, i) => {
                  const isLocked = buf.plan === 'quarterly' && i < 3
                  const isBoundary = buf.plan === 'quarterly' && i === 3
                  return (
                    <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}${isBoundary ? ' border-t-2 border-amber-300' : ''}`}>
                      <td className="px-3 py-1.5 text-xs font-medium">
                        <span className={isLocked ? 'text-amber-600' : 'text-gray-500'}>{labels[i]}</span>
                        {isLocked && <span className="ml-1 text-[10px] text-amber-500">(Q1 lock-in)</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="text" inputMode="numeric" value={buf.monthly_sales_schedule[i] ?? ''} onChange={(e) => setSales(i, e.target.value)}
                          className="w-24 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      </td>
                      <td className="px-3 py-1.5">
                        {isLocked ? (
                          <span className="inline-block w-24 px-2 py-1 text-xs text-amber-500 bg-amber-50 border border-amber-200 rounded text-center">0% locked</span>
                        ) : (
                          <div className="relative w-24">
                            <input type="text" inputMode="decimal" value={buf.churn_rate_schedule[i] ?? ''} onChange={(e) => setChurn(i, e.target.value)}
                              className="w-full rounded border border-gray-200 bg-white px-2 py-1 pr-5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] pointer-events-none">%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-sm transition-colors">Cancel</button>
            <button onClick={() => onSave(buf)} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">
              Save changes
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main Plans page
// ---------------------------------------------------------------------------
export default function Plans({ plans, onCleared, newPlans, onNewPlansChange, lastActualDate }) {
  const [editingNpKey, setEditingNpKey] = useState(null) // "tier|plan|idx"
  const launchOptions = generateLaunchOptions(lastActualDate)

  const handleClear = async () => {
    if (!confirm('Remove all loaded plans?')) return
    await axios.delete('/api/plans')
    onCleared()
  }

  const handleNpSave = (idx, updated) => {
    const arr = [...newPlans]
    arr[idx] = updated
    onNewPlansChange(arr)
    setEditingNpKey(null)
  }

  const handleNpRemove = (idx) => {
    onNewPlansChange(newPlans.filter((_, i) => i !== idx))
    setEditingNpKey(null)
  }

  // Merge CSV tiers and new-plan tiers
  const allTiers = [...new Set([...plans.map((p) => p.tier), ...newPlans.map((np) => np.tier)])].sort()
  const hasCsvPlans = plans.length > 0

  const COL_COUNT = 6 // Plan, Type, Date range, Rows, Price, Actions

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Loaded Plans</h2>
          {hasCsvPlans && (
            <p className="text-sm text-gray-500 mt-0.5">
              {plans.length} file{plans.length !== 1 ? 's' : ''} across {[...new Set(plans.map((p) => p.tier))].length} tier{[...new Set(plans.map((p) => p.tier))].length !== 1 ? 's' : ''}
              {newPlans.length > 0 ? ` + ${newPlans.length} new` : ''}
            </p>
          )}
          {!hasCsvPlans && newPlans.length === 0 && (
            <p className="text-sm text-gray-500 mt-0.5">No plans loaded yet — upload CSV files on the Data tab.</p>
          )}
        </div>
        {hasCsvPlans && (
          <button onClick={handleClear} className="text-sm text-red-600 hover:text-red-700 transition-colors">Clear all</button>
        )}
      </div>

      {allTiers.length > 0 && (
        <div className="space-y-5">
          {allTiers.map((tier) => {
            const csvRows = plans.filter((p) => p.tier === tier)
            const npRows = newPlans.map((np, i) => ({ np, i })).filter(({ np }) => np.tier === tier)
            return (
              <div key={tier} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-800 capitalize">{tier}</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100">
                    <tr>
                      {['Plan', 'Type', 'Date range', 'Rows', 'Price', ''].map((h, i) => (
                        <th key={i} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {/* CSV-uploaded rows */}
                    {csvRows.map((p) => (
                      <tr key={p.key}>
                        <td className="px-4 py-2.5 text-gray-900 capitalize font-medium">{p.plan}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[p.row_type] || 'bg-gray-100 text-gray-600'}`}>
                            {p.row_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{p.date_range}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.row_count}</td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {p.price.toFixed(2)}
                          <span className="text-gray-400 text-xs ml-0.5">{p.plan?.toLowerCase() === 'annual' ? '/yr' : '/mo'}</span>
                        </td>
                        <td className="px-4 py-2.5" />
                      </tr>
                    ))}

                    {/* New (forecast-only) plan rows */}
                    {npRows.map(({ np, i }) => {
                      const key = `${tier}|${np.plan}|${i}`
                      const isEditing = editingNpKey === key
                      const priceSuffix = np.plan === 'annual' ? '/yr' : '/mo'
                      return (
                        <>
                          <tr key={key} className="bg-emerald-50/40">
                            <td className="px-4 py-2.5 text-gray-900 capitalize font-medium">{np.plan}</td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">new</span>
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs">
                              from {MONTH_NAMES[parseInt(np.launch_month.slice(5)) - 1]} {np.launch_month.slice(0, 4)}
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">12 mo</td>
                            <td className="px-4 py-2.5 text-gray-600">
                              {parseFloat(np.price).toFixed(2)}
                              <span className="text-gray-400 text-xs ml-0.5">{priceSuffix}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-3 justify-end">
                                <button
                                  onClick={() => setEditingNpKey(isEditing ? null : key)}
                                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-colors"
                                >
                                  {isEditing ? 'Close' : 'Edit'}
                                </button>
                                <button onClick={() => handleNpRemove(i)} className="text-gray-400 hover:text-red-500 transition-colors">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isEditing && (
                            <NewPlanEditRow
                              key={`${key}-edit`}
                              np={np}
                              colSpan={COL_COUNT}
                              launchOptions={launchOptions}
                              onSave={(updated) => handleNpSave(i, updated)}
                              onCancel={() => setEditingNpKey(null)}
                            />
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      <NewPlanBuilder newPlans={newPlans} onNewPlansChange={onNewPlansChange} lastActualDate={lastActualDate} />
    </div>
  )
}
