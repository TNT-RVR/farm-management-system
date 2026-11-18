import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { SETUP_LINKS } from '@/lib/setup-links'
import { hasAdminAccess, useAuth } from '@/lib/auth'
import { isPathOff, useDisabledPaths } from '@/lib/farm-setup'
import { isViewDenied } from '@/lib/nav'
import { PARTNER_HOME, isPartnerPath } from '@/lib/partner'
import { usePartnerView, usePartnerViewsReady } from '@/lib/partner-view'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useMfaGate } from '@/lib/mfa'
import { MfaChallenge } from '@/components/Mfa'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, profile, loading, profileReady } = useAuth()
  const { pathname } = useLocation()
  const mfa = useMfaGate(session?.user.id ?? null, session?.expires_at)
  const partnerView = usePartnerView()
  const partnerViewsReady = usePartnerViewsReady()

  if (!isSupabaseConfigured) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-semibold">The app isn&apos;t connected to its database yet.</p>
          <p className="mt-2">
            <strong>On Netlify:</strong> add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> (from Supabase → Project Settings → API) under Site
            configuration → Environment variables, then Deploys → Trigger deploy.
          </p>
          <p className="mt-2">
            <strong>On your own computer:</strong> copy <code>.env.example</code> to <code>.env</code>, fill in
            the same two values, then restart <code>npm run dev</code>.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-500">Loading…</div>
  }

  if (!session) return <Navigate to="/login" replace />

  // Someone who turned on the authenticator owes a code before anything
  // else; the database refuses their reads until then (mfa_ok()).
  if (mfa.isLoading) return <div className="flex h-full items-center justify-center text-gray-500">Loading…</div>
  if (mfa.data?.needsCode) return <MfaChallenge />

  // The role decides which screens exist and where fields are read from
  // (lib/partner.ts), so nothing renders until it is known.
  if (!profileReady) return <div className="flex h-full items-center justify-center text-gray-500">Loading…</div>
  // A partner's screens follow his company's preset and ticks (lib/partner.ts).
  if (!partnerViewsReady) return <div className="flex h-full items-center justify-center text-gray-500">Loading…</div>

  if (profile && !profile.active) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-700">
          Your account is waiting for a manager to activate it.
        </div>
      </div>
    )
  }

  // A partner has his fields and his account, nothing else. The
  // database keeps him out of the rest regardless; this keeps him off screens
  // that would only show empty farm-wide lists.
  if (profile && partnerView && !isPartnerPath(pathname)) {
    return <Navigate to={PARTNER_HOME} replace />
  }

  return <>{children}</>
}

/**
 * The per-section gates: a view an admin closed off for this account, and a
 * feature the farm switched off in Farm setup. Drawn inside the app's frame
 * (AppShell wraps its page in this), so the menu and a way home stay on
 * screen; above the frame they were a dead end (page-walk batch 6).
 */
export function SectionGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  // Features the farm switched off in Farm setup: closed to everyone, admins
  // included, so a typed address cannot open a screen the menu no longer shows.
  // The settings page is never off, or there would be no way back.
  const off = useDisabledPaths()

  // An admin can close off sections per user. This stops the URL being typed
  // in directly — it is a routing gate, not a data one (RLS is role-based).
  if (profile && isViewDenied(profile, pathname)) {
    return (
      <Closed title="No access to this section">
        An administrator has turned this off for your account. Ask them if you need it.
      </Closed>
    )
  }

  if (isPathOff(off, pathname)) {
    return (
      <Closed title="This part of the app is switched off">
        {hasAdminAccess(profile?.role) ? (
          <>
            Turn it back on in{' '}
            <Link to={SETUP_LINKS.farmSetup('features')} className="font-medium text-brand-700 hover:underline">
              Farm setup
            </Link>
            .
          </>
        ) : (
          'Your farm has switched this off. Ask an admin if you need it.'
        )}
      </Closed>
    )
  }

  return <>{children}</>
}

function Closed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-700">
        <p className="font-semibold text-gray-900">{title}</p>
        <p className="mt-1 text-gray-500">{children}</p>
        <Link to="/dashboard" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
          Back to Home
        </Link>
      </div>
    </div>
  )
}
