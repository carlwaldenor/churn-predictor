import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { supabase } from './lib/supabase.js'
import LoginPage from './components/LoginPage.jsx'
import LandingPage from './components/LandingPage.jsx'
import SubscriptionForecaster from './components/SubscriptionForecaster.jsx'
import DataFiles from './components/DataFiles.jsx'
import RunPrediction from './components/RunPrediction.jsx'
import Results from './components/Results.jsx'
import Walkthrough from './components/Walkthrough.jsx'
import RenewalPools from './components/RenewalPools.jsx'

const TABS = ['Data Files', 'Run Prediction', 'Results', 'Renewal Pools', 'Walkthrough']

// Default inputs
const getLastMonth = () => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const getToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DEFAULT_INPUTS = {
  analysis_month: getLastMonth(),
  current_date: getToday(),
  opening_balance: '',
  new_sales: '',
  reported_total_churn: '',
  reported_voluntary_churn: '',
  dunning_duration: 30,
  annual_risk_weight: 2.0,
}

function loadInputsFromStorage() {
  try {
    const raw = localStorage.getItem('churn_predictor_inputs')
    if (raw) return { ...DEFAULT_INPUTS, ...JSON.parse(raw), current_date: getToday() }
  } catch {}
  return DEFAULT_INPUTS
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [currentApp, setCurrentApp] = useState(null) // null = landing page
  const [activeTab, setActiveTab] = useState('Data Files')
  const [csvStatus, setCsvStatus] = useState({})
  const [inputs, setInputs] = useState(loadInputsFromStorage)
  const [prediction, setPrediction] = useState(null)
  const [predictionInputs, setPredictionInputs] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savedRuns, setSavedRuns] = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/csv-status')
      setCsvStatus(data)
    } catch {}
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  // Deduplicate saved runs — keep only the most recent entry per analysis_month
  const dedupeRuns = (runs) =>
    runs.filter((r, i, arr) => arr.findIndex(x => x.analysis_month === r.analysis_month) === i)

  // Load saved prediction runs once the user is authenticated
  useEffect(() => {
    if (!session) return
    axios.get('/api/prediction-runs')
      .then(({ data }) => {
        setSavedRuns(dedupeRuns(data))
        // Restore most-recent prediction on first load if nothing is in state
        if (data.length > 0) {
          setPrediction(prev => prev ?? data[0].breakdown)
          setPredictionInputs(prev => prev ?? data[0].inputs)
        }
      })
      .catch(() => {})
  }, [session])

  // Persist inputs to localStorage on change
  useEffect(() => {
    localStorage.setItem('churn_predictor_inputs', JSON.stringify(inputs))
  }, [inputs])

  const handlePredict = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = {
        analysis_month: inputs.analysis_month,
        current_date: inputs.current_date,
        dunning_duration: Number(inputs.dunning_duration),
        reported_total_churn: Number(inputs.reported_total_churn),
        reported_voluntary_churn: Number(inputs.reported_voluntary_churn),
        annual_risk_weight: Number(inputs.annual_risk_weight),
        opening_balance: Number(inputs.opening_balance),
        new_sales: Number(inputs.new_sales),
      }
      const { data } = await axios.post('/api/predict', payload)
      setPrediction(data.breakdown)
      setPredictionInputs({ ...inputs })
      // Refresh the saved runs list so the new run appears in the dropdown
      axios.get('/api/prediction-runs').then(({ data: runs }) => setSavedRuns(dedupeRuns(runs))).catch(() => {})
      setActiveTab('Results')
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Prediction failed'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  if (session === undefined) return null // loading
  if (!session) return <LoginPage />

  if (currentApp === null) {
    return <LandingPage onSelect={setCurrentApp} onSignOut={() => supabase.auth.signOut()} />
  }

  if (currentApp === 'forecaster') {
    return <SubscriptionForecaster onBack={() => setCurrentApp(null)} />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center gap-4">
          <button
            onClick={() => setCurrentApp(null)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            All tools
          </button>
          <span className="text-gray-200">|</span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 tracking-tight">
              EP Churn Predictor
            </h1>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6">
          <nav className="flex gap-0">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
                {tab === 'Results' && prediction && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    Ready
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {activeTab === 'Data Files' && (
          <DataFiles csvStatus={csvStatus} onUploadComplete={refreshStatus} />
        )}
        {activeTab === 'Run Prediction' && (
          <RunPrediction
            inputs={inputs}
            setInputs={setInputs}
            onPredict={handlePredict}
            loading={loading}
            error={error}
            csvStatus={csvStatus}
          />
        )}
        {activeTab === 'Results' && (
          <Results
            prediction={prediction}
            inputs={predictionInputs}
            savedRuns={savedRuns}
            onLoadRun={(run) => {
              setPrediction(run.breakdown)
              setPredictionInputs(run.inputs)
            }}
          />
        )}
        {activeTab === 'Renewal Pools' && (
          <RenewalPools csvStatus={csvStatus} />
        )}
        {activeTab === 'Walkthrough' && (
          <Walkthrough prediction={prediction} inputs={predictionInputs} />
        )}
      </main>
    </div>
  )
}
