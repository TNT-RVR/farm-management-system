import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isSupabaseConfigured, supabase } from './supabase'
import { clearOfflineCache } from './offline'

export type AppRole = 'admin' | 'manager' | 'user'

/**
 * Admins are managers plus user administration, so every manager-gated screen
 * must treat them as managers. Mirrors is_manager() / is_admin() in the DB —
 * never compare `role === 'manager'` directly, that locks admins out.
 */
export const hasManagerAccess = (role: AppRole | null | undefined) =>
  role === 'manager' || role === 'admin'
export const hasAdminAccess = (role: AppRole | null | undefined) => role === 'admin'
/**
 * An owner of the farm (users.is_owner), not a role: Sam and David are
 * admins who are also owners. Owners alone see what the fixed expenses are
 * made of. The database enforces it (is_owner()); this only decides what to draw.
 */
export const isOwner = (profile: Pick<UserProfile, 'is_owner' | 'active'> | null | undefined) =>
  Boolean(profile?.is_owner && profile.active)

/**
 * Sees the owners-only financials: an owner, or someone the owners gave
 * access (users.finance_access — the farm's accountant). The database
 * enforces it (can_see_finances()); this only decides what to draw.
 */
export const canSeeFinances = (profile: Pick<UserProfile, 'is_owner' | 'finance_access' | 'active'> | null | undefined) =>
  Boolean(profile?.active && (profile.is_owner || profile.finance_access))

export type UserProfile = {
  id: string
  email: string
  full_name: string
  role: AppRole
  phone: string | null
  active: boolean
  nav_prefs: { order: string[]; hidden: string[] } | null
  /** Phone home-screen shortcuts. See lib/tiles.ts. */
  tile_prefs: { order: string[]; hidden: string[] } | null
  /** Nav paths an admin has closed off for this user. Empty = full access. */
  denied_views: string[]
  /** An owner of the farm. See isOwner. */
  is_owner?: boolean
  /** Sees the owners-only financials without being an owner. See canSeeFinances. */
  finance_access?: boolean
}

type AuthState = {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Offline, an access token that has aged out cannot be refreshed, and
      // supabase-js reports that as signed out. Taken at face value it throws
      // you to the login screen in a field with no signal — where you cannot
      // log back in either, and the saved data you came for is on the other
      // side of that screen. So a null session with no connection is treated as
      // "still signed in, just cannot check": the token is refused by the
      // server the moment there IS a connection, so this grants no access to
      // anything, it only keeps the door open to what is already on the device.
      if (s === null && !navigator.onLine) return
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const qc = useQueryClient()
  const userId = session?.user.id
  const { data: profile } = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('*').eq('id', userId!).single()
      if (error) throw error
      return data as UserProfile
    },
  })

  const signOut = async () => {
    await supabase.auth.signOut()
    // The saved cache is farm data sitting in the browser profile of whatever
    // phone or truck laptop this is. Signing out has to take it with it.
    await clearOfflineCache()
    qc.clear()
  }

  return (
    <AuthContext.Provider
      value={{ session, profile: (userId && profile) || null, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** Admin-only: permanently delete a user (server-side, service role). */
export async function deleteUser(id: string): Promise<{ email: string; full_name: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch('/api/delete-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ id }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    error?: string
    email?: string
    full_name?: string
  }
  if (!res.ok) throw new Error(body.error ?? 'Delete failed')
  return { email: body.email ?? '', full_name: body.full_name ?? '' }
}

/** Admin-only: invite a new user by email (server-side, service role). */
export async function inviteUser(email: string, role: AppRole): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch('/api/invite-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, role }),
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? 'Invite failed')
}
