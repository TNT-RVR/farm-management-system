import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { licencePools, seasonLeft, type FieldNeed, type Pool, type PoolLicence, type PoolPivot } from '@/lib/licence-pools'
import { allottedInchesFor, smridAllotmentFor, type YearAllotment } from '@/lib/water-allocation'
import { fieldNeedResolver, useFieldNeedInputs } from '@/lib/field-water-need-data'
import { cn } from '@/lib/utils'
import { useFarmSettings, useFeature } from '@/lib/farm-setup'
import { InfoPopover } from '@/components/InfoPopover'
import { useDistrictRate } from '@/lib/irrigation'

const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-CA'))
const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 }))
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n0(Math.abs(v))}`

const sourceLabel = (source: string, district: string): string =>
  ({ oldman_river: 'Oldman River', south_saskatchewan_river: 'South Saskatchewan River', smrid: `${district} canal` })[source] ?? source

function useWaterRights(year: number) {
  return useQuery({
    queryKey: ['water_rights', year],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [pivots, licences, plans, crops, events, allot] = await Promise.all([
        supabase
          .from('field_pivots')
          .select('field_id, acres_irrigated, acre_feet_allotment, alloted_inches, water_source, water_licence_id, licence_note, smrid_area, fields!inner(name, active)')
          .eq('fields.active', true),
        supabase.from('water_licences').select('*').order('priority_date', { ascending: true, nullsFirst: false }),
        supabase.from('crop_plans').select('field_id, crop_id, planned_acres').eq('crop_year', year),
        supabase.from('crops').select('id, name, irrigation_need_in'),
        supabase.from('irrigation_events').select('field_id, gross_mm, net_mm').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
        supabase.from('water_allotments').select('year, inches, contract_inches').eq('source', 'smrid'),
      ])
      for (const r of [pivots, licences, plans, crops, events, allot]) if (r.error) throw r.error
      return { pivots: pivots.data ?? [], licences: licences.data ?? [], plans: plans.data ?? [], crops: crops.data ?? [], events: events.data ?? [], allot: (allot.data ?? []) as YearAllotment[] }
    },
  })
}

/**
 * Every field by where its water comes from — the Oldman or the South
 * Saskatchewan under a licence, or the SMRID canal — with each licence as
 * one shared bucket: the fields on it, their even shares, what the planned
 * crops need, what is used, and the room to move water between them.
 */
export function useWaterRightsView(year: number) {
  const thisYear = new Date().getFullYear()
  const { data, isLoading } = useWaterRights(year)
  const needInputs = useFieldNeedInputs()
  const { districtName } = useFarmSettings()
  const allotmentOn = useFeature('district_allotment')
  const view = useMemo(() => {
    if (!data) return null
    const acresOf = (p: (typeof data.pivots)[number]) => (p.acres_irrigated == null ? null : Number(p.acres_irrigated))
    // The crop on each field that year (the biggest planned piece), and what
    // it needs on this field: the Alberta figure moved for the field's soil,
    // pivot and AIMM seasons. Until those load, the crop's farm figure.
    const resolve = fieldNeedResolver(needInputs.data)
    const needs = new Map<string, FieldNeed>()
    const byField = new Map<string, { crop_id: string; planned_acres: number | null }[]>()
    for (const p of data.plans) byField.set(p.field_id, [...(byField.get(p.field_id) ?? []), p])
    for (const [fid, rows] of byField) {
      const top = [...rows].sort((a, b) => Number(b.planned_acres ?? 0) - Number(a.planned_acres ?? 0))[0]
      const c = data.crops.find((x) => x.id === top.crop_id)
      const n = resolve?.(fid, top.crop_id)
      needs.set(fid, {
        crop: c?.name ?? null,
        needIn: n ? (n.needIn == null ? null : Math.round(n.needIn * 10) / 10) : c?.irrigation_need_in == null ? null : Number(c.irrigation_need_in),
        why: n ? n.parts.join('; ') : undefined,
      })
    }
    // Used this year, acre-feet, from the gross depth FieldNET logged.
    const used = new Map<string, number>()
    for (const e of data.events) {
      const piv = data.pivots.find((p) => p.field_id === e.field_id)
      const ac = piv ? acresOf(piv) : null
      if (!ac) continue
      used.set(e.field_id, (used.get(e.field_id) ?? 0) + ((Number(e.gross_mm ?? e.net_mm ?? 0) / 25.4) * ac) / 12)
    }
    const poolPivots: PoolPivot[] = data.pivots.map((p) => ({
      fieldId: p.field_id,
      name: (p.fields as unknown as { name: string }).name,
      acres: acresOf(p),
      licenceId: p.water_licence_id,
      shareAf: p.acre_feet_allotment == null ? null : Number(p.acre_feet_allotment),
      pending: /^Pending/i.test(p.licence_note ?? ''),
    }))
    const lic: PoolLicence[] = data.licences.map((l) => ({
      id: l.id,
      number: l.licence_number ?? '',
      source: l.source ?? null,
      status: l.status ?? null,
      holder: l.holder ?? null,
      volumeAf: l.volume == null ? null : Number(l.volume),
    }))
    const left = year === thisYear ? seasonLeft(new Date().toLocaleDateString('en-CA')) : 1
    const pools = licencePools(poolPivots, lic, needs, used, left)
    const smrid = smridAllotmentFor(data.allot, year)
    const canal = data.pivots
      .filter((p) => p.water_source === 'smrid' || p.smrid_area != null)
      .map((p) => {
        const name = (p.fields as unknown as { name: string }).name
        const ac = acresOf(p)
        const n = needs.get(p.field_id)
        // smrid.com's figure, unless this pivot carries its own override.
        const allot = allottedInchesFor(p, smrid.inches)
        return {
          fieldId: p.field_id,
          name,
          acres: ac,
          allotIn: allot.inches,
          allotFrom: allot.from,
          allotAf: ac != null && allot.inches != null ? (ac * allot.inches) / 12 : null,
          crop: n?.crop ?? null,
          needIn: n?.needIn ?? null,
          needWhy: n?.why ?? null,
          usedAf: used.get(p.field_id) ?? 0,
        }
      })
    return { pools, smrid, canal, pivots: data.pivots, licences: data.licences as Record<string, unknown>[], district: districtName, allotmentOn }
  }, [data, year, thisYear, needInputs.data, districtName, allotmentOn])
  return { view, isLoading, thisSeason: year === thisYear }
}

export type WaterRightsView = NonNullable<ReturnType<typeof useWaterRightsView>['view']>

/** Where one field's water comes from, in the words the PDF and the page share. */
export function fieldWaterRights(view: WaterRightsView | null, fieldId: string) {
  if (!view) return null
  const pool = view.pools.find((p) => p.fields.some((f) => f.fieldId === fieldId)) ?? null
  const canal = view.canal.find((c) => c.fieldId === fieldId) ?? null
  const pivot = view.pivots.find((p) => p.field_id === fieldId) ?? null
  return {
    pool,
    detail: pool ? (view.licences.find((l) => l.id === pool.licence.id) ?? null) : null,
    canal,
    pivot,
    source: pivot?.water_source ? sourceLabel(pivot.water_source, view.district) : null,
    note: pivot?.licence_note ?? null,
    smrid: view.smrid,
    /** The irrigation district's name (the farm setting), for the canal's wording. */
    district: view.district,
  }
}

/**
 * This field's water right: its licence and every field sharing it (water can
 * move between them), or its SMRID parcel, or what is missing.
 */
export function FieldWaterRights({ fieldId, view, thisSeason, year }: { fieldId: string; view: WaterRightsView | null; thisSeason: boolean; year: number }) {
  const w = fieldWaterRights(view, fieldId)
  if (!view || !w) return <p className="py-3 text-center text-xs text-gray-400">Reading the licences…</p>
  if (!w.pivot)
    return (
      <p className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600">
        No pivot is linked to this field, so there is no water right on file.{' '}
        <Link to="/irrigation-info?tab=pivot" className="underline">
          Pivot Information
        </Link>
      </p>
    )
  return (
    <div className="space-y-2">
      {w.pool && w.detail && (
        <>
          <p className="text-xs text-gray-600">
            On the {w.source ?? 'river'} under licence <b>{w.pool.licence.number}</b>
            {w.pool.fields.length > 1 ? ` — shared with ${w.pool.fields.filter((f) => f.fieldId !== fieldId).map((f) => f.name).join(', ')}, so water can move between them.` : '.'}
          </p>
          <LicenceCard pool={w.pool} detail={w.detail} thisSeason={thisSeason} highlight={fieldId} />
        </>
      )}
      {/* The canal's allotment and use are the Used / Allowed figures just above
          (FieldAllocation, in the same Water allowance card), so this is one
          line: the crop's need against it, the acres and the acre-feet. */}
      {/* The canal line is the district allotment's, hidden with its switch. */}
      {w.canal && view.allotmentOn && (
        <p className="text-xs tabular-nums text-gray-600">
          On the {w.district} canal · {w.canal.acres != null ? `${n0(w.canal.acres)} ac` : 'acres not set'} · allowed {n1(w.canal.allotIn)}&quot; (
          {w.canal.allotFrom === 'override' ? 'pivot override' : 'smrid.com'}
          {w.canal.allotAf != null && `, ${n0(w.canal.allotAf)} ac-ft`}) · {w.canal.crop ?? 'no crop'} {year} needs{' '}
          <span
            title={w.canal.needWhy ?? undefined}
            className={cn(w.canal.needIn != null && w.canal.allotIn != null && w.canal.needIn > w.canal.allotIn ? 'font-semibold text-red-700' : 'font-medium text-gray-800')}
          >
            {w.canal.needIn != null ? `${n1(w.canal.needIn)}"` : '—'}
          </span>{' '}
          · used {n0(w.canal.usedAf)} ac-ft <DistrictRules year={year} district={w.district} />
        </p>
      )}
      {!w.pool && !w.canal && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          {w.pivot.water_source ? `${w.source} — no licence on file.` : 'No water source on file.'} {w.note}{' '}
          <Link to="/irrigation-info?tab=pivot" className="underline">
            Set it in Pivot Information
          </Link>
        </p>
      )}
    </div>
  )
}

