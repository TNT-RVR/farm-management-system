import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Link2, Wand2 } from 'lucide-react'
import { canSeeFinances, hasManagerAccess, useAuth } from '@/lib/auth'
import { fieldnetConnect } from '@/lib/fieldnet'
import { jdConnect, useIntegrations } from '@/lib/integrations'
import { quickbooksConnect } from '@/lib/quickbooks'
import { googleDriveConnect } from '@/lib/drive-backup'
import { DriveBackupStatus } from './DriveBackupStatus'
import { supabase } from '@/lib/supabase'
import { type GroupState, type KeyStatus, type SetupKey } from '@/lib/setup-keys'
import { cn } from '@/lib/utils'

/*
 * The pieces of a company's keys, used inside each connection's detail on
 * Settings → Connections (pages/connections). The one-card-per-company grid
 * that lived here was Farm setup → Connections until the two views were
 * merged (14 Oct 2026).
 */

async function call(method: 'GET' | 'POST', body?: unknown) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api/setup-keys', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token ?? ''}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error ?? `The server said ${res.status}`)
  return out
}

/** Which keys are set, and where — never their values. Admins only (the server refuses anyone else). */
export function useKeyStatus(enabled = true) {
  return useQuery({
    queryKey: ['setup-keys'],
    enabled,
    queryFn: async () => ((await call('GET')).keys ?? []) as KeyStatus[],
    staleTime: 60_000,
  })
}

function useSaveKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { env: string; value?: string; generate?: boolean }) => call('POST', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup-keys'] }),
  })
}

