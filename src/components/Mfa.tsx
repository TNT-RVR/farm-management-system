import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import {
  confirmTotpEnrolment,
  removeTotp,
  startTotpEnrolment,
  useMfaRefresh,
  useTotpFactors,
  verifyTotp,
} from '@/lib/mfa'
import { supabase } from '@/lib/supabase'

const codeInput =
  'w-36 rounded-md border border-gray-300 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-gray-900'
const sixDigits = (v: string) => v.replace(/\D/g, '').slice(0, 6)

/**
 * The second step of signing in, for someone who turned the authenticator on.
 * Shown by ProtectedRoute in place of the app until the code is in — the
 * database refuses this person's reads until then anyway.
 */
export function MfaChallenge() {
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useMfaRefresh()
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await verifyTotp(code)
      refresh()
    } catch (e) {
      setErr((e as Error).message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (code.length === 6) void submit()
        }}
        className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center"
      >
        <ShieldCheck className="mx-auto h-8 w-8 text-brand-700" />
        <h1 className="mt-2 text-base font-semibold text-gray-900">Enter your authenticator code</h1>
        <p className="mt-1 text-sm text-gray-500">The six digits your authenticator app shows for this app.</p>
        <input
          className={`${codeInput} mt-4`}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-label="Six-digit code"
          value={code}
          onChange={(e) => setCode(sixDigits(e.target.value))}
        />
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="submit"
            disabled={code.length !== 6 || busy}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <button type="button" onClick={() => void supabase.auth.signOut()} className="text-sm text-gray-500 underline">
            Sign out
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-400">Lost your phone? An administrator can reset it for you.</p>
      </form>
    </div>
  )
}

/** Settings → My account → Sign-in security: turn the authenticator on or off. */
export function AuthenticatorSettings() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const { data: factors, isLoading } = useTotpFactors(userId)
  const refresh = useMfaRefresh()
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const on = (factors?.verified.length ?? 0) > 0

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-md rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        <ShieldCheck className="h-4 w-4 text-brand-700" /> Authenticator app
      </h2>
      {isLoading ? (
        <p className="mt-2 text-gray-500">Loading…</p>
      ) : on ? (
        <>
          <p className="mt-2 text-gray-700">
            <span className="font-medium text-green-700">On.</span> Signing in asks for a code from your authenticator app after your password.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Turn off the authenticator? Signing in will need only your password again.')) return
              void run(async () => {
                for (const f of factors!.verified) await removeTotp(f.id)
                refresh()
              })
            }}
            className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Turn off
          </button>
        </>
      ) : setup ? (
        <>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-gray-700">
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
            <li>Scan this code, or type the key below.</li>
            <li>Enter the six digits it shows.</li>
          </ol>
          <img src={setup.qr} alt="QR code for your authenticator app" className="mx-auto mt-3 h-44 w-44 rounded border border-gray-200 bg-white p-1" />
          <p className="mt-2 break-all text-center font-mono text-xs text-gray-600">{setup.secret}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <input
              className={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Six-digit code"
              value={code}
              onChange={(e) => setCode(sixDigits(e.target.value))}
            />
            <button
              disabled={code.length !== 6 || busy}
              onClick={() =>
                void run(async () => {
                  await confirmTotpEnrolment(setup.factorId, code)
                  setSetup(null)
                  setCode('')
                  refresh()
                })
              }
              className="rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              Turn on
            </button>
          </div>
          <button onClick={() => setSetup(null)} className="mt-2 block w-full text-center text-xs text-gray-500 underline">
            Cancel
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-gray-700">
            Off. Turn it on and signing in will also ask for a six-digit code from an app on your phone, so a stolen password isn&apos;t enough.
          </p>
          <button
            disabled={busy}
            onClick={() => void run(async () => setSetup(await startTotpEnrolment()))}
            className="mt-3 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Set up an authenticator
          </button>
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  )
}
