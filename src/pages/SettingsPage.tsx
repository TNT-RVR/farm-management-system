import { AuthenticatorSettings } from '@/components/Mfa'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CalendarDays,
  Check,
  ChevronRight,
  MailWarning,
  Pencil,
  Plug,
  Tractor,
  ShieldCheck,
  Trash2,
  UserCircle,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import {
  deleteUser,
  hasAdminAccess,
  hasManagerAccess,
  inviteUser,
  useAuth,
  type AppRole,
} from '@/lib/auth'
import { NOTIFICATION_KINDS, useNotificationPrefs, useSetPref } from '@/lib/notifications'
import {
  sendTestNotification,
  subscribeToPush,
  unsubscribeFromPush,
  usePushState,
} from '@/lib/push'
import { IntegrationsPanel } from '@/pages/IntegrationsPage'
import { OfflinePanel } from '@/pages/settings/OfflinePanel'
import { TilesPanel } from '@/pages/settings/TilesPanel'
import { FarmSetupPanel } from '@/pages/settings/FarmSetupPanel'
import { SatelliteSyncCard } from '@/components/SatelliteSyncCard'
import { AppVersionCard } from '@/components/AppVersionCard'
import { AccessMatrix } from '@/pages/settings/AccessMatrix'

type ManagedUser = {
  id: string
  email: string
  full_name: string
  role: AppRole
  active: boolean
  denied_views: string[]
}

type SortKey = 'name' | 'email' | 'role' | 'status'

/** Sortable column header. Module-level so it isn't remounted every render. */
function Th({
  k,
  label,
  sort,
  onSort,
}: {
  k: SortKey
  label: string
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (k: SortKey) => void
}) {
  const arrow = sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''
  return (
    <th
      onClick={() => onSort(k)}
      className="cursor-pointer select-none px-3 py-2 font-medium hover:text-gray-700"
    >
      {label}
      {arrow}
    </th>
  )
}

const ROLE_HELP: Record<AppRole, string> = {
  admin: 'Everything a manager can do, plus inviting and deleting people.',
  manager: 'Full access to the farm data. Cannot invite or delete people.',
  user: 'Day-to-day use. Cannot change settings or other people.',
}

type InviteStatus = { id: string; invited_at: string | null; last_sign_in_at: string | null }

/**
 * Invite state from auth.users, via a manager-only definer function (clients
 * cannot read auth.users directly). Pending = never signed in.
 */
function useInviteStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['user_invite_status'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('user_invite_status')
      if (error) throw error
      return (data ?? []) as unknown as InviteStatus[]
    },
  })
}

const DAY = 86_400_000
/** "3 days ago" — how long an invitation has been sitting unanswered. */
function agoLabel(iso: string | null): string {
  if (!iso) return 'unknown'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
/** Invitations older than a week are probably lost in a spam folder. */
const isStale = (iso: string | null) =>
  Boolean(iso && Date.now() - new Date(iso).getTime() > 7 * DAY)

function useAllUsersFull() {
  return useQuery({
    queryKey: ['users', 'full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, role, active, denied_views')
        .order('created_at')
      if (error) throw error
      return data as ManagedUser[]
    },
  })
}

function InviteForm() {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AppRole>('user')
  const [sent, setSent] = useState<string | null>(null)

  const invite = useMutation({
    mutationFn: () => inviteUser(email.trim(), role),
    onSuccess: () => {
      setSent(email.trim())
      setEmail('')
      setRole('user')
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSent(null)
        invite.mutate()
      }}
      className="mt-3 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-4"
    >
      <input
        type="email"
        required
        placeholder="user-38a8@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <Select
        value={role}
        ariaLabel="Role"
        className="w-32"
        onChange={(v) => setRole(v as AppRole)}
        options={[
          { value: 'user', label: 'User' },
          { value: 'manager', label: 'Manager' },
          { value: 'admin', label: 'Admin' },
        ]}
      />
      <button
        type="submit"
        disabled={invite.isPending || !email.trim()}
        className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
      >
        <UserPlus className="h-4 w-4" />
        {invite.isPending ? 'Inviting…' : 'Invite'}
      </button>
      <p className="w-full text-xs text-gray-500">{ROLE_HELP[role]}</p>
      {sent && <p className="w-full text-xs text-green-700">Invitation sent to {sent}.</p>}
      {invite.isError && (
        <p className="w-full text-xs text-red-600">{(invite.error as Error).message}</p>
      )}
    </form>
  )
}

