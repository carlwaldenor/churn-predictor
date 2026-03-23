export default function LandingPage({ onSelect, onSignOut }) {
  const apps = [
    {
      id: 'churn',
      name: 'EP Churn Predictor',
      description:
        'Forecast monthly subscription churn by calibrating a failure-rate model against your renewal cohorts and dunning data.',
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181" />
        </svg>
      ),
      color: 'indigo',
    },
    {
      id: 'forecaster',
      href: 'https://subscription-scenarios.vercel.app',
      name: 'EP Subscription Scenarios',
      description:
        'Model and compare scenarios by adjusting sales volume, churn rate, and pricing to see their impact on subscriber count and MRR.',
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
      color: 'emerald',
    },
  ]

  const colorMap = {
    indigo: {
      icon: 'bg-indigo-50 text-indigo-600',
      badge: 'bg-indigo-600 text-white hover:bg-indigo-700',
      ring: 'hover:border-indigo-300',
    },
    emerald: {
      icon: 'bg-emerald-50 text-emerald-600',
      badge: 'bg-emerald-600 text-white hover:bg-emerald-700',
      ring: 'hover:border-emerald-300',
    },
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/nedladdning.png" alt="EliteProspects" className="w-12 h-12 rounded-xl" />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
                EliteProspects Subscription Analytics Hub
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Choose a tool to get started
              </p>
            </div>
          </div>
          {onSignOut && (
            <button onClick={onSignOut} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </button>
          )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 w-full">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {apps.map((app) => {
            const c = colorMap[app.color]
            const El = app.href ? 'a' : 'button'
            const elProps = app.href
              ? { href: app.href, target: '_blank', rel: 'noreferrer' }
              : { onClick: () => onSelect(app.id) }
            return (
              <El
                key={app.id}
                {...elProps}
                className={`text-left bg-white rounded-2xl border border-gray-200 p-7 transition-all duration-150 shadow-sm hover:shadow-md ${c.ring} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-${app.color}-500`}
              >
                <div className={`inline-flex items-center justify-center rounded-xl p-3 ${c.icon} mb-5`}>
                  {app.icon}
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1.5">
                  {app.name}
                </h2>
                <p className="text-sm text-gray-500 leading-relaxed mb-6">
                  {app.description}
                </p>
                <span className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${c.badge}`}>
                  Open
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </span>
              </El>
            )
          })}
        </div>
      </main>
    </div>
  )
}
