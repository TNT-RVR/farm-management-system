import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tractor, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { supabase } from '@/lib/supabase'
import { droppedBuPerAcre, stubbleCowDays, type Warning } from '@/lib/cattle-nutrition'
import { useStubbleMutations, type HerdCountRow, type StubbleRow } from '@/lib/winter-feeding'
import { addDays, blocking, clashes, untilWord } from '@/lib/grazing-restrictions'
import { useGrazingPicture } from '@/lib/grazing-restrictions-hooks'
import { FeedInfo } from './FeedInfo'
import { Num, WarningList, n0, tonnes } from './bits'

/** This year's corn fields with acres and a yield in bushels (HMC's wet tonnes turned back: 1 t ≈ 32.6 bu). */
function useCornFields(year: number) {
  return useQuery({
    queryKey: ['stubble_corn_fields', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_plans')
        .select('field_id, planned_acres, yield_per_acre_override, crops!inner(name, default_yield_per_acre, yield_unit), fields!inner(name)')
        .eq('crop_year', year)
        .in('crops.name', ['Grain Corn', 'High-Moisture Corn'])
      if (error) throw error
      type Row = { field_id: string; planned_acres: number | null; yield_per_acre_override: number | null; crops: { name: string; default_yield_per_acre: number | null; yield_unit: string | null }; fields: { name: string } }
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const y = Number(r.yield_per_acre_override ?? r.crops.default_yield_per_acre ?? 180)
        const bu = r.crops.yield_unit === 'MT' ? y * 32.6 : y
        return { fieldId: r.field_id, name: r.fields.name, crop: r.crops.name, acres: Number(r.planned_acres ?? 0), yieldBu: Math.round(bu) }
      })
    },
  })
}

