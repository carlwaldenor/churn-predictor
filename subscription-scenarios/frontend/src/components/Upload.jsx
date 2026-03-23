import { useState, useRef } from 'react'
import axios from 'axios'

function SavedFilesPanel({ plans }) {
  if (plans.length === 0) return null

  return (
    <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-emerald-100">
        <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <p className="text-sm font-semibold text-emerald-800">
          {plans.length} file{plans.length !== 1 ? 's' : ''} saved &amp; loaded
        </p>
        <span className="ml-auto text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
          Auto-loads on restart
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-emerald-50 border-b border-emerald-100">
          <tr>
            {['File', 'Tier', 'Plan', 'Type', 'Rows', 'Date range'].map((h) => (
              <th key={h} className="px-4 py-2 text-left text-xs font-medium text-emerald-700">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-emerald-100 bg-white/60">
          {plans.map((p) => (
            <tr key={p.key}>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                {p.tier}_{p.plan}_{p.row_type}.csv
              </td>
              <td className="px-4 py-2.5 text-gray-800 capitalize">{p.tier}</td>
              <td className="px-4 py-2.5 text-gray-800 capitalize">{p.plan}</td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.row_type === 'actuals' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                }`}>{p.row_type}</span>
              </td>
              <td className="px-4 py-2.5 text-gray-600">{p.row_count}</td>
              <td className="px-4 py-2.5 text-gray-500 text-xs font-mono">{p.date_range}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Upload({ plans = [], onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef()

  const upload = async (files) => {
    if (!files || files.length === 0) return
    setLoading(true)
    setResults(null)
    const form = new FormData()
    for (const f of files) form.append('files', f)
    try {
      const { data } = await axios.post('/api/upload', form)
      setResults(data)
      onUploaded()
    } catch (err) {
      setResults({ imported: [], errors: [{ filename: '—', error: err.response?.data?.detail || err.message }] })
    } finally {
      setLoading(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    upload(e.dataTransfer.files)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Upload Data Files</h2>
      <p className="text-sm text-gray-500 mb-6">
        Upload actuals CSV files. Name them{' '}
        <code className="bg-gray-100 px-1 rounded text-xs">{'{tier}_{plan}_actuals.csv'}</code>.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors ${
          dragging ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300 hover:border-emerald-400 hover:bg-gray-50'
        }`}
      >
        <svg className="w-10 h-10 mx-auto mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-sm font-medium text-gray-700">
          {plans.length > 0 ? 'Drop files here to add or replace' : 'Drop CSV files here or click to browse'}
        </p>
        <p className="text-xs text-gray-400 mt-1">Multiple files supported</p>
        <input ref={inputRef} type="file" accept=".csv" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </div>

      {plans.length > 0 && <div className="mt-8"><SavedFilesPanel plans={plans} /></div>}

      {loading && (
        <div className="mt-6 text-sm text-gray-500 flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Parsing files…
        </div>
      )}

      {results && (
        <div className="mt-6 space-y-4">
          {results.imported.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                {results.imported.length} file{results.imported.length !== 1 ? 's' : ''} imported
              </p>
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['File', 'Tier', 'Plan', 'Type', 'Rows', 'Price'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {results.imported.map((r) => (
                      <tr key={r.filename}>
                        <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{r.filename}</td>
                        <td className="px-4 py-2.5 text-gray-900 capitalize">{r.tier}</td>
                        <td className="px-4 py-2.5 text-gray-900 capitalize">{r.plan}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.row_type === 'actuals' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                          }`}>{r.row_type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{r.rows}</td>
                        <td className="px-4 py-2.5 text-gray-600">{r.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {results.errors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-600 mb-2">
                {results.errors.length} error{results.errors.length !== 1 ? 's' : ''}
              </p>
              <div className="rounded-xl border border-red-200 bg-red-50 divide-y divide-red-100">
                {results.errors.map((e, i) => (
                  <div key={i} className="px-4 py-2.5 text-sm">
                    <span className="font-medium text-red-700">{e.filename}</span>
                    <span className="text-red-600 ml-2">— {e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
