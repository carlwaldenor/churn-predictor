import { useRef, useState } from 'react'
import axios from 'axios'

const FILE_TYPES = [
  {
    key: 'monthly_cohorts',
    label: 'Monthly Cohorts',
    description: 'Columns: signup_month (YYYY-MM), cohort_size, t1…tN (cumulative churn per month age)',
  },
  {
    key: 'annual_cohorts',
    label: 'Annual Cohorts',
    description: 'Columns: signup_month (YYYY-MM), cohort_size, t1…tN (cumulative churn per month age)',
  },
  {
    key: 'daily_growth_monthly',
    label: 'Daily Growth — Monthly',
    description: 'Columns: date (YYYY-MM-DD), new_subscriber_count, reactivation_count',
  },
  {
    key: 'daily_growth_annual',
    label: 'Daily Growth — Annual',
    description: 'Columns: date (YYYY-MM-DD), new_subscriber_count, reactivation_count',
  },
  {
    key: 'historical_churn',
    label: 'Historical Churn (optional)',
    description: 'ChartMogul monthly churn export. Columns: date, customer_churn_rate. Enables the year-over-year comparison chart on the Results tab.',
  },
]

function UploadBox({ fileType, label, description, status, onUploadComplete }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
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
    const file = e.dataTransfer.files[0]
    uploadFile(file)
  }

  const handleFileChange = (e) => {
    uploadFile(e.target.files[0])
    e.target.value = ''
  }

  const loaded = status?.exists
  const rowCount = status?.row_count

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
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">{label}</p>
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

export default function DataFiles({ csvStatus, onUploadComplete }) {
  const allLoaded = FILE_TYPES.every((ft) => csvStatus[ft.key]?.exists)

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Data Files</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload all four CSV files before running a prediction. Files are persisted on the server and survive restarts.
        </p>
      </div>

      {allLoaded && (
        <div className="mb-5 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 font-medium">
          ✓ All four files loaded — you can now run a prediction.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FILE_TYPES.map((ft) => (
          <UploadBox
            key={ft.key}
            fileType={ft.key}
            label={ft.label}
            description={ft.description}
            status={csvStatus[ft.key]}
            onUploadComplete={onUploadComplete}
          />
        ))}
      </div>
    </div>
  )
}
