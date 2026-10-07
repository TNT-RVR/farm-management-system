import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search, ShieldCheck } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { hasAdminAccess, useAuth, type AppRole } from '@/lib/auth'
import { NAV_ITEMS, type NavItem } from '@/lib/nav'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/**
 * Who can open which section (Settings → Access). Stored as
 * users.denied_views — the closed list — so a new section is open to everyone
 * until someone turns it off. It gates the menu and the routes, not the
 * database (RLS is by role), so it tidies each person's app rather than
 * guarding figures.
 *
 * Redone 7 Oct 2026 (Sam: "a refreshed and more modern and easier to use
 * look … a bit more colour and easier reading what row you are on with users
 * to the far right"):
 *   - each person has a colour, an initials badge and how many sections they
 *     have, and their switches are in their colour;
 *   - the row and the column under the pointer light up across the whole
 *     table, rows are banded, and each section carries its icon, so a switch
 *     far from its label is still easy to place;
 *   - the people sit right beside the section names, not across a wide page;
 *   - a search, expand/collapse all, and "all on" per person.
 */

type AccessUser = { id: string; email: string; full_name: string; role: AppRole; active: boolean; denied_views: string[] | null }

/** One palette per person, written out so Tailwind keeps the classes. */
const PALETTE = [
  { badge: 'bg-sky-600', on: 'bg-sky-600', soft: 'bg-sky-50', text: 'text-sky-800', bar: 'bg-sky-500' },
  { badge: 'bg-emerald-600', on: 'bg-emerald-600', soft: 'bg-emerald-50', text: 'text-emerald-800', bar: 'bg-emerald-500' },
  { badge: 'bg-violet-600', on: 'bg-violet-600', soft: 'bg-violet-50', text: 'text-violet-800', bar: 'bg-violet-500' },
  { badge: 'bg-amber-500', on: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-800', bar: 'bg-amber-400' },
  { badge: 'bg-rose-600', on: 'bg-rose-600', soft: 'bg-rose-50', text: 'text-rose-800', bar: 'bg-rose-500' },
  { badge: 'bg-teal-600', on: 'bg-teal-600', soft: 'bg-teal-50', text: 'text-teal-800', bar: 'bg-teal-500' },
  { badge: 'bg-indigo-600', on: 'bg-indigo-600', soft: 'bg-indigo-50', text: 'text-indigo-800', bar: 'bg-indigo-500' },
  { badge: 'bg-orange-600', on: 'bg-orange-600', soft: 'bg-orange-50', text: 'text-orange-800', bar: 'bg-orange-500' },
] as const

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

/** Every path the matrix sets: each section and each sub-section. */
const ALL_PATHS = NAV_ITEMS.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])

function useAccessUsers() {
  return useQuery({
    queryKey: ['users', 'full'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, email, full_name, role, active, denied_views').order('created_at')
      if (error) throw error
      return data as AccessUser[]
    },
  })
}

