import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { fieldPhi, type PhiApplication } from '@/lib/phi'
import { loadPhiSeason } from '@/lib/phi-data'
import { loadGrazingData } from '@/lib/grazing-data'
import { fmtDay, grazingPicture, longest, type Place, type Restriction } from '@/lib/grazing-restrictions'
import { fetchAll, fieldLabel, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData } from './framework'

/**
 * Per field, the first day it is clear to combine and the first day stock may
 * graze it or its crop be fed: the last product applied, its pre-harvest
 * interval off the label, and the latest-ending grazing and feeding
 * restriction of everything sprayed on it that season.
 *
 * The harvest side is the Harvest page's PHI panel (lib/phi-data.ts); the
 * livestock side is the Spray restrictions page's reading of the labels
 * (grazingPicture). A label not read, or not covering the crop, is UNKNOWN
 * and is named — never reported as clear.
 */

export const CLEARANCE_COLUMNS = [
  { label: 'Crop' },
  { label: 'Last sprayed' },
  { label: 'Last product' },
  { label: 'PHI (days)', decimals: 0 },
  { label: 'Safe to harvest' },
  { label: 'Set by' },
  { label: 'Harvest began' },
  { label: 'PHI unknown for' },
  { label: 'Grazing from' },
  { label: 'Feeding from' },
  { label: 'Note' },
]

/** Names as sprayed, once each: Deere sends "Delaro® Complete" and "Delaro Complete" for one product. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, string>()
  for (const n of names) {
    const k = n.replace(/[®™]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (!seen.has(k)) seen.set(k, n.replace(/[®™]/g, '').trim())
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** When a kind of restriction lifts: a date, the spring after for "not at all", or nothing. */
export function clearFrom(rs: Restriction[], kind: 'graze' | 'feed'): string | null {
  const last = longest(rs, kind)
  if (!last) return null
  return last.never ? `spring ${last.until!.slice(0, 4)} (not this crop at all)` : last.until
}

