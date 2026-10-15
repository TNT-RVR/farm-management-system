import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { usePublicBrand } from '@/lib/farm-setup'

/**
 * Landing page for the "set / reset password" email link. Supabase's
 * detectSessionInUrl turns the recovery token in the URL into a temporary
 * session; here the user sets a new password (updateUser), then we send them in.
 */
export function ResetPasswordPage() {
  const BRAND = usePublicBrand()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // A recovery link produces a session (either already present, or via the
    // PASSWORD_RECOVERY event once the URL hash is processed).
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setReady(Boolean(s)))
    return () => sub.subscription.unsubscribe()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('Passwords don’t match.')
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) setError(err.message)
    else navigate('/', { replace: true })
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <img src={BRAND.logo} alt={BRAND.farmName} className="mb-3 h-10 w-auto" />
        <h1 className="text-xl font-bold text-brand-800">Set your password</h1>

        {!ready ? (
          <div className="mt-6 text-sm text-gray-600">
            <p>
              This page works from the “set / reset password” email link. Open that link, or request
              a new one from the sign-in page.
            </p>
            <Link to="/login" className="mt-3 inline-block text-brand-700 hover:underline">
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
            <label className="text-sm font-medium text-gray-700" htmlFor="pw">
              New password
            </label>
            <input
              id="pw"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
            <label className="text-sm font-medium text-gray-700" htmlFor="pw2">
              Confirm password
            </label>
            <input
              id="pw2"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save password & sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
