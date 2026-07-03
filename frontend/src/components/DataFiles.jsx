import { useRef, useState } from 'react'
import axios from 'axios'

const FILE_TYPES = [
  {
    key: 'monthly_cohorts',
    label: 'Monthly Cohorts',
    description: 'Columns: signup_month (YYYY-MM), cohort_size, t1…tN (cumulative churn per month age)',
    manual: true,
  },
  {
    key: 'annual_cohorts',
    label: 'Annual Cohorts',
    description: 'Columns: signup_month (YYYY-MM), cohort_size, t1…tN (cumulative churn per month age)',
    manual: true,
  },
  {
    key: 'daily_growth_monthly',
    label: 'Daily Growth — Monthly',
    description: 'Columns: date (YYYY-MM-DD), new_subscriber_count, reactivation_count',
    synced: true,
  },
  {
    key: 'daily_growth_annual',
    label: 'Daily Growth — Annual',
    description: 'Columns: date (YYYY-MM-DD), new_subscriber_count, reactivation_count',
    synced: true,
  },
  {
    key: 'historical_churn',
    label: 'Historical Churn (optional)',
    description: 'Monthly customer churn rate. Enables the year-over-year chart on the Results tab.',
    synced: true,
  },
  {
    key: 'payment_failures',
    label: 'Payment Failures (optional)',
    description: 'Monthly Stripe payment failure rates. Columns: month (YYYY-MM), total_renewals, total_payment_failures.',
    manual: true,
  },
]

// Files the sync button covers
const SYNCED_KEYS = FILE_TYPES.filter(f => f.synced).map(f => f.key)

// ---------------------------------------------------------------------------
// ChartMogul sync panel
// ---------------------------------------------------------------------------

function SyncPanel({ onSyncComplete }) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult]   = useState(null)  // { ok, message }

  const handleSync = async () => {
    setSyncing(true)
    setResult(null)
    try {
      const { data } = await axios.post('/api/sync-chartmogul')
      const counts = data.synced_row_counts || {}
      const lines = Object.entries(counts).map(
        ([k, n]) => `${k.replace(/_/g, ' ')}: ${n.toLocaleString()} rows`
      )
      setResult({ ok: true, message: `Synced — ${lines.join(' · ')}` })
      onSyncComplete()
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Sync failed'
      setResult({ ok: false, message: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-indigo-900">Sync from ChartMogul</h3>
          <p className="mt-1 text-xs text-indigo-700 leading-relaxed">
            Automatically fetches <strong>Daily Growth (Monthly &amp; Annual)</strong> and{' '}
            <strong>Historical Churn</strong> directly from the ChartMogul API.
            Requires <code className="bg-indigo-100 px-1 rounded">CHARTMOGUL_API_KEY</code> set on the server.
          </p>
          <p className="mt-1 text-xs text-indigo-500">
            Cohort files still require a manual CSV export from ChartMogul's UI.
          </p>
          {result && (
            <p className={`mt-2 text-xs font-medium ${result.ok ? 'text-green-700' : 'text-red-700'}`}>
              {result.ok ? '✓ ' : '✗ '}{result.message}
            </p>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {syncing ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Syncing…
            </>
          ) : (
            'Sync Now'
          )}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload box (manual files)
// ---------------------------------------------------------------------------

function UploadBox({ fileType, label, description, status, synced, onUploadComplete }) {
  const inputRef = useRef(null)
  const [dragging, setDragging]     = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState(null)

  const uploadFile = async (file) => {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const formData = new FormData()
    formData.append('file_type', fileType)
    formData.append('file', file)
    try {
      await axios.post('/api/upload-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onUploadComplete()
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Upload failed'
      setUploadError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    uploadFile(e.dataTransfer.files[0])
  }

  const handleFileChange = (e) => {
    uploadFile(e.target.files[0])
    e.target.value = ''
  }

  const loaded    = status?.exists
  const rowCount  = status?.row_count

  return (
    <div
      className={`relative rounded-xl border-2 transition-colors cursor-pointer ${
        dragging
          ? 'border-indigo-400 bg-indigo-50'
          : loaded
          ? 'border-green-300 bg-green-50'
          : 'border-dashed border-gray-300 bg-white hover:border-gray-400'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-800">{label}</p>
              {synced && (
                <span className="text-xs bg-indigo-100 text-indigo-600 rounded px-1.5 py-0.5 font-medium">
                  API
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
          </div>
          <div className="shrink-0 mt-0.5">
            {uploading ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Uploading
              </span>
            ) : loaded ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                ✓ Loaded · {rowCount?.toLocaleString()} rows
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Not uploaded
              </span>
            )}
          </div>
        </div>
        {!uploading && (
          <p className="mt-3 text-xs text-gray-400">
            {loaded ? 'Click or drag to replace' : 'Click or drag a CSV file here'}
          </p>
        )}
        {uploadError && (
          <p className="mt-2 text-xs text-red-600">{uploadError}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DataFiles({ csvStatus, onUploadComplete }) {
  const requiredKeys = ['monthly_cohorts', 'annual_cohorts', 'daily_growth_monthly', 'daily_growth_annual']
  const allLoaded = requiredKeys.every((k) => csvStatus[k]?.exists)

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Data Files</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload cohort CSVs manually and sync the rest from ChartMogul.
        </p>
      </div>

      {allLoaded && (
        <div className="mb-5 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 font-medium">
          ✓ All four files loaded — you can now run a prediction.
        </div>
      )}

      <SyncPanel onSyncComplete={onUploadComplete} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FILE_TYPES.map((ft) => (
          <UploadBox
            key={ft.key}
            fileType={ft.key}
            label={ft.label}
            description={ft.description}
            status={csvStatus[ft.key]}
            synced={ft.synced}
            onUploadComplete={onUploadComplete}
          />
        ))}
      </div>
    </div>
  )
}
