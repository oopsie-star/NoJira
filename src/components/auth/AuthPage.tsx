import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { useAuthContext } from '@/auth/AuthContext'
import { useI18n } from '@/lib/i18n'

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853" />
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335" />
    </svg>
  )
}

export function AuthPage() {
  const { signIn, signUp, signInWithGoogle } = useAuthContext()
  const { t } = useI18n()
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)

    const response = tab === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password, fullName)

    if (response) {
      setError(response)
    } else if (tab === 'signup') {
      setNotice(t('auth.checkEmail'))
    }
    setLoading(false)
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    setNotice(null)
    const response = await signInWithGoogle()
    if (response) {
      setError(response)
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] px-4 py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden rounded-[32px] bg-qira-anthracite p-10 text-white shadow-2xl lg:block">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/70">Qira</p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight">Your team's projects. Structured, fast, and clear.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-white/80">{t('auth.subtitle')}</p>

          <div className="mt-10 grid gap-4">
            {[
              'Boards and backlog with structured issue details',
              'Google authentication, roles, positions and language preferences',
              'Sprints, epics, attachments and a faster editing flow',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-4">
                <ArrowRight size={18} />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[32px] bg-white p-8 shadow-xl">
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Qira</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">{tab === 'signin' ? t('auth.signIn') : t('auth.signUp')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('auth.subtitle')}</p>
          </div>

          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <GoogleLogo />
            {googleLoading ? t('auth.redirecting') : t('auth.continueGoogle')}
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{t('auth.or')}</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="mb-6 flex rounded-2xl bg-slate-100 p-1">
            <button
              onClick={() => setTab('signin')}
              className={[
                'flex-1 rounded-2xl px-4 py-2.5 text-sm font-semibold transition',
                tab === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              ].join(' ')}
            >
              {t('auth.signIn')}
            </button>
            <button
              onClick={() => setTab('signup')}
              className={[
                'flex-1 rounded-2xl px-4 py-2.5 text-sm font-semibold transition',
                tab === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              ].join(' ')}
            >
              {t('auth.signUp')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'signup' && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {t('auth.fullName')}
                </label>
                <input
                  required
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-qira-pistachio"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t('auth.email')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-qira-pistachio"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t('auth.password')}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-qira-pistachio"
              />
            </div>

            {error && (
              <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {error}
              </div>
            )}

            {notice && (
              <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-qira-pistachio px-4 py-3 text-sm font-semibold text-white transition hover:bg-qira-pistachio-dk disabled:opacity-60"
            >
              {loading ? t('auth.wait') : tab === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
