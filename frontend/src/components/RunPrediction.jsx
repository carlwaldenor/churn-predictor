import { useEffect, useRef, useState } from 'react'
import axios from 'axios'

const FILE_TYPE_KEYS = ['monthly_cohorts', 'annual_cohorts', 'daily_growth_monthly', 'daily_growth_annual']

const YM_RE = /^\d{4}-\d{2}$/

function InputField({ label, hint, type = 'text', value, onChange, placeholder, badge, loading }) {
  const autofilled = !!badge
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        {loading ? (
          <span className="inline-flex items-center gap-1 text-xs bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">
            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Loading…
          </span>
        ) : badge ? (
          <span className="text-xs bg-indigo-100 text-indigo-600 rounded px-1.5 py-0.5 font-medium">
            {badge}
          </span>
        ) : null}
      </div>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-auto w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${
          autofilled
            ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
            : 'border-gray-300 bg-white text-gray-900 placeholder-gray-400'
        }`}
      />
    </div>
  )
}

export default function RunPrediction({ inputs, setInputs, onPredict, loading, error, csvStatus }) {
  const allLoaded = FILE_TYPE_KEYS.every((k) => csvStatus[k]?.exists)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Track which month's voluntary churn was auto-filled so we can show the badge
  const [autoFilledMonth, setAutoFilledMonth] = useState(null)
  const [voluntarySyncedAt, setVoluntarySyncedAt] = useState(null)
  const [loadingVoluntary, setLoadingVoluntary] = useState(false)
  const lastFetchedMonth = useRef(null)

  // Track which month's defaults (opening_balance, total_churn, new_sales) were auto-filled
  const [autoFilledDefaultsMonth, setAutoFilledDefaultsMonth] = useState(null)
  const [defaultsFetchedAt, setDefaultsFetchedAt] = useState(null)
  const [loadingDefaults, setLoadingDefaults] = useState(false)
  const lastFetchedDefaultsMonth = useRef(null)

  const DEFAULTS_FIELDS = ['opening_balance', 'reported_total_churn', 'new_sales']

  function fmtDate(isoString) {
    if (!isoString) return null
    const d = new Date(isoString)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  const update = (key) => (val) => {
    setInputs((prev) => ({ ...prev, [key]: val }))
    if (key === 'reported_voluntary_churn') {
      setAutoFilledMonth(null)
      setVoluntarySyncedAt(null)
    }
    if (DEFAULTS_FIELDS.includes(key)) {
      setAutoFilledDefaultsMonth(null)
      setDefaultsFetchedAt(null)
    }
  }

  const currentMonth = inputs.analysis_month?.trim()
  const voluntaryBadge = autoFilledMonth === currentMonth
    ? `ChartMogul${voluntarySyncedAt ? ' · ' + fmtDate(voluntarySyncedAt) : ''}` : null
  const defaultsBadge = autoFilledDefaultsMonth === currentMonth
    ? `ChartMogul${defaultsFetchedAt ? ' · ' + fmtDate(defaultsFetchedAt) : ''}` : null

  // When analysis_month changes to a valid YYYY-MM, fetch the stored churn actual
  useEffect(() => {
    const month = inputs.analysis_month?.trim()
    if (!month || !YM_RE.test(month) || month === lastFetchedMonth.current) return

    lastFetchedMonth.current = month
    setLoadingVoluntary(true)

    axios.get(`/api/churn-actual/${month}`)
      .then(({ data }) => {
        if (month !== lastFetchedMonth.current) return
        if (data.found) {
          setInputs((prev) => ({ ...prev, reported_voluntary_churn: String(data.voluntary_churn) }))
          setAutoFilledMonth(month)
          setVoluntarySyncedAt(data.synced_at || null)
        }
        setLoadingVoluntary(false)
      })
      .catch(() => { if (month === lastFetchedMonth.current) setLoadingVoluntary(false) })
  }, [inputs.analysis_month]) // eslint-disable-line react-hooks/exhaustive-deps

  // When analysis_month changes, also fetch opening balance, total churn, and new sales live
  useEffect(() => {
    const month = inputs.analysis_month?.trim()
    if (!month || !YM_RE.test(month) || month === lastFetchedDefaultsMonth.current) return

    lastFetchedDefaultsMonth.current = month
    setLoadingDefaults(true)

    axios.get(`/api/month-defaults/${month}`)
      .then(({ data }) => {
        if (month !== lastFetchedDefaultsMonth.current) return
        setInputs((prev) => ({
          ...prev,
          ...(data.opening_balance != null ? { opening_balance: String(data.opening_balance) } : {}),
          ...(data.reported_total_churn != null ? { reported_total_churn: String(data.reported_total_churn) } : {}),
          ...(data.new_sales != null ? { new_sales: String(data.new_sales) } : {}),
        }))
        setAutoFilledDefaultsMonth(month)
        setDefaultsFetchedAt(new Date().toISOString())
        setLoadingDefaults(false)
      })
      .catch(() => { if (month === lastFetchedDefaultsMonth.current) setLoadingDefaults(false) })
  }, [inputs.analysis_month]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Run Prediction</h2>
        <p className="text-sm text-gray-500 mt-1">
          Enter the runtime parameters and click Run Prediction. Values are saved automatically.
        </p>
      </div>

      {!allLoaded && (
        <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Upload all four CSV files on the <strong>Data Files</strong> tab before running a prediction.
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <InputField
            label="Analysis Month"
            hint="The month you're predicting churn for (YYYY-MM)"
            value={inputs.analysis_month}
            onChange={update('analysis_month')}
            placeholder="2025-02"
          />
          <InputField
            label="Current Date"
            hint="Today's date (YYYY-MM-DD) — used to compute T-pivot"
            value={inputs.current_date}
            onChange={update('current_date')}
            placeholder="2025-02-15"
          />
          <InputField
            label="Opening Balance"
            hint="Active subscribers at start of analysis month"
            type="number"
            value={inputs.opening_balance}
            onChange={update('opening_balance')}
            placeholder="10000"
            badge={defaultsBadge}
            loading={loadingDefaults}
          />
          <InputField
            label="New Sales"
            hint="Total new subscribers + reactivations for the analysis month (from ChartMogul unfiltered)"
            type="number"
            value={inputs.new_sales}
            onChange={update('new_sales')}
            placeholder="1500"
            badge={defaultsBadge}
            loading={loadingDefaults}
          />
          <InputField
            label="Reported Voluntary Churn"
            hint="Intentional cancellations — auto-filled from ChartMogul when available"
            type="number"
            value={inputs.reported_voluntary_churn}
            onChange={update('reported_voluntary_churn')}
            placeholder="80"
            badge={voluntaryBadge}
            loading={loadingVoluntary}
          />
          <InputField
            label="Reported Total Churn"
            hint="Total churned subscribers reported so far (from ChartMogul/Stripe)"
            type="number"
            value={inputs.reported_total_churn}
            onChange={update('reported_total_churn')}
            placeholder="250"
            badge={defaultsBadge}
            loading={loadingDefaults}
          />
        </div>

        {error && (
          <div className="mt-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={onPredict}
            disabled={loading || !allLoaded}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-colors ${
              loading || !allLoaded
                ? 'bg-indigo-300 text-white cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
            }`}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Running…
              </>
            ) : (
              'Run Prediction'
            )}
          </button>
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <svg
              className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Advanced settings
          </button>
        </div>

        {advancedOpen && (
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 pt-5 border-t border-gray-100">
            <InputField
              label="Dunning Duration (days)"
              hint="Number of days your dunning process runs before a subscriber is marked churned"
              type="number"
              value={inputs.dunning_duration}
              onChange={update('dunning_duration')}
              placeholder="30"
            />
            <InputField
              label="Annual Risk Weight"
              hint="Multiplier for annual subscription failure rate relative to monthly (default 2.0)"
              type="number"
              value={inputs.annual_risk_weight}
              onChange={update('annual_risk_weight')}
              placeholder="2.0"
            />
          </div>
        )}
      </div>
    </div>
  )
}