/** One user row, read-only or in edit mode. */
function UserRow({
  u,
  isSelf,
  canEditAccess,
  canGrantElevated,
  canDelete,
  onSave,
  onDelete,
  busy,
}: {
  u: ManagedUser
  isSelf: boolean
  canEditAccess: boolean
  canGrantElevated: boolean
  canDelete: boolean
  onSave: (changes: Partial<ManagedUser>) => void
  onDelete: () => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(u.full_name)
  const [role, setRole] = useState<AppRole>(u.role)
  const [active, setActive] = useState(u.active)

  const start = () => {
    setName(u.full_name)
    setRole(u.role)
    setActive(u.active)
    setEditing(true)
  }
  const save = () => {
    const changes: Partial<ManagedUser> = {}
    if (name !== u.full_name) changes.full_name = name
    if (role !== u.role) changes.role = role
    if (active !== u.active) changes.active = active
    if (Object.keys(changes).length) onSave(changes)
    setEditing(false)
  }

  // Changing your own role/active is blocked in the database too, so nobody can
  // demote themselves into a lockout or quietly self-promote.
  const accessLocked = isSelf || !canEditAccess
  const roleOptions = [
    { value: 'user', label: 'User' },
    ...(canGrantElevated
      ? [
          { value: 'manager', label: 'Manager' },
          { value: 'admin', label: 'Admin' },
        ]
      : []),
  ]

  if (!editing) {
    return (
      <tr className="hover:bg-gray-50">
        <td className="px-3 py-2 font-medium">
          {u.full_name}
          {isSelf && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
        </td>
        <td className="px-3 py-2 text-gray-600">{u.email}</td>
        <td className="px-3 py-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
              u.role === 'admin'
                ? 'bg-brand-100 text-brand-800'
                : u.role === 'manager'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-600',
            )}
          >
            {u.role}
          </span>
        </td>
        <td className="px-3 py-2">
          <span
            className={cn('text-xs font-medium', u.active ? 'text-green-700' : 'text-gray-400')}
          >
            {u.active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-3 py-2 text-right">
          <button
            onClick={start}
            className="mr-1 rounded-md p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label={`Edit ${u.full_name}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && !isSelf && (
            <button
              onClick={onDelete}
              disabled={busy}
              className="rounded-md p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              aria-label={`Delete ${u.full_name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <tr className="bg-brand-50/40">
      <td className="px-3 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          aria-label="Full name"
        />
      </td>
      <td className="px-3 py-2 text-gray-500">{u.email}</td>
      <td className="px-3 py-2">
        <Select
          value={role}
          disabled={accessLocked}
          size="sm"
          ariaLabel="Role"
          onChange={(v) => setRole(v as AppRole)}
          options={roleOptions}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={active}
          disabled={accessLocked}
          onChange={(e) => setActive(e.target.checked)}
          aria-label="Active"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={save}
          className="mr-1 rounded-md p-1.5 text-green-600 hover:bg-green-50"
          aria-label="Save"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          onClick={() => setEditing(false)}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-50"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}

function UsersAdmin() {
  const { profile } = useAuth()
  const { data: users } = useAllUsersFull()
  const isManager = hasManagerAccess(profile?.role)
  const { data: inviteStatus } = useInviteStatus(isManager)
  const queryClient = useQueryClient()
  const [note, setNote] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const isAdmin = hasAdminAccess(profile?.role)

  const patch = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Partial<ManagedUser> }) => {
      const { error } = await supabase.from('users').update(changes).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: (r) => {
      setNote(`Deleted ${r.full_name || r.email}.`)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const sortBy = (key: SortKey) =>
    setSort((c) => ({ key, dir: c.key === key ? ((c.dir === 1 ? -1 : 1) as 1 | -1) : 1 }))
  const pendingIds = new Set(
    (inviteStatus ?? []).filter((i) => i.last_sign_in_at === null).map((i) => i.id),
  )
  const invitedAt = new Map((inviteStatus ?? []).map((i) => [i.id, i.invited_at]))
  const pending = (users ?? []).filter((u) => pendingIds.has(u.id))
  const sorted = [...(users ?? []).filter((u) => !pendingIds.has(u.id))].sort((a, b) => {
    const v = (u: ManagedUser) =>
      sort.key === 'email'
        ? u.email
        : sort.key === 'role'
          ? u.role
          : sort.key === 'status'
            ? u.active
              ? 'active'
              : 'inactive'
            : u.full_name
    return v(a).localeCompare(v(b)) * sort.dir || a.full_name.localeCompare(b.full_name)
  })
  return (
    <div className="p-4 md:p-6">
      {!isAdmin && (
        <div className="mb-4 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          You can change access for regular users, but only an{' '}
          <span className="font-semibold">admin</span> can invite or remove people.
        </div>
      )}

      {isAdmin && (
        <div className="mb-4 max-w-3xl rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Invite-only: no one can sign up on their own.</p>
          <InviteForm />
        </div>
      )}

      {pending.length > 0 && (
        <section className="mb-5 max-w-3xl">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <MailWarning className="h-4 w-4 text-amber-600" /> Pending invitations ·{' '}
            {pending.length}
          </h2>
          <ul className="divide-y divide-amber-100 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/60">
            {pending.map((u) => {
              const sent = invitedAt.get(u.id) ?? null
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
                >
                  <span className="font-medium text-gray-800">{u.full_name}</span>
                  <span className="text-gray-500">{u.email}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
                      {u.role}
                    </span>
                    <span
                      className={cn(
                        'text-xs',
                        isStale(sent) ? 'font-semibold text-amber-800' : 'text-gray-500',
                      )}
                    >
                      invited {agoLabel(sent)}
                    </span>
                    {isAdmin && (
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Cancel the invitation for ${u.email}? They will not be able to sign in with it.`,
                            )
                          ) {
                            setNote(null)
                            remove.mutate(u.id)
                          }
                        }}
                        disabled={remove.isPending}
                        className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label={`Cancel invitation for ${u.full_name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          <HelpNote
            className="mt-1.5"
            title="Pending invitations"
            summary="Invited but never signed in. Chase anything older than a week."
          >
            <p>
              These people were invited but have never signed in. Anything older than a week is
              worth chasing — invitation emails land in spam more often than not.
            </p>
          </HelpNote>
        </section>
      )}

      <div className="mb-2 flex max-w-3xl items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          {pending.length > 0 ? 'Active accounts' : 'Users'} · {sorted.length}
        </h2>
      </div>

      <div className="max-w-3xl overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <Th k="name" label="Name" sort={sort} onSort={sortBy} />
              <Th k="email" label="Email" sort={sort} onSort={sortBy} />
              <Th k="role" label="Role" sort={sort} onSort={sortBy} />
              <Th k="status" label="Status" sort={sort} onSort={sortBy} />
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                isSelf={u.id === profile?.id}
                // Managers may only administer regular users; admins, anyone.
                canEditAccess={isAdmin || u.role === 'user'}
                canGrantElevated={isAdmin}
                canDelete={isAdmin}
                busy={remove.isPending}
                onSave={(changes) => patch.mutate({ id: u.id, changes })}
                onDelete={() => {
                  if (
                    window.confirm(
                      `Permanently delete ${u.full_name || u.email}? This removes their login and cannot be undone.`,
                    )
                  ) {
                    setNote(null)
                    remove.mutate(u.id)
                  }
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && <ResetAuthenticator users={sorted} onDone={setNote} />}
      {note && <p className="mt-2 max-w-3xl text-xs text-green-700">{note}</p>}
      {patch.isError && (
        <p className="mt-2 max-w-3xl text-xs text-red-600">{(patch.error as Error).message}</p>
      )}
      {remove.isError && (
        <p className="mt-2 max-w-3xl text-xs text-red-600">{(remove.error as Error).message}</p>
      )}
    </div>
  )
}

function PushToggle() {
  const { state, setState } = usePushState()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [test, setTest] = useState<'idle' | 'sending' | 'sent'>('idle')

  if (state === 'unsupported') return null
  const on = state === 'subscribed'

  return (
    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
      <div>
        <p className="text-sm font-medium text-gray-700">Push notifications on this device</p>
        <p className="text-xs text-gray-400">
          {state === 'not-configured'
            ? 'Not configured on the server.'
            : state === 'denied'
              ? 'Blocked — enable notifications for this site in your browser.'
              : on
                ? 'On — you’ll get pushes even with the app closed.'
                : 'Get task and reminder pushes. On iPhone, add the app to your Home Screen first.'}
        </p>
        {err && <p className="text-xs text-red-600">{err}</p>}
        {state !== 'not-configured' && (
          <button
            type="button"
            disabled={test === 'sending'}
            onClick={async () => {
              setTest('sending')
              setErr('')
              try {
                await sendTestNotification()
                setTest('sent')
              } catch (e) {
                setErr((e as Error).message)
                setTest('idle')
              }
            }}
            className="mt-1 text-xs text-brand-700 underline decoration-dotted"
          >
            {test === 'sending'
              ? 'Sending...'
              : test === 'sent'
                ? on
                  ? 'Sent. It should arrive within a few seconds.'
                  : 'Sent to the bell in the app. Press Enable to get them on this phone too.'
                : 'Send me a test notification'}
          </button>
        )}
      </div>
      <button
        disabled={busy || state === 'not-configured' || state === 'denied'}
        onClick={async () => {
          setBusy(true)
          setErr('')
          try {
            if (on) {
              await unsubscribeFromPush()
              setState('granted')
            } else {
              setState(await subscribeToPush())
            }
          } catch (e) {
            setErr((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
        className={cn(
          'rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50',
          on ? 'border border-gray-300 bg-white text-gray-700' : 'bg-brand-700 text-white',
        )}
      >
        {busy ? '…' : on ? 'Turn off' : 'Enable'}
      </button>
    </div>
  )
}

function NotificationPrefs() {
  const { data: prefs } = useNotificationPrefs()
  const setPref = useSetPref()

  const inAppFor = (kind: string) => prefs?.find((p) => p.kind === kind)?.in_app ?? true

  return (
    <div className="max-w-md rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">Notifications</h2>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-1 font-medium">Event</th>
            <th className="py-1 text-center font-medium">In-app</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_KINDS.map(({ kind, label }) => (
            <tr key={kind} className="border-t border-gray-100">
              <td className="py-2">{label}</td>
              <td className="py-2 text-center">
                <input
                  type="checkbox"
                  checked={inAppFor(kind)}
                  onChange={(e) => setPref.mutate({ kind, in_app: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PushToggle />
    </div>
  )
}

/**
 * Calendar sync lives on the Calendar page (Subscribe), where the calendar is.
 * It used to be here as well, in a fuller copy; one copy now, and a line here
 * for whoever looks for it in Settings.
 */
function CalendarSyncLink() {
  return (
    <Link
      to="/calendar?subscribe=1"
      className="flex max-w-md items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm hover:bg-gray-50"
    >
      <CalendarDays className="h-4 w-4 text-gray-400" />
      <span className="flex-1">
        <span className="font-medium text-gray-700">Calendar sync</span>
        <span className="text-xs text-gray-500">
          {' '}
          · add the farm calendar to Google, Apple or Outlook
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-gray-400" />
    </Link>
  )
}

/**
 * My account's sections. `?section=` picks one, so the home screen's Edit
 * button can open the tiles directly (/settings?section=home).
 */
type Section = 'profile' | 'security' | 'notifications' | 'home' | 'device'
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'security', label: 'Sign-in security' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'home', label: 'Home screen' },
  { key: 'device', label: 'This device' },
]
const isSection = (v: string | null): v is Section => SECTIONS.some((x) => x.key === v)

/** Your own profile, how you get notified, your home screen and this device. */
function MyAccount() {
  const [search, setSearch] = useSearchParams()
  const fromUrl = search.get('section')
  const section: Section = isSection(fromUrl) ? fromUrl : 'profile'
  const pick = (k: Section) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('section', k)
        return next
      },
      { replace: true },
    )

  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (full_name: string) => {
      const { error } = await supabase.from('users').update({ full_name }).eq('id', profile!.id)
      if (error) throw error
    },
    onSuccess: () => {
      setName(null)
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  return (
    <>
      <PillTabs tabs={SECTIONS} value={section} onChange={pick} className="mb-4 max-w-md" />
      {section === 'profile' && (
        <div className="max-w-md rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">My account</h2>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <label htmlFor="my-name" className="text-xs text-gray-500">
                Name
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="my-name"
                  value={name ?? profile?.full_name ?? ''}
                  onChange={(e) => setName(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={() => name != null && name.trim() && save.mutate(name.trim())}
                  disabled={name == null || name.trim() === profile?.full_name || save.isPending}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Email</span>
              <span className="font-medium text-gray-900">{profile?.email ?? '—'}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Role</span>
              <span className="font-medium capitalize text-gray-900">{profile?.role ?? '—'}</span>
            </div>
            {profile?.role && <p className="text-xs text-gray-500">{ROLE_HELP[profile.role]}</p>}
            {save.isError && (
              <p className="text-xs text-red-600">{(save.error as Error).message}</p>
            )}
          </div>
        </div>
      )}
      {section === 'security' && <AuthenticatorSettings />}
      {section === 'notifications' && (
        <div className="space-y-4">
          <NotificationPrefs />
          <CalendarSyncLink />
        </div>
      )}
      {section === 'home' && (
        <div className="max-w-md">
          <TilesPanel />
        </div>
      )}
      {section === 'device' && (
        <div className="max-w-md space-y-4">
          <OfflinePanel />
          <AppVersionCard />
        </div>
      )}
    </>
  )
}

// Tabbed shell — Account, Users and Integrations under one "Users & Settings"
// entry, mirroring the Grand Forks Concrete settings page. Pill tabs with icons;
// RVR's brand palette rather than that app's slate.
type Tab = 'My Account' | 'Users' | 'Access' | 'Integrations' | 'Farm setup'
const TABS: { key: Tab; icon: typeof Users; managerOnly: boolean; adminOnly?: boolean }[] = [
  { key: 'My Account', icon: UserCircle, managerOnly: false },
  { key: 'Users', icon: Users, managerOnly: true },
  // Admins only: managers do not see who can open what.
  { key: 'Access', icon: ShieldCheck, managerOnly: true, adminOnly: true },
  { key: 'Integrations', icon: Plug, managerOnly: true },
  { key: 'Farm setup', icon: Tractor, managerOnly: true, adminOnly: true },
]

export function SettingsPage({ initialTab }: { initialTab?: Tab } = {}) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  // ?tab=products lets a field page link straight at the price book.
  const [search] = useSearchParams()
  const fromUrl = TABS.find((t) => t.key.toLowerCase() === search.get('tab')?.toLowerCase())?.key
  // ?section= is a part of My account (the home screen's Edit button sends
  // ?section=home), so it opens that tab whatever the default would have been.
  const [tab, setTab] = useState<Tab>(
    fromUrl ?? (search.get('section') ? 'My Account' : undefined) ?? initialTab ?? 'My Account',
  )
  // A setup link from inside Settings (Integrations → Farm setup) changes
  // ?tab= without remounting; follow it.
  const [seenTab, setSeenTab] = useState(fromUrl)
  if (fromUrl !== seenTab) {
    setSeenTab(fromUrl)
    if (fromUrl) setTab(fromUrl)
  }
  const isAdmin = hasAdminAccess(profile?.role)
  const visible = TABS.filter((t) => (isManager || !t.managerOnly) && (isAdmin || !t.adminOnly))
  // A non-manager who lands on /integrations shouldn't get a blank shell.
  const active = visible.some((t) => t.key === tab) ? tab : 'My Account'

  return (
    <div>
      <div className="border-b border-gray-200 bg-white px-4 pt-4 md:px-6">
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
        <p className="mt-0.5 text-xs text-gray-500">Your account, people, the farm and integrations</p>
        <PillTabs
          className="mt-3 border-b-0"
          value={active}
          onChange={setTab}
          tabs={visible.map((t) => ({
            key: t.key,
            label: (
              <span className="flex items-center gap-2">
                <t.icon className="h-4 w-4" /> {t.key}
              </span>
            ),
          }))}
        />
      </div>

      {active === 'Farm setup' ? (
        <FarmSetupPanel />
      ) : active === 'Users' ? (
        <UsersAdmin />
      ) : active === 'Access' ? (
        <AccessMatrix />
      ) : active === 'Integrations' ? (
        <div className="space-y-4">
          <SatelliteSyncCard />
          <IntegrationsPanel />
        </div>
      ) : (
        <div className="p-4 md:p-6">
          <MyAccount />
        </div>
      )}
    </div>
  )
}

/**
 * Admin: clear someone's authenticator when their phone is lost or replaced.
 * They sign in with their password alone afterwards and can set up a new one.
 */
function ResetAuthenticator({ users, onDone }: { users: ManagedUser[]; onDone: (note: string) => void }) {
  const [who, setWho] = useState('')
  const reset = useMutation({
    mutationFn: async (id: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/mfa-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ id }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; removed?: number }
      if (!res.ok) throw new Error(body.error ?? 'Reset failed')
      return body.removed ?? 0
    },
    onSuccess: (removed) => {
      const u = users.find((x) => x.id === who)
      onDone(removed ? `Authenticator removed for ${u?.full_name || u?.email}. They can sign in with their password and set up a new one.` : `${u?.full_name || u?.email} had no authenticator set up.`)
      setWho('')
    },
  })
  return (
    <div className="mt-3 flex max-w-3xl flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-600">Lost phone? Reset someone&apos;s authenticator:</span>
      <Select
        value={who}
        ariaLabel="Person"
        size="sm"
        className="w-56"
        onChange={setWho}
        options={[{ value: '', label: '— choose a person —' }, ...users.map((u) => ({ value: u.id, label: u.full_name || u.email }))]}
      />
      <button
        disabled={!who || reset.isPending}
        onClick={() => {
          if (window.confirm('Remove this person’s authenticator? Their next sign-in needs only their password.')) reset.mutate(who)
        }}
        className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
      >
        Reset
      </button>
      {reset.isError && <span className="text-xs text-red-600">{(reset.error as Error).message}</span>}
    </div>
  )
}