export function CornStubble({
  ranchId,
  rows,
  groups,
  isManager,
  savedLb,
}: {
  ranchId: string
  rows: StubbleRow[]
  groups: HerdCountRow[]
  isManager: boolean
  /** Stored feed (as fed) the plan no longer needs, by feed name. */
  savedLb: { name: string; lb: number }[]
}) {
  const m = useStubbleMutations()
  const year = new Date().getFullYear()
  const { data: corn } = useCornFields(year)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ fieldId: '', name: '', acres: '', yieldBu: '180', groupId: '', start: '' })
  const groupOf = (id: string | null) => groups.find((g) => g.id === id)
  const { picture, today } = useGrazingPicture()
  /**
   * What a spray on the field says about grazing it from `start`: a clash
   * (red) when the turn-out falls inside a label's no-grazing window, else a
   * note while one is still running.
   */
  const sprayWarning = (fieldId: string | null, start: string | null): Warning | null => {
    const place = fieldId ? picture?.places.find((p) => p.kind === 'field' && p.id === fieldId) : null
    if (!place) return null
    const from = start ?? today
    const hit = clashes(place.restrictions, { start: from, end: addDays(from, 180) })
    const products = (rs: typeof hit) => [...new Set(rs.map((r) => r.product))].join(', ')
    if (hit.length) return { code: 'SPRAY', level: 'red', text: `Sprayed with ${products(hit)}: the label says no grazing until ${untilWord(hit)}${start ? ' — turn-out is too soon' : ''}. See the field's page for the label.` }
    const off = blocking(place.restrictions, today).filter((r) => r.kind === 'graze')
    return off.length ? { code: 'SPRAY', level: 'amber', text: `Sprayed with ${products(off)}: no grazing until ${untilWord(off)}.` } : null
  }

  // Folded while there are no stubble fields: most winters it is a section
  // looked at once. Keyed on that so it opens when the first field arrives.
  const hasRows = rows.length > 0
  return (
    <Fold
      key={hasRows ? 'rows' : 'none'}
      defaultOpen={hasRows}
      title={
        <span className="flex items-center gap-1.5">
          <Tractor className="h-4 w-4 text-gray-400" /> Corn stubble grazing
        </span>
      }
      summary={hasRows ? `${rows.length} field${rows.length === 1 ? '' : 's'}` : 'none set up'}
      actions={<FeedInfo k="stubble" />}
      bodyClassName="p-0"
    >
      {isManager && !adding && (
        <div className="flex justify-end border-b border-gray-100 px-3 py-1.5">
          <button type="button" onClick={() => setAdding(true)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
            + Stubble field
          </button>
        </div>
      )}
      {adding && (
        <div className="flex flex-wrap items-end gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs">
          <label className="text-gray-500">
            {year} corn field
            <Select
              value={f.fieldId}
              size="sm"
              ariaLabel="Corn field"
              className="mt-0.5 w-56"
              onChange={(id) => {
                const c = corn?.find((x) => x.fieldId === id)
                setF((x) => ({ ...x, fieldId: id, name: c?.name ?? x.name, acres: c ? String(Math.round(c.acres)) : x.acres, yieldBu: c ? String(c.yieldBu) : x.yieldBu }))
              }}
              options={[{ value: '', label: 'Pick, or type below…' }, ...(corn ?? []).map((c) => ({ value: c.fieldId, label: `${c.name} — ${n0(c.acres)} ac ${c.crop}` }))]}
            />
          </label>
          <label className="text-gray-500">
            Name
            <input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} className="mt-0.5 block w-40 rounded border border-gray-300 px-1.5 py-1 text-sm" />
          </label>
          <label className="text-gray-500">
            Acres
            <input value={f.acres} onChange={(e) => setF((x) => ({ ...x, acres: e.target.value }))} inputMode="decimal" className="mt-0.5 block w-20 rounded border border-gray-300 px-1.5 py-1 text-sm tabular-nums" />
          </label>
          <label className="text-gray-500">
            Yield, bu/ac
            <input value={f.yieldBu} onChange={(e) => setF((x) => ({ ...x, yieldBu: e.target.value }))} inputMode="decimal" className="mt-0.5 block w-20 rounded border border-gray-300 px-1.5 py-1 text-sm tabular-nums" />
          </label>
          <label className="text-gray-500">
            Group grazing it
            <Select value={f.groupId} size="sm" ariaLabel="Group" className="mt-0.5 w-44" onChange={(v) => setF((x) => ({ ...x, groupId: v }))} options={[{ value: '', label: 'Choose…' }, ...groups.map((g) => ({ value: g.id, label: `${g.class_name} (${g.head_count})` }))]} />
          </label>
          <label className="text-gray-500">
            Turn out
            <input type="date" value={f.start} onChange={(e) => setF((x) => ({ ...x, start: e.target.value }))} className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 text-sm" />
          </label>
          <button
            type="button"
            disabled={!f.name.trim() || !(Number(f.acres) > 0) || !(Number(f.yieldBu) > 0) || m.save.isPending}
            onClick={() =>
              m.save.mutate(
                { ranch_id: ranchId, field_id: f.fieldId || null, name: f.name.trim(), acres: Number(f.acres), yield_bu: Number(f.yieldBu), herd_count_id: f.groupId || null, start_date: f.start || null },
                { onSuccess: () => setAdding(false) },
              )
            }
            className="rounded-md bg-brand-700 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
          >
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-gray-500">
            Cancel
          </button>
          {m.save.isError && <span className="text-red-600">{(m.save.error as Error).message}</span>}
          {(() => {
            const w = sprayWarning(f.fieldId || null, f.start || null)
            return w ? <div className="w-full"><WarningList warnings={[w]} /></div> : null
          })()}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-3 py-5 text-center text-xs text-gray-400">No stubble in the plan. Add a corn field the cattle will graze and the feed it saves comes off the season.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map((s) => {
            const g = groupOf(s.herd_count_id)
            const w = g ? Number(g.avg_weight_lb) : 1300
            const cd = stubbleCowDays(Number(s.acres), Number(s.yield_bu), Number(s.weather_loss_pct), w)
            const daysForGroup = g && g.head_count > 0 ? cd.cowDays / g.head_count : null
            const dropped = s.ears_counted == null ? null : droppedBuPerAcre(Number(s.ears_counted))
            const warnings: Warning[] = []
            const spray = sprayWarning(s.field_id, s.start_date)
            if (spray) warnings.push(spray)
            if (dropped != null && dropped >= 8) warnings.push({ code: 'W19', level: 'red', text: `About ${n0(dropped)} bu/ac on the ground — strip graze, step cattle onto it over 7–10 days, and never turn out hungry.` })
            if (s.snow_state === 'snow') warnings.push({ code: 'W20', level: 'amber', text: '6 inches of snow or ¼ inch of ice: half graze, half feed — the plan counts these as half days.' })
            if (s.snow_state === 'crust') warnings.push({ code: 'W20', level: 'red', text: 'Ice crust: they can’t graze it — full feed until it opens.' })
            if (g && g.feed_class !== 'cow') warnings.push({ code: 'W21', level: 'amber', text: `${g.class_name} need protein from day one on stalks (heifers and calves: 0.4–0.9 lb supplemental protein a day).` })
            else if (g) warnings.push({ code: 'W21', level: 'notice', text: 'Dry cows: salt, mineral and vitamin A while corn still shows in the manure; then about 5 lb of alfalfa a day for protein.' })
            if (Number(s.yield_bu) >= 225) warnings.push({ code: 'W19b', level: 'notice', text: 'Over 225 bu: the leaf is poorer — stocked 10% lighter.' })
            const upd = (patch: Parameters<typeof m.save.mutate>[0]) => m.save.mutate({ ...patch })
            const base = { id: s.id, ranch_id: s.ranch_id, name: s.name, acres: Number(s.acres), yield_bu: Number(s.yield_bu) }
            return (
              <div key={s.id} className="space-y-2 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {s.name} <span className="font-normal text-gray-500">· {n0(Number(s.acres))} ac · {n0(Number(s.yield_bu))} bu/ac</span>
                    </p>
                    <p className="text-xs text-gray-600">
                      {n0(cd.cowDays)} cow-days ({n0(cd.cowDays / Number(s.acres))} an acre at {n0(w)} lb)
                      {g && daysForGroup != null && (
                        <>
                          {' '}
                          — <b>{n0(daysForGroup)} days</b> for {g.class_name.toLowerCase()} ({g.head_count} head)
                        </>
                      )}
                      {!g && <span className="text-amber-700"> — pick the group that grazes it</span>}
                    </p>
                  </div>
                  {isManager && (
                    <button type="button" onClick={() => m.remove.mutate(s.id)} className="text-gray-300 hover:text-red-600" aria-label={`Remove ${s.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-xs text-gray-500">
                  <label>
                    Group
                    <Select value={s.herd_count_id ?? ''} size="sm" disabled={!isManager} ariaLabel="Group" className="mt-0.5 w-44" onChange={(v) => upd({ ...base, herd_count_id: v || null })} options={[{ value: '', label: 'Choose…' }, ...groups.map((x) => ({ value: x.id, label: `${x.class_name} (${x.head_count})` }))]} />
                  </label>
                  <label>
                    Turn out
                    <input type="date" defaultValue={s.start_date ?? ''} disabled={!isManager} onBlur={(e) => e.target.value !== (s.start_date ?? '') && upd({ ...base, start_date: e.target.value || null })} className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 text-sm" />
                  </label>
                  <label>
                    Wind/chinook loss
                    <span className="mt-0.5 block">
                      <Num value={Number(s.weather_loss_pct)} step="5" min={0} max={60} suffix="%" disabled={!isManager} onCommit={(v) => v != null && upd({ ...base, weather_loss_pct: v })} />
                    </span>
                  </label>
                  <label>
                    Ears counted (3 × 100 ft)
                    <span className="mt-0.5 block">
                      <Num value={s.ears_counted == null ? null : Number(s.ears_counted)} step="1" min={0} disabled={!isManager} onCommit={(v) => upd({ ...base, ears_counted: v })} allowEmpty placeholder="—" />
                      {dropped != null && <span className="ml-1">= {n0(dropped)} bu/ac</span>}
                    </span>
                  </label>
                  <label>
                    Field now
                    <Select
                      value={s.snow_state}
                      size="sm"
                      disabled={!isManager}
                      ariaLabel="Snow"
                      className="mt-0.5 w-48"
                      onChange={(v) => upd({ ...base, snow_state: v as StubbleRow['snow_state'] })}
                      options={[
                        { value: 'open', label: 'Open — grazing' },
                        { value: 'snow', label: '6"+ snow or ¼" ice — half' },
                        { value: 'crust', label: 'Ice crust — full feed' },
                      ]}
                    />
                  </label>
                </div>
                <WarningList warnings={warnings} />
              </div>
            )
          })}
        </div>
      )}
      {savedLb.length > 0 && (
        <HelpNote
          className="border-t border-gray-100 px-3 py-2 text-xs text-emerald-800"
          summary={<>Stalks save this winter: {savedLb.map((s) => `${tonnes(s.lb)} t ${s.name.toLowerCase()}`).join(' · ')} — keep backup feed, snow can end it any day.</>}
          title="What the stalks save"
        >
          <p>
            Stalks save this winter: {savedLb.map((s) => `${tonnes(s.lb)} t ${s.name.toLowerCase()}`).join(' · ')} (as fed, with the waste that feed would have had). Keep backup
            feed for the full grazing period — snow can end it any day.
          </p>
        </HelpNote>
      )}
    </Fold>
  )
}