/**
 * The district's rate and the rules that put a price on its water (SMRID
 * Policy Book, 2026; Sam confirmed 7 Oct 2026). The rate itself is read
 * from the Policy Book each year (smrid-rates-cron).
 */
function DistrictRules({ year, district }: { year: number; district: string }) {
  const { data: rate } = useDistrictRate(year)
  return (
    <InfoPopover title={`${district}: the rate and the rules`} width={360} className="ml-1 align-middle">
      <div className="space-y-1.5 text-xs text-gray-700">
        <p>
          <b>Rate {year}:</b>{' '}
          {rate ? `$${rate.ratePerAcre.toFixed(2)} an assessed acre${rate.minPerParcel != null ? `, at least $${rate.minPerParcel} a parcel` : ''}, plus GST, whatever water is used. 1.5% off when paid January to October; 8% added to arrears each 1 Jan and 1 Jul.` : 'not on file yet — it is read from the Policy Book each January.'}{' '}
          Charged on the fields we pay it on; on the 50/50 and rented fields the landowner pays.
        </p>
        <p>
          <b>No charge an acre-foot.</b> Going over the allotment is a breach: $100 an acre-inch, and water taken without an order counts as two days of allotment
          a day.
        </p>
        <p>
          <b>Moving water:</b> unused allotment can go to any parcel, ours or another farmer&apos;s, on the district&apos;s free transfer form (no deadline).
          The district lists buyers and sellers but publishes no price. Moving irrigation acres to dry land for a year (Alternate Parcel Agreement) is $7.50 an
          acre, $450 minimum, applied for by the second Friday of March.
        </p>
        <p>
          <b>Buying acres:</b> the district buys and sells irrigation acres at $10,000 an acre (2026); a CLHbid sale at Taber in August 2025 went for about $15,400.
        </p>
      </div>
    </InfoPopover>
  )
}