/** One field's row. `place` is the grazing picture's view of the field, its restrictions already this season's. */
export function clearanceRow(fieldId: string, crop: string | null, apps: PhiApplication[], harvestStart: string | null, place: Place | null, unread: string[]): Cell[] {
  const mine = apps.filter((a) => a.fieldId === fieldId)
  const lastDay = mine.reduce<string | null>((m, a) => (!m || a.appliedOn > m ? a.appliedOn : m), null)
  const last = mine.filter((a) => a.appliedOn === lastDay)
  const lastPhi = last.some((a) => a.phiDays == null) ? null : Math.max(...last.map((a) => a.phiDays ?? 0))
  const phi = fieldPhi(fieldId, mine, harvestStart)
  const unknown = uniqueNames(phi.unknown.map((a) => a.product))
  const rs = place?.restrictions ?? []
  const slaughter = rs.filter((r) => r.kind === 'slaughter' && r.days != null).sort((a, b) => (b.days ?? 0) - (a.days ?? 0))[0]
  const note = [
    phi.violation ? `harvest began ${phi.violation.daysEarly} day${phi.violation.daysEarly === 1 ? '' : 's'} inside the PHI` : null,
    slaughter ? `off it ${slaughter.days} days before slaughter (${slaughter.product})` : null,
    unread.length ? `grazing lines not read yet: ${unread.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ')
  return [
    crop,
    lastDay,
    uniqueNames(last.map((a) => a.product)).join(', ') || null,
    lastDay ? lastPhi : null,
    phi.safeFrom,
    phi.limiting ? `${phi.limiting.product}, ${fmtDay(phi.limiting.appliedOn)}` : null,
    harvestStart,
    unknown.join(', ') || null,
    clearFrom(rs, 'graze') ?? (unread.length ? null : 'no restriction on the labels'),
    clearFrom(rs, 'feed') ?? (unread.length ? null : 'no restriction on the labels'),
    note || null,
  ]
}

export async function gatherClearance(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  // The restrictions read sprays from 1 January the year before "today"; a
  // past crop year is read as at its last day.
  const asOf = ctx.today.slice(0, 4) === String(year) ? ctx.today : `${year}-12-31`
  const [season, grazing, plans, crops] = await Promise.all([
    loadPhiSeason(year),
    loadGrazingData(supabase, asOf),
    fetchAll<{ field_id: string; crop_id: string }>((a, b) => supabase.from('crop_plans').select('field_id, crop_id').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('crops').select('id, name').order('id').range(a, b)),
  ])
  const picture = grazingPicture(grazing, asOf)
  // An adjuvant has no pre-harvest interval to read, and Deere's "---" is no
  // product at all: neither is an unknown.
  const regs = [...new Set(season.apps.map((a) => a.registration).filter((r): r is string => !!r))]
  const types = regs.length
    ? await fetchAll<{ registration_number: string; product_type: string | null }>((a, b) => supabase.from('chemicals').select('registration_number, product_type').in('registration_number', regs).order('id').range(a, b))
    : []
  const adjuvant = new Set(types.filter((t) => /adjuvant|surfactant/i.test(t.product_type ?? '')).map((t) => t.registration_number))
  const apps = season.apps.filter((a) => !(a.registration && adjuvant.has(a.registration)) && !/^(-+|water|carrier)$/i.test(a.product.trim()))
  const inYear = (r: { appliedOn: string }) => r.appliedOn.slice(0, 4) === String(year)
  const placeOf = new Map(
    picture.places.filter((x) => x.kind === 'field').map((x) => [x.id, { ...x, sprays: x.sprays.filter(inYear), restrictions: x.restrictions.filter(inYear) }]),
  )
  const cropName = new Map(crops.map((c) => [c.id, c.name]))
  const cropsOn = new Map<string, string[]>()
  for (const pl of plans) cropsOn.set(pl.field_id, [...(cropsOn.get(pl.field_id) ?? []), cropName.get(pl.crop_id) ?? ''].filter(Boolean))
  const unreadOn = (name: string) => picture.unread.filter((u) => u.places.includes(name)).map((u) => u.product)

  const ids = [...new Set(apps.map((a) => a.fieldId))]
  const nameOf = (id: string) => season.names.get(id) || placeOf.get(id)?.name || 'A field'
  ids.sort((a, b) => compareFieldNames(nameOf(a), nameOf(b)))
  if (!ids.length) throw new Error(`No chemical sprayed in ${year}.`)

  const rows = ids.map((id) => [fieldLabel(nameOf(id)), ...clearanceRow(id, cropsOn.get(id)?.join(', ') ?? null, apps, season.harvestStart.get(id) ?? null, placeOf.get(id) ?? null, unreadOn(nameOf(id)))])
  const waiting = rows.filter((r) => typeof r[5] === 'string' && r[5] > ctx.today && !r[7]).length
  const early = rows.filter((r) => String(r[11] ?? '').includes('inside the PHI')).length
  const unknown = rows.filter((r) => r[8]).length
  const summary = [
    'Per field: the last product applied and its pre-harvest interval, the first day harvest is clear of every interval on the labels (and the spray that sets it), and the first day stock may graze the field or its crop be fed, from the labels’ grazing and feeding lines.',
    'A product whose label is unread, or does not cover the crop, is named under “PHI unknown for” and is not counted as clear. “Not at all” on a label means the treated crop — its stubble and swaths through the winter — so the field is clear the spring after.',
  ]
  if (picture.unmatched.length) summary.push(`Sprayed but not matched to the price book, so no label to read: ${picture.unmatched.map((u) => u.name).sort().join(', ')}.`)
  return {
    title: 'Pre-harvest interval and grazing clearance',
    subtitle: `Crop year ${year} · as at ${fmtDay(asOf)}`,
    meta: [
      ['Fields sprayed', rows.length],
      ['Not yet clear to harvest', waiting],
      ['Harvested inside the PHI', early],
      ['With a PHI unknown', unknown],
    ],
    summary,
    columns: [{ label: 'Field' }, ...CLEARANCE_COLUMNS],
    groups: [{ title: '', rows }],
    orientation: 'landscape',
    filename: `PHI and grazing clearance ${year}`,
  }
}