/** One key: its status, and a box to paste a new value into. */
export function KeyRow({ k, status }: { k: SetupKey; status?: KeyStatus }) {
  const [value, setValue] = useState('')
  const save = useSaveKey()
  const inNetlify = status?.source === 'netlify'
  const inApp = status?.source === 'app'

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-800">{k.label}</span>
        {k.optional && <span className="text-[11px] text-gray-400">optional</span>}
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium',
            inNetlify || inApp ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-500',
          )}
        >
          {inNetlify
            ? 'Set in Netlify'
            : inApp
              ? `Saved here${status?.updated_at ? ` · ${new Date(status.updated_at).toLocaleDateString('en-CA')}` : ''}`
              : 'Not set'}
        </span>
      </div>
      {status?.value && (
        <p className="mt-0.5 select-all text-sm text-gray-900">{status.value}</p>
      )}
      <p className="mt-0.5 text-xs text-gray-500">
        {k.help}{' '}
        {k.link && (
          <a
            href={k.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-brand-700 hover:underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </p>
      {inNetlify ? (
        <p className="mt-1 text-[11px] text-gray-400">
          Netlify&apos;s setting wins; change it there if it needs changing.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {/*
            Not a login: a text box followed by a password box looks like one,
            so the browser filled Sam's saved email and password into
            QuickBooks' client ID and secret (6 Oct 2026). "off" is ignored on
            password boxes; "new-password" stops the browser filling a saved
            one, and the data-* attributes keep the password managers out.
          */}
          <input
            type={k.secret ? 'password' : 'text'}
            name={`setup-key-${k.env}`}
            autoComplete={k.secret ? 'new-password' : 'off'}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={inApp ? 'Paste a new value to replace it' : 'Paste it here'}
            className="min-w-0 flex-1 basis-56 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm"
          />
          <button
            disabled={!value.trim() || save.isPending}
            onClick={() => save.mutate({ env: k.env, value }, { onSuccess: () => setValue('') })}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
          {k.generate && !inApp && (
            <button
              disabled={save.isPending}
              onClick={() => save.mutate({ env: k.env, generate: true })}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Wand2 className="h-3.5 w-3.5" /> Generate
            </button>
          )}
          {inApp && (
            <button
              disabled={save.isPending}
              onClick={() => save.mutate({ env: k.env, value: '' })}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>
      )}
      {save.isError && <p className="mt-1 text-xs text-red-600">{(save.error as Error).message}</p>}
    </div>
  )
}

/**
 * The integrations that need a sign-in as well as keys: the keys only
 * identify the app; the farm still has to sign in to the company once and let
 * the app in. Connect sits on the keys card so the two steps are in one place
 * (Sam, 7 Oct 2026), and the sign-in comes back here (?from=setup).
 */
const SIGN_IN: Record<string, { provider: string; name: string; param: string; connect: (from: 'setup') => Promise<string>; who: 'manager' | 'finance' }> = {
  'John Deere Operations Center': { provider: 'john_deere', name: 'John Deere', param: 'jd', connect: jdConnect, who: 'manager' },
  'Lindsay FieldNET': { provider: 'fieldnet', name: 'FieldNET', param: 'fieldnet', connect: fieldnetConnect, who: 'manager' },
  'QuickBooks Online': { provider: 'quickbooks', name: 'QuickBooks', param: 'qb', connect: quickbooksConnect, who: 'finance' },
  'Google Drive backup': { provider: 'google_drive', name: 'Google Drive', param: 'gd', connect: googleDriveConnect, who: 'finance' },
}

/** Whether a company's keys come with a sign-in row. */
export const hasSignIn = (group: string) => group in SIGN_IN

export function ConnectRow({ group, keysReady }: { group: string; keysReady: boolean }) {
  const cfg = SIGN_IN[group]
  const { profile } = useAuth()
  const { data: integrations } = useIntegrations()
  const [params] = useSearchParams()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!cfg) return null
  const row = integrations?.find((i) => i.provider === cfg.provider)
  const meta = (row?.meta ?? null) as { environment?: string; needs_org_access?: boolean; connections_url?: string } | null
  const connected = row?.status === 'connected'
  const linked = connected || row?.status === 'error'
  const allowed = cfg.who === 'finance' ? canSeeFinances(profile) : hasManagerAccess(profile?.role)
  const back = params.get(`${cfg.param}_connected`)
    ? { ok: true, msg: `${cfg.name} connected.` }
    : params.get(`${cfg.param}_error`)
      ? { ok: false, msg: `Connect failed: ${params.get(`${cfg.param}_error`)}` }
      : null

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
          <Link2 className="h-3.5 w-3.5 text-gray-500" /> Sign in to {cfg.name}
        </span>
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium',
            connected ? 'bg-green-50 text-green-800' : row?.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500',
          )}
        >
          {connected
            ? `Connected${row?.external_org_name ? ` · ${row.external_org_name}` : ''}${cfg.provider === 'quickbooks' ? (meta?.environment === 'production' ? ' · live books' : ' · sandbox') : ''}`
            : row?.status === 'error'
              ? 'Needs attention'
              : 'Not connected'}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        {connected && row?.last_sync_at
          ? `Last sync ${new Date(row.last_sync_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}. `
          : ''}
        The keys above identify the app; this signs the farm in and lets it read.
      </p>
      {back && <p className={cn('mt-1.5 rounded-md px-2.5 py-1.5 text-xs', back.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')}>{back.msg}</p>}
      {row?.last_error && <p className="mt-1 text-xs text-red-600">{row.last_error}</p>}
      {meta?.needs_org_access && meta.connections_url && (
        <a href={meta.connections_url} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline">
          John Deere still needs you to choose which organizations the app may read <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {allowed ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            disabled={!keysReady || busy}
            onClick={async () => {
              setErr(null)
              setBusy(true)
              try {
                window.location.href = await cfg.connect('setup')
              } catch (e) {
                setErr((e as Error).message)
                setBusy(false)
              }
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50',
              linked ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50' : 'bg-brand-700 text-white hover:bg-brand-800',
            )}
          >
            {busy ? 'Opening…' : linked ? 'Reconnect' : `Connect ${cfg.name}`}
          </button>
          {!keysReady && <span className="text-[11px] text-gray-400">Save the keys above first.</span>}
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-gray-400">
          {cfg.who === 'finance' ? 'Connecting the books is for the owners and the farm’s accountant.' : 'Connecting is for managers.'}
        </p>
      )}
      {cfg.provider === 'google_drive' && connected && allowed && <DriveBackupStatus />}
    </div>
  )
}

/**
 * A colour per company, so each card is told apart at a glance. Static class
 * names (Tailwind only ships what it can see written out); anything not listed
 * takes the brand colour.
 */
const ACCENT: Record<string, { edge: string; badge: string }> = {
  'Your site': { edge: 'border-l-slate-500', badge: 'bg-slate-600' },
  'AI features': { edge: 'border-l-orange-500', badge: 'bg-orange-500' },
  'John Deere Operations Center': { edge: 'border-l-green-600', badge: 'bg-green-700' },
  'Lindsay FieldNET': { edge: 'border-l-sky-600', badge: 'bg-sky-600' },
  'QuickBooks Online': { edge: 'border-l-emerald-500', badge: 'bg-emerald-600' },
  'Google Drive backup': { edge: 'border-l-blue-500', badge: 'bg-blue-600' },
  'Satellite imagery (Copernicus)': { edge: 'border-l-indigo-500', badge: 'bg-indigo-600' },
  'eShepherd collars': { edge: 'border-l-amber-500', badge: 'bg-amber-600' },
  'SolisCloud solar': { edge: 'border-l-yellow-400', badge: 'bg-yellow-500' },
  'Staff time off': { edge: 'border-l-rose-500', badge: 'bg-rose-600' },
  'Invoices and reports by email': { edge: 'border-l-violet-500', badge: 'bg-violet-600' },
  'Feed sheet (Google Sheets)': { edge: 'border-l-teal-500', badge: 'bg-teal-600' },
  'Email sender (Resend)': { edge: 'border-l-gray-800', badge: 'bg-gray-900' },
}
/** A connection with no keys of its own takes its category's colour (pages/connections). */
const CATEGORY_ACCENT: Record<string, { edge: string; badge: string }> = {
  Machinery: { edge: 'border-l-lime-600', badge: 'bg-lime-700' },
  Irrigation: { edge: 'border-l-cyan-600', badge: 'bg-cyan-600' },
  'Books & bills': { edge: 'border-l-emerald-500', badge: 'bg-emerald-600' },
  'Satellite & weather': { edge: 'border-l-indigo-400', badge: 'bg-indigo-500' },
  Cattle: { edge: 'border-l-amber-500', badge: 'bg-amber-600' },
  'Sensors & PLC': { edge: 'border-l-stone-500', badge: 'bg-stone-600' },
  'Email & messages': { edge: 'border-l-violet-500', badge: 'bg-violet-600' },
  AI: { edge: 'border-l-orange-500', badge: 'bg-orange-500' },
  Site: { edge: 'border-l-slate-500', badge: 'bg-slate-600' },
}
export const accentOf = (g: string, category?: string) =>
  ACCENT[g] ?? (category ? CATEGORY_ACCENT[category] : undefined) ?? { edge: 'border-l-brand-700', badge: 'bg-brand-700' }

export function GroupBadge({
  state,
  set,
  total,
}: {
  state: GroupState
  set: number
  total: number
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        state === 'connected' && 'bg-green-100 text-green-800',
        state === 'partial' && 'bg-amber-100 text-amber-800',
        state === 'none' && 'bg-gray-100 text-gray-600',
        state === 'optional' && 'bg-gray-50 text-gray-500',
      )}
    >
      {state === 'connected'
        ? 'Connected'
        : state === 'partial'
          ? `${set} of ${total} set`
          : state === 'none'
            ? 'Not set up'
            : 'Optional'}
    </span>
  )
}

/** The company's mark: its initial on its colour. */
export function CompanyMark({ group, category, className }: { group: string; category?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white',
        accentOf(group, category).badge,
        className,
      )}
    >
      {group
        .replace(/^(Your|Staff)\s/, '')
        .charAt(0)
        .toUpperCase()}
    </span>
  )
}