/** A small on/off switch in the person's colour. */
function Switch({ on, color, label, disabled, onChange }: { on: boolean; color: string; label: string; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60',
        on ? color : 'bg-gray-300',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

export function AccessMatrix() {
  const { profile } = useAuth()
  const { data: users } = useAccessUsers()
  const qc = useQueryClient()
  const isAdmin = hasAdminAccess(profile?.role)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState<{ row: string | null; col: string | null }>({ row: null, col: null })

  const setAccess = useMutation({
    mutationFn: async ({ id, denied_views }: { id: string; denied_views: string[] }) => {
      const { error } = await supabase.from('users').update({ denied_views }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      void qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })

  const admins = (users ?? []).filter((u) => u.role === 'admin')
  const people = (users ?? []).filter((u) => u.role !== 'admin' && u.active)
  const colour = (i: number) => PALETTE[i % PALETTE.length]
  const denied = (u: AccessUser) => new Set(u.denied_views ?? [])

  const toggle = (u: AccessUser, paths: string[], allow: boolean) => {
    const d = denied(u)
    for (const p of paths) {
      if (allow) d.delete(p)
      else d.add(p)
    }
    setAccess.mutate({ id: u.id, denied_views: [...d] })
  }

  // A search keeps a section when it or one of its sub-sections matches, and opens it to show which.
  const q = query.trim().toLowerCase()
  const items = useMemo(() => {
    if (!q) return NAV_ITEMS.map((item) => ({ item, kids: item.children ?? [], forced: false }))
    return NAV_ITEMS.flatMap((item) => {
      const kids = (item.children ?? []).filter((k) => k.label.toLowerCase().includes(q))
      const self = item.label.toLowerCase().includes(q)
      if (!self && !kids.length) return []
      return [{ item, kids: self ? (item.children ?? []) : kids, forced: kids.length > 0 }]
    })
  }, [q])

  const withKids = NAV_ITEMS.filter((i) => i.children?.length)
  const allOpen = withKids.every((i) => expanded.has(i.to))
  const flip = (to: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(to)) next.delete(to)
      else next.add(to)
      return next
    })

  const rowCls = (key: string, band: boolean) => cn('group transition-colors', hover.row === key ? 'bg-brand-50' : band ? 'bg-gray-50/70' : 'bg-white')
  const labelCls = (key: string, band: boolean) =>
    cn('sticky left-0 z-10 border-r border-gray-100 px-3 py-2', hover.row === key ? 'bg-brand-50' : band ? 'bg-gray-50' : 'bg-white')

  const cells = (key: string, paths: string[], label: string, foldedKids?: NavItem['children']) =>
    people.map((u, i) => {
      const d = denied(u)
      const on = !d.has(paths[0])
      const off = (foldedKids ?? []).filter((k) => d.has(k.to)).length
      return (
        <td
          key={u.id}
          onMouseEnter={() => setHover({ row: key, col: u.id })}
          className={cn('px-3 py-2 text-center', hover.col === u.id && hover.row !== key && colour(i).soft)}
        >
          <span className="inline-flex flex-col items-center gap-0.5">
            <Switch on={on} color={colour(i).on} label={`${label}: ${on ? 'open' : 'hidden'} for ${u.full_name}`} disabled={!isAdmin || setAccess.isPending} onChange={(v) => toggle(u, paths, v)} />
            {/* A folded section still says when a sub-section is off, so the fold never hides a restriction. */}
            {off > 0 && <span className="text-[10px] font-medium text-amber-700">{off} off inside</span>}
          </span>
        </td>
      )
    })

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-gray-900">
          <ShieldCheck className="h-5 w-5 text-brand-700" /> Who can open what
        </h2>
        <InfoPopover title="Section access">
          <p>
            Switch a section off to hide it from that person&apos;s menu and block the page if they type its address. Admins always have every section. It tidies
            each person&apos;s app — it does not restrict what the database hands out, so don&apos;t rely on it to hide sensitive figures.
          </p>
        </InfoPopover>
        {admins.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            Always everything (admin):
            {admins.map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-700 text-[9px] font-bold text-white">{initials(u.full_name)}</span>
                {u.full_name}
              </span>
            ))}
          </span>
        )}
      </div>

      {people.length === 0 ? (
        <p className="text-sm text-gray-500">Everyone is an admin, so there is nothing to set.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a section…"
                className="w-56 rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => setExpanded(allOpen ? new Set() : new Set(withKids.map((i) => i.to)))}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {allOpen ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
            {setAccess.isPending && <span className="text-xs text-gray-400">Saving…</span>}
            {setAccess.isError && <span className="text-xs text-red-600">{(setAccess.error as Error).message}</span>}
          </div>

          <div className="inline-block max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm" onMouseLeave={() => setHover({ row: null, col: null })}>
            <table className="text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-gray-200 bg-white">
                  <th className="sticky left-0 z-30 min-w-56 border-r border-gray-100 bg-white px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Section</th>
                  {people.map((u, i) => {
                    const c = colour(i)
                    const hidden = ALL_PATHS.filter((p) => denied(u).has(p)).length
                    const open = ALL_PATHS.length - hidden
                    return (
                      <th
                        key={u.id}
                        onMouseEnter={() => setHover({ row: null, col: u.id })}
                        className={cn('min-w-28 px-3 py-3 align-bottom font-medium', hover.col === u.id && c.soft)}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm', c.badge)}>{initials(u.full_name)}</span>
                          <span className="whitespace-nowrap text-xs font-semibold text-gray-900">{u.full_name}</span>
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize', c.soft, c.text)}>{u.role}</span>
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-gray-200" title={`${open} of ${ALL_PATHS.length} sections open`}>
                            <span className={cn('block h-full', c.bar)} style={{ width: `${(open / ALL_PATHS.length) * 100}%` }} />
                          </span>
                          <span className="text-[10px] tabular-nums text-gray-500">
                            {open} of {ALL_PATHS.length}
                          </span>
                          {isAdmin && hidden > 0 && (
                            <button type="button" onClick={() => toggle(u, ALL_PATHS, true)} className={cn('text-[10px] font-medium underline', c.text)}>
                              all on
                            </button>
                          )}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map(({ item, kids, forced }, n) => {
                  const Icon = item.icon
                  const open = forced || expanded.has(item.to)
                  const band = n % 2 === 1
                  const hasKids = (item.children ?? []).length > 0
                  return (
                    <Fragment key={item.to}>
                      <tr className={rowCls(item.to, band)} onMouseEnter={() => setHover((h) => ({ ...h, row: item.to }))}>
                        <td className={labelCls(item.to, band)}>
                          {hasKids ? (
                            <button type="button" onClick={() => flip(item.to)} aria-expanded={open} className="flex w-full items-center gap-2 text-left font-medium text-gray-900">
                              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')} />
                              <Icon className="h-4 w-4 shrink-0 text-brand-700" />
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              <span className="rounded-full bg-gray-100 px-1.5 text-[10px] font-normal text-gray-500">{(item.children ?? []).length}</span>
                            </button>
                          ) : (
                            <span className="flex items-center gap-2 pl-[22px] font-medium text-gray-900">
                              <Icon className="h-4 w-4 shrink-0 text-brand-700" />
                              {item.label}
                            </span>
                          )}
                        </td>
                        {cells(item.to, [item.to], item.label, open ? undefined : item.children)}
                      </tr>
                      {open &&
                        kids.map((k) => {
                          const KidIcon = k.icon
                          return (
                            <tr key={k.to} className={rowCls(k.to, band)} onMouseEnter={() => setHover((h) => ({ ...h, row: k.to }))}>
                              <td className={cn(labelCls(k.to, band), 'pl-10')}>
                                <span className="flex items-center gap-2 text-gray-700">
                                  <span className="h-4 w-px bg-gray-300" />
                                  <KidIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                  {k.label}
                                </span>
                              </td>
                              {cells(k.to, [k.to], `${item.label} → ${k.label}`)}
                            </tr>
                          )
                        })}
                    </Fragment>
                  )
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={people.length + 1} className="px-3 py-6 text-center text-sm text-gray-400">
                      No section matches “{query}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