export function LicenceCard({ pool, detail, thisSeason, highlight }: { pool: Pool; detail: Record<string, unknown>; thisSeason: boolean; highlight?: string }) {
  const [open, setOpen] = useState(false)
  const l = pool.licence
  const vol = l.volumeAf
  const room = thisSeason ? pool.spareAf : pool.roomAf
  const over = pool.fields.filter((f) => (f.overShareAf ?? 0) > 0.5)
  const under = pool.fields.filter((f) => (f.overShareAf ?? 0) < -0.5)
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-gray-900">{l.number}</span>
        {l.status && (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', l.status === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-green-50 text-green-800')}>
            {l.status === 'draft' ? 'draft — not signed' : l.status}
          </span>
        )}
        <span className="text-gray-600">
          {vol != null ? `${n1(vol)} ac-ft` : 'volume not on file'} · {n0(pool.acres)} ac
          {vol != null && pool.acres > 0 && ` · ${n1((vol * 12) / pool.acres)}" over them all`}
        </span>
        {l.holder && <span className="text-gray-400">{l.holder}</span>}
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 text-[11px] text-sky-700 underline">
          <FileText className="h-3 w-3" /> {open ? 'hide' : `licence details${pool.fields.length > 1 ? ` · ${pool.fields.length} fields` : ''}`}
        </button>
      </div>
      {open && (
        <dl className="mt-1.5 grid gap-x-3 gap-y-0.5 rounded bg-gray-50 p-2 text-[11px] text-gray-700 sm:grid-cols-[auto_1fr]">
          {(
            [
              ['Priority', detail.priority_number],
              ['Also known as', detail.alt_numbers],
              ['Diverts at', detail.points_of_diversion],
              ['Lands', detail.lands],
              ['Rate', detail.rate_of_diversion != null ? `${detail.rate_of_diversion} m³/s` : null],
              ['Expiry', detail.expiry],
              ['Conditions', detail.conditions],
              ['Notes', detail.notes],
            ] as [string, unknown][]
          )
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-medium text-gray-500">{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
      )}
      {/* The fields sharing the licence sit behind the same toggle: the field's
          own Used / Allowed are already on the card above, and the room line
          below says whether the licence as a whole is short. */}
      {open && (
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-2 py-0.5 font-medium">Field</th>
              <th className="px-2 py-0.5 text-right font-medium">Acres</th>
              <th className="px-2 py-0.5 text-right font-medium">Even share</th>
              <th className="px-2 py-0.5 font-medium">Crop</th>
              <th className="px-2 py-0.5 text-right font-medium">Needs</th>
              <th className="px-2 py-0.5 text-right font-medium">vs share</th>
              {thisSeason && <th className="px-2 py-0.5 text-right font-medium">Used</th>}
              <th className="px-2 py-0.5 text-right font-medium" title="The most this field can take if every other field on the licence gets exactly its need">
                Can take up to
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pool.fields.map((f) => (
              <tr key={f.fieldId} className={cn(f.fieldId === highlight && 'bg-sky-50 font-medium')}>
                <td className="px-2 py-1 text-gray-800">
                  <Link to={`/fields/${f.fieldId}/work`} className="hover:underline">
                    {f.name}
                  </Link>
                  {f.pending && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800">pending amendment</span>}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-gray-600">{n0(f.acres)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-gray-700">
                  {f.shareAf != null ? `${n0(f.shareAf)} ac-ft` : '—'}
                  {f.shareIn != null && <span className="block text-[10px] text-gray-400">{n1(f.shareIn)}&quot;</span>}
                </td>
                <td className="px-2 py-1 text-gray-600">{f.crop ?? '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums text-gray-700" title={f.needWhy ?? undefined}>
                  {f.needAf != null ? `${n0(f.needAf)} ac-ft` : '—'}
                  {f.needIn != null && <span className="block text-[10px] text-gray-400">{n1(f.needIn)}&quot;</span>}
                </td>
                <td className={cn('px-2 py-1 text-right tabular-nums', (f.overShareAf ?? 0) > 0.5 ? 'text-amber-700' : (f.overShareAf ?? 0) < -0.5 ? 'text-green-700' : 'text-gray-500')}>
                  {f.overShareAf != null ? signed(f.overShareAf) : f.pending && f.needAf != null ? signed(f.needAf) : '—'}
                </td>
                {thisSeason && <td className="px-2 py-1 text-right tabular-nums text-gray-700">{n0(f.usedAf)}</td>}
                <td className="px-2 py-1 text-right tabular-nums font-medium text-gray-900">
                  {f.ceilingAf != null ? `${n0(f.ceilingAf)} ac-ft` : '—'}
                  {f.ceilingAf != null && f.acres > 0 && <span className="block text-[10px] font-normal text-gray-400">{n1((f.ceilingAf * 12) / f.acres)}&quot;</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <p className={cn('mt-1.5 rounded px-1.5 py-1', room == null ? 'bg-gray-50 text-gray-600' : room >= 0 ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900')}>
        {room == null
          ? 'Volume not on file, so the room cannot be worked out.'
          : room >= 0
            ? `${n0(room)} ac-ft of room ${thisSeason ? 'left after the rest of this season’s needs' : 'after every field gets its crop’s need'}.`
            : `Short ${n0(-room)} ac-ft: the planned crops need more than the licence holds${thisSeason ? ' for the rest of the season' : ''}.`}
        {over.length > 0 &&
          ` ${over.map((f) => `${f.name} wants ${n0(f.overShareAf!)} over its even share`).join('; ')}${under.length ? `, covered by ${under.map((f) => `${f.name} (${n0(-f.overShareAf!)} to spare)`).join(', ')}` : ''}${room != null && room < 0 ? ' — not all of it fits.' : '.'}`}
        {pool.unknownNeed.length > 0 && ` No crop or water need set for ${pool.unknownNeed.join(', ')}, so they count as nothing.`}
      </p>
    </div>
  )
}
