import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured, setStayLoggedIn, supabase } from '@/lib/supabase'
import { usePublicBrand } from '@/lib/farm-setup'

type Mode = 'password' | 'reset'

export function LoginPage() {
  const { session } = useAuth()
  // Before sign-in: only the name and logo, through public_brand().
  const BRAND = usePublicBrand()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [stay, setStay] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (session) return <Navigate to="/" replace />

  const friendly = (msg: string) =>
    /invalid login credentials/i.test(msg)
      ? 'Wrong email or password. First time here? Use “Set / reset password” below.'
      : /email not confirmed/i.test(msg)
        ? 'Email not confirmed yet — check your inbox, or use “Set / reset password”.'
        : msg

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setStayLoggedIn(stay) // decide where the session token is stored, before signing in
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (!err) return
    // Distinguish "no account for that email" from a wrong password so an email
    // mix-up (e.g. personal vs work address) is obvious.
    if (/invalid login credentials/i.test(err.message) && email) {
      try {
        const res = await fetch(`/api/auth-check-email?email=${encodeURIComponent(email)}`)
        const { exists } = (await res.json()) as { exists: boolean | null }
        if (exists === false) {
          setError(`No account for “${email}”. Check the address — your login email may differ from your personal email. Ask a manager if unsure.`)
          return
        }
        if (exists === true) {
          setError('That email is correct, but the password is wrong. Use “Set / reset password” below if needed.')
          return
        }
      } catch {
        /* fall through to the generic message */
      }
    }
    setError(friendly(err.message))
  }

  async function sendReset(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    // Works for a first-time password too: the recovery link lets them set one.
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (err) setError(err.message)
    else setNotice(`If ${email} has an account, we sent a link to set a new password.`)
  }

  async function sendMagicLink() {
    if (!email) {
      setError('Enter your email first.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
    })
    setBusy(false)
    if (err)
      setError(
        /signups? not allowed|not found|otp_disabled/i.test(err.message)
          ? 'No account for that email. Ask a manager to invite you.'
          : err.message,
      )
    else setNotice(`Check your email — we sent a one-time sign-in link to ${email}.`)
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <img src={BRAND.logo} alt={BRAND.farmName} className="mb-3 h-10 w-auto" />
        <h1 className="text-xl font-bold text-brand-800">{BRAND.appName}</h1>
        <p className="mt-1 text-sm text-gray-500">{BRAND.farmName}</p>

        {!isSupabaseConfigured ? (
          <p className="mt-6 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Supabase is not configured. Set up <code>.env</code> first.
          </p>
        ) : mode === 'reset' ? (
          <form onSubmit={sendReset} className="mt-6 flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              Enter your email and we’ll send a link to set a new password.
            </p>
            <label className="text-sm font-medium text-gray-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {notice && <p className="rounded-md bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('password')
                setError('')
                setNotice('')
              }}
              className="text-center text-xs text-gray-500 hover:text-gray-800"
            >
              ← Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={signIn} className="mt-6 flex flex-col gap-3">
            <label className="text-sm font-medium text-gray-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
            <label className="text-sm font-medium text-gray-700" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {notice && <p className="rounded-md bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
            <label className="mt-1 flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              Stay logged in on this device
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="mt-1 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('reset')
                  setError('')
                  setNotice('')
                }}
                className="text-gray-500 hover:text-gray-800"
              >
                Set / reset password
              </button>
              <button type="button" onClick={sendMagicLink} className="text-gray-500 hover:text-gray-800">
                Email me a sign-in link
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-gray-400">
              Invite only — a manager adds new users.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
