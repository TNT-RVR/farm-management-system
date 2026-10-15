import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { CALL_LABEL, GESTATION, REPRO_STATES, mobRanch, readAnimal, stateInfo, type Call } from '@/lib/pregnancy'
import { useRanches } from '@/lib/ranches'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'

type Animal = {
  animal_id: string
  tag: string
  mob: string
  state: string
  state_start: string | null
  last_heat: string | null
  days_since_heat: number | null
  observed_on: string
  synced_at: string
  heats: string[]
}

const CALL_STYLE: Record<Call, string> = {
  pregnant: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  open: 'bg-red-50 text-red-800 border-red-200',
  unsure: 'bg-amber-50 text-amber-900 border-amber-200',
}
const md = (iso: string | null | undefined) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—')
const byTag = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

/**
 * A date that is set once in a while: shown as text with Edit, and while
 * editing a date box with Save and Cancel — so it is plain whether it saved.
 */
function DateSetting({ label, hint, value, canEdit, onSave }: { label: string; hint?: string; value: string | null; canEdit: boolean; onSave: (d: string | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const save = async () => {
    setState('saving')
    try {
      await onSave(draft || null)
      setState('saved')
      setEditing(false)
      setTimeout(() => setState('idle'), 2500)
    } catch {
      setState('error')
    }
  }
  if (!editing)
    return (
      <span className="flex items-center gap-1 text-xs text-gray-500" title={hint}>
        {label}: <b className="text-gray-800">{value ? md(value) : 'not set'}</b>
        {state === 'saved' && <span className="font-medium text-emerald-700">✓ saved</span>}
        {canEdit && (
          <button type="button" onClick={() => { setDraft(value ?? ''); setEditing(true) }} className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50">
            {value ? 'Edit' : 'Set'}
          </button>
        )}
      </span>
    )
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      {label}
      <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded border border-gray-300 px-1 py-0.5 text-xs" />
      <button type="button" disabled={state === 'saving'} onClick={() => void save()} className="rounded bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50">
        {state === 'saving' ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => { setEditing(false); setState('idle') }} className="text-[11px] text-gray-500 hover:underline">
        Cancel
      </button>
      {state === 'error' && <span className="text-red-600">didn’t save</span>}
    </span>
  )
}

type SortKey = 'tag' | 'mob' | 'call' | 'status' | 'since' | 'heat' | 'due' | 'inState'
const CALL_ORDER: Record<Call, number> = { pregnant: 0, unsure: 1, open: 2 }

/**
 * eShepherd's pregnancy tracking, ranch by ranch: each collared cow and heifer
 * with a plain call — pregnant, not pregnant, unsure — and a due-date range.
 * Bulls are left out. Pulled from eShepherd once a week.
 */
export function PregnancyTab({ ranchId, ranches, isManager }: { ranchId: string; ranches: { id: string; name: string }[]; isManager: boolean }) {
  const qc = useQueryClient()
  const { data: animals, isLoading } = useQuery({
    queryKey: ['eshepherd_repro'],
    queryFn: async () => {
      const { data, error } = await supabase.from('eshepherd_repro').select('animal_id, tag, mob, state, state_start, last_heat, days_since_heat, observed_on, synced_at, heats')
      if (error) throw error
      return (data ?? []) as Animal[]
    },
  })
  const { data: fullRanches } = useRanches()
  const { cattleBreed } = useFarmSettings()
  const bullDates = useMemo(() => new Map((fullRanches ?? []).map((r) => [r.id, r.bulls_in_on ?? null])), [fullRanches])
  // Heifers can go in with the bulls on a different day; blank = the cows' date.
  const heiferDates = useMemo(() => new Map((fullRanches ?? []).map((r) => [r.id, r.heifer_bulls_in_on ?? null])), [fullRanches])
  const bullDateFor = (ranchId: string | null, mob: string) =>
    !ranchId ? null : /heifer/i.test(mob) ? (heiferDates.get(ranchId) ?? bullDates.get(ranchId) ?? null) : (bullDates.get(ranchId) ?? null)
  const setBulls = async (id: string, date: string | null, heifers = false) => {
    const { error } = await supabase.from('ranches').update(heifers ? { heifer_bulls_in_on: date } : { bulls_in_on: date }).eq('id', id)
    if (error) throw error
    void qc.invalidateQueries({ queryKey: ['ranches'] })
  }
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [call, setCall] = useState<'' | Call>('')
  const [status, setStatus] = useState('')
  const [mob, setMob] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'call', dir: 1 })

  const refresh = async () => {
    setRefreshing('Pulling from eShepherd…')
    const {
      data: { session },
    } = await supabase.auth.getSession()
    // A background job: it answers 202 at once and writes about half a minute later.
    const r = await fetch('/.netlify/functions/eshepherd-repro-sync-background', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    if (!(r.ok || r.status === 202)) {
      setRefreshing(`Couldn't start (${r.status})`)
      return
    }
    for (const ms of [30_000, 60_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ['eshepherd_repro'] }), ms)
    setTimeout(() => setRefreshing(null), 61_000)
  }

  // Each animal's ranch from her mob's name; bulls and trough collars dropped.
  const rows = useMemo(
    () =>
      (animals ?? []).flatMap((a) => {
        const m = mobRanch(a.mob, ranches)
        if (m.skip) return []
        const info = stateInfo(a.state)
        // Read against the breeding season where the ranch's bull date is set.
        const bullsIn = bullDateFor(m.ranchId, a.mob)
        const read = readAnimal({ state: a.state, last_heat: a.last_heat, heats: a.heats ?? [] }, bullsIn, a.observed_on)
        // Days since her last detected heat — only where a heat has been seen.
        return [{ ...a, days_since_heat: a.last_heat ? a.days_since_heat : null, ranchId: m.ranchId, info, call: read.call, why: read.why, due: read.due, tooEarly: read.tooEarlyUntil != null }]
      }),
    [animals, ranches, bullDates, heiferDates], // eslint-disable-line react-hooks/exhaustive-deps
  )
  type R = (typeof rows)[number]

  const filtered = rows.filter(
    (a) =>
      (!call || a.call === call) &&
      (!status || a.state === status) &&
      (!mob || a.mob === mob) &&
      (!q.trim() || a.tag.toLowerCase().includes(q.trim().toLowerCase())),
  )
  const cmp = (a: R, b: R): number => {
    const k = sort.key
    const nul = (x: string | number | null | undefined) => x == null
    const v = (x: R): string | number | null =>
      k === 'tag' ? x.tag : k === 'mob' ? x.mob : k === 'call' ? CALL_ORDER[x.call] : k === 'status' ? x.info.label : k === 'since' ? x.days_since_heat : k === 'heat' ? x.last_heat : k === 'due' ? (x.due?.likely ?? null) : x.state_start
    const va = v(a)
    const vb = v(b)
    if (nul(va) && nul(vb)) return byTag(a.tag, b.tag)
    if (nul(va)) return 1
    if (nul(vb)) return -1
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : k === 'tag' ? byTag(String(va), String(vb)) : String(va).localeCompare(String(vb))
    return c * sort.dir || byTag(a.tag, b.tag)
  }

  const sections =
    ranchId === ''
      ? [...ranches.map((r) => ({ id: r.id as string | null, name: r.name })), { id: null, name: 'Other mobs (not named for a ranch)' }]
      : [{ id: ranchId as string | null, name: ranches.find((r) => r.id === ranchId)?.name ?? '' }]
  const synced = (animals ?? []).map((a) => a.observed_on).sort().pop()
  const mobs = [...new Set(rows.filter((r) => ranchId === '' || r.ranchId === ranchId).map((r) => r.mob))].sort()
  const header = (key: SortKey, label: string, right = false) => (
    <th className={cn('px-2 py-1.5 font-medium', right && 'text-right')}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-0.5 uppercase hover:text-gray-700">
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-gray-900">
            Pregnancy — eShepherd collars
            <InfoPopover title="What the eShepherd statuses mean" label="what it means" width={520}>
              <p>
                The collars detect heats (standing and mounting activity). eShepherd’s model reports what it saw — heats, or their absence — and never claims a cause. The app turns
                that into a simple call:
              </p>
              <p>
                <b className="text-emerald-800">Pregnant</b> — “No cycling detected”: no heat for about two and a half cycles (about 7–8 weeks). That’s the collar’s pregnancy
                signal, but illness, poor condition, a cow not cycling at all, or a collar problem look the same, so preg-check to confirm.
              </p>
              <p>
                <b className="text-red-800">Not pregnant</b> — cycling: heats are still coming every three weeks or so.
              </p>
              <p>
                <b className="text-amber-800">Unsure</b> — somewhere in between, or not enough data to call.
              </p>
              <ul className="list-disc space-y-1 pl-4">
                {Object.values(REPRO_STATES).map((s) => (
                  <li key={s.label}>
                    <b>{s.label}</b> ({CALL_LABEL[s.call].toLowerCase()}
                    {s.leaning ? `, ${s.leaning}` : ''}): {s.note}
                  </li>
                ))}
              </ul>
              <p>
                <b>Due date</b>: counted from her last detected heat, taken as when she was bred. {cattleBreed} cattle carry a calf about {GESTATION.mean} days (usually {GESTATION.early}–
                {GESTATION.late}), so the range is those days after that heat. If the collar missed the heat she actually caught on, she’ll calve about three weeks later than shown.
                For “Overdue” and “Likely not cycling” the date is shown in grey: it holds only if she settled at that heat.
              </p>
              <p>
                <b>Bulls-in date</b>: eShepherd only says “No cycling detected” about 53 days after the heat she was bred on, so a cow bred since the bulls went in reads Cycling or
                Overdue for a while. The line under each ranch counts them: <i>too early to tell</i> had one heat since the bulls and none after — likely bred; <i>came back</i> came
                back into heat after the bulls went in; <i>stopped before the bulls</i> stopped cycling before the bulls went in — not bred by them; check them. Until the date is
                set, a cow that stopped cycling before the bulls counts as pregnant, and a cow bred in the last seven weeks counts as not pregnant.
              </p>
              <p className="text-gray-400">Source: eShepherd’s reproductive-state dashboard (model 2.0.0), pulled every Monday.</p>
            </InfoPopover>
          </h2>
          <p className="text-xs text-gray-500">
            {synced ? `As of ${md(synced)}` : 'Not pulled yet'} · pulled from eShepherd every Monday · bulls left out
            {refreshing && <span className="ml-1 text-gray-700">· {refreshing}</span>}
          </p>
        </div>
        {isManager && (
          <button type="button" onClick={() => void refresh()} className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            <RefreshCw className={cn('h-4 w-4', refreshing === 'Pulling from eShepherd…' && 'animate-spin')} /> Refresh now
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-2 text-xs">
        <label className="text-gray-500">
          Call
          <Select value={call} size="sm" ariaLabel="Call" className="mt-0.5 w-36" onChange={(v) => setCall(v as '' | Call)} options={[{ value: '', label: 'All' }, ...(['pregnant', 'open', 'unsure'] as Call[]).map((c) => ({ value: c, label: CALL_LABEL[c] }))]} />
        </label>
        <label className="text-gray-500">
          eShepherd status
          <Select value={status} size="sm" ariaLabel="Status" className="mt-0.5 w-52" onChange={setStatus} options={[{ value: '', label: 'All' }, ...Object.entries(REPRO_STATES).map(([k, s]) => ({ value: k, label: s.label }))]} />
        </label>
        <label className="text-gray-500">
          Mob
          <Select value={mob} size="sm" ariaLabel="Mob" className="mt-0.5 w-56" onChange={setMob} options={[{ value: '', label: 'All' }, ...mobs.map((m) => ({ value: m, label: m }))]} />
        </label>
        <label className="text-gray-500">
          Tag
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="mt-0.5 block w-28 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        </label>
        {(call || status || mob || q) && (
          <button type="button" onClick={() => { setCall(''); setStatus(''); setMob(''); setQ('') }} className="pb-1 text-brand-700 hover:underline">
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-gray-400">Loading…</p>
      ) : !rows.length ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">Nothing pulled from eShepherd yet{isManager ? ' — press Refresh now.' : '.'}</p>
      ) : (
        sections.map((sec) => {
          const all = rows.filter((a) => a.ranchId === sec.id)
          if (!all.length) return null
          const shown = filtered.filter((a) => a.ranchId === sec.id).sort(cmp)
          const n = (c: Call) => all.filter((a) => a.call === c).length
          const dueByMonth = new Map<string, number>()
          for (const a of all) if (a.call === 'pregnant' && a.due) dueByMonth.set(a.due.likely.slice(0, 7), (dueByMonth.get(a.due.likely.slice(0, 7)) ?? 0) + 1)
          return (
            <section key={sec.name} className="rounded-lg border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2">
                <h3 className="text-sm font-semibold text-gray-900">{sec.name}</h3>
                <span className="text-xs text-gray-400">{all.length} head</span>
                {(['pregnant', 'open', 'unsure'] as Call[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCall(call === c ? '' : c)} className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', CALL_STYLE[c], call === c && 'ring-2 ring-offset-1')}>
                    {CALL_LABEL[c]} {n(c)}
                  </button>
                ))}
                <span className="text-xs text-gray-500">{all.length ? `${Math.round((n('pregnant') / all.length) * 100)}% pregnant` : ''}</span>
                {sec.id && (
                  <>
                    <DateSetting label="Bulls in, cows" value={bullDates.get(sec.id) ?? null} canEdit={isManager} onSave={(d) => setBulls(sec.id!, d)} />
                    <DateSetting label="heifers" hint="blank = same day as the cows" value={heiferDates.get(sec.id) ?? null} canEdit={isManager} onSave={(d) => setBulls(sec.id!, d, true)} />
                  </>
                )}
                {dueByMonth.size > 0 && (
                  <span className="ml-auto text-[11px] text-gray-500">
                    Due:{' '}
                    {[...dueByMonth]
                      .sort()
                      .map(([m, k]) => `${new Date(m + '-01T00:00:00').toLocaleDateString('en-CA', { month: 'short' })} ${k}`)
                      .join(' · ')}
                  </span>
                )}
              </div>
              {sec.id && (() => {
                const b = bullDates.get(sec.id)
                const tooEarly = all.filter((a) => a.tooEarly).length
                const cameBack = all.filter((a) => a.call === 'open').length
                const before = all.filter((a) => a.why.includes('before the bulls')).length
                if (!b) return <p className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">Set when the bulls went in — until then recent breedings and cows that stopped early are miscalled.</p>
                const days = Math.round((Date.parse((synced ?? b) + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 86_400_000)
                return (
                  <p className="border-b border-gray-100 bg-sky-50/50 px-3 py-1.5 text-xs text-gray-700">
                    Bulls in {md(b)}{heiferDates.get(sec.id) ? ` (heifers ${md(heiferDates.get(sec.id))})` : ''}, {days} days before this reading ·{' '}
                    <span title="Had one heat since the bulls and none after — likely bred, too early to tell">
                      <b>{tooEarly}</b> too early to tell
                    </span>{' '}
                    ·{' '}
                    <span title="Came back into heat after the bulls went in">
                      <b>{cameBack}</b> came back
                    </span>
                    {before > 0 && (
                      <>
                        {' '}
                        ·{' '}
                        <span className="text-amber-800" title="Stopped cycling before the bulls went in — not bred by them; check them">
                          <b>{before}</b> stopped before the bulls — check them
                        </span>
                      </>
                    )}
                  </p>
                )
              })()}
              {shown.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-gray-400">No animals match the filters.</p>
              ) : (
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="sticky top-0 bg-white text-left text-[10px] tracking-wide text-gray-400 shadow-[0_1px_0_#e5e7eb]">
                      <tr>
                        {header('tag', 'Tag')}
                        {header('mob', 'Mob')}
                        {header('call', 'Pregnant?')}
                        {header('status', 'eShepherd status')}
                        {header('heat', 'Last heat')}
                        {header('due', 'Due (range)')}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {shown.map((a) => (
                        <tr key={a.animal_id}>
                          <td className="px-2 py-1 font-medium tabular-nums text-gray-900">{a.tag}</td>
                          <td className="px-2 py-1 text-xs text-gray-500">{a.mob}</td>
                          <td className="px-2 py-1">
                            <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', CALL_STYLE[a.call])}>{CALL_LABEL[a.call]}</span>
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-700" title={a.info.note}>
                            {a.info.label}
                            {a.why && <span className="block text-[11px] text-gray-400">{a.why}</span>}
                          </td>
                          <td
                            className="px-2 py-1 text-xs tabular-nums text-gray-600"
                            title={`${a.days_since_heat != null ? `${a.days_since_heat} days since` : 'No heat on record'} · status since ${md(a.state_start)}`}
                          >
                            {md(a.last_heat)}
                          </td>
                          <td className={cn('px-2 py-1 text-xs tabular-nums', a.due?.tentative ? 'italic text-gray-400' : 'text-gray-900')}>
                            {a.due ? (
                              <>
                                {md(a.due.likely)} <span className="text-gray-400">({md(a.due.from)} – {md(a.due.to)})</span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
