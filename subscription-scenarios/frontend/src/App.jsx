import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { supabase } from './lib/supabase.js'
import LoginPage from './components/LoginPage.jsx'
import Upload from './components/Upload.jsx'
import Plans from './components/Plans.jsx'
import Forecast from './components/Forecast.jsx'

const NAV = [
  {
    id: 'upload', label: 'Data',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>,
  },
  {
    id: 'plans', label: 'Plans',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>,
  },
  {
    id: 'forecast', label: 'Forecast',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.519l2.74-1.22m0 0-5.94-2.28m5.94 2.28-2.28 5.941" /></svg>,
  },
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState('upload')
  const [plans, setPlans] = useState([])
  const [newPlans, setNewPlans] = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  const refreshPlans = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/plans')
      setPlans(data)
    } catch {}
  }, [])

  useEffect(() => { refreshPlans() }, [refreshPlans])

  const actualPlans = plans.filter((p) => p.row_type === 'actuals')

  // Last actual date — needed by Plans tab to generate launch month options
  const lastActualDate = actualPlans.length > 0
    ? actualPlans.reduce((max, p) => {
        const d = (p.monthly_data || []).reduce((m, r) => (!m || r.date > m ? r.date : m), null)
        return (!max || (d && d > max)) ? d : max
      }, null)
    : null

  if (session === undefined) return null
  if (!session) return <LoginPage />

  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-800">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">EliteProspects</p>
          <h1 className="text-sm font-semibold text-white leading-tight">Subscription Scenarios</h1>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === item.id
                  ? 'bg-emerald-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-800 space-y-2">
          <div className="flex items-center gap-2 px-3">
            <div className={`w-1.5 h-1.5 rounded-full ${actualPlans.length > 0 ? 'bg-emerald-400' : 'bg-gray-600'}`} />
            <span className="text-xs text-gray-500">
              {actualPlans.length > 0
                ? `${actualPlans.length} plan${actualPlans.length !== 1 ? 's' : ''} loaded`
                : 'No data loaded'}
            </span>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" /></svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50 flex flex-col">
        {tab === 'upload'   && <Upload plans={plans} onUploaded={refreshPlans} />}
        {tab === 'plans'    && <Plans plans={plans} onCleared={refreshPlans} newPlans={newPlans} onNewPlansChange={setNewPlans} lastActualDate={lastActualDate} />}
        {tab === 'forecast' && <Forecast actualPlans={actualPlans} newPlans={newPlans} onNewPlansChange={setNewPlans} />}
        <footer className="shrink-0 py-2 px-4 text-center">
          <span className="text-[10px] text-gray-300 select-none">&copy; {new Date().getFullYear()} Carl Waldenor</span>
        </footer>
      </main>
    </div>
  )
}
