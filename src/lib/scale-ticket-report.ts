/**
 * Scale tickets on paper (Sam, 2 Nov 2026): one ticket from its summary,
 * or every ticket the Weigh scale list is showing — a summary page of the
 * lot (totals pre-cleaned and after clean-out, the value, which fields and
 * crops) and then a page per load, the same page a single ticket prints.
 *
 * Facts are worked out once per load (ticketFacts) so the screen, the one
 * ticket's PDF and the list's PDF can never disagree.
 */
import { supabase } from '@/lib/supabase'
import { KG_TO_LB, bushelsFromKg, isOpenLoad, weighTime, type BinLoad } from '@/lib/bin-loads'
import { driverName } from '@/lib/weigh-scale'
import { cleanOutFor, type CleanOut } from '@/lib/clean-out'
import { loadValue } from '@/lib/load-value'
import { resolvePrice, type PriceRow } from '@/lib/forecast'
import type { YieldUnit } from '@/lib/fert-savings/checks'
import { heicToJpeg, isHeic } from '@/lib/heic'
import type { Cell, ReportSection, TableReport } from '@/lib/table-report'

export const num = (v: number, digits = 0) => v.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })
export const money = (v: number, cents = false) =>
  v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
const binName = (n: string) => n.replace(/^Main Yard\s*-\s*/i, '')
const kgText = (v: number | null) => (v == null ? '—' : `${num(v)} kg`)

type Named = { id: string; name: string }
export type TicketLookups = {
  fields: Named[]
  crops: (Named & { yield_unit: string; est_cleanout_pct?: number | null; test_weight_lb_per_bu?: number | null })[]
  bins: Named[]
  sites: Named[]
  users: { id: string; full_name: string | null }[]
  prices: PriceRow[]
  /** The field's crop-history row for the load's crop and season. */
  cleanYield: (l: BinLoad) => { clean_total: number | null; scale_total: number | null } | null | undefined
}

export type TicketFacts = {
  load: BinLoad
  field: string
  crop: string
  cropText: string
  wentTo: string
  delivered: boolean
  driver: string
  inWhen: string
  outWhen: string
  inBy: string | null
  outBy: string | null
  net: number | null
  bushels: number | null
  clean: CleanOut | null
  /** Share left after clean-out; null when no clean-out is known. */
  keep: number | null
  cleanLabel: string
  value: number | null
  valueText: string
  priceText: string | null
}

export function ticketFacts(l: BinLoad, lk: TicketLookups): TicketFacts {
  const person = (id: string | null) => (id ? (lk.users.find((u) => u.id === id)?.full_name ?? null) : null)
  const field = lk.fields.find((f) => f.id === l.field_id)?.name ?? 'No field'
  const cropRow = lk.crops.find((c) => c.id === l.crop_id)
  const crop = cropRow?.name ?? '—'
  const bin = (id: string | null) => (id ? binName(lk.bins.find((b) => b.id === id)?.name ?? '—') : null)
  const site = l.delivery_site_id ? (lk.sites.find((s) => s.id === l.delivery_site_id)?.name ?? 'a plant') : null
  const firstBin = bin(l.bin_id)
  const overflow = bin(l.overflow_bin_id)
  const net = l.net_kg == null ? null : Number(l.net_kg)
  const bushels = net == null ? null : l.bushels != null ? Number(l.bushels) : bushelsFromKg(net, Number(l.lb_per_bu))
  const clean = cleanOutFor(lk.cleanYield(l), cropRow?.est_cleanout_pct)
  const keep = clean ? 1 - clean.pct / 100 : null
  // The same price the weigh-in form values a load at: the crop page's, else the market, else the last year's.
  const priced = resolvePrice(l.crop_id, l.crop_year, lk.prices, { currentYear: new Date().getFullYear() })
  const lbPerBu = Number(l.lb_per_bu) || cropRow?.test_weight_lb_per_bu || null
  const worth =
    bushels != null && keep != null ? loadValue({ bushels: bushels * keep, lbPerBu, unit: (cropRow?.yield_unit ?? null) as YieldUnit | null, price: priced.value }) : null
  const value = worth?.dollars ?? null
  return {
    load: l,
    field,
    crop,
    // The variety, unless it only repeats the crop ("Grain corn" on Grain Corn).
    cropText: l.variety && l.variety.trim().toLowerCase() !== crop.toLowerCase() ? `${crop} (${l.variety.trim()})` : crop,
    wentTo:
      site ?? (firstBin && overflow ? `${firstBin} (${num(Number(l.first_bin_bu ?? 0))} bu), then ${overflow}` : (firstBin ?? (isOpenLoad(l) ? 'Not weighed out yet' : '—'))),
    delivered: !!site,
    driver: driverName(l, (id) => person(id))?.trim() || '—',
    inWhen: (l.full_at ? weighTime(l.full_at) : l.loaded_on) ?? '—',
    outWhen: (l.empty_guessed ? 'Not weighed out (empty guessed)' : l.empty_at ? weighTime(l.empty_at) : isOpenLoad(l) ? 'Waiting' : '—') ?? '—',
    inBy: person(l.weighed_in_by),
    outBy: person(l.weighed_out_by),
    net,
    bushels,
    clean,
    keep,
    cleanLabel: clean ? `After clean-out (${clean.actual ? 'actual' : 'estimated'} ${num(clean.pct, clean.pct % 1 ? 1 : 0)}%)` : 'After clean-out',
    value,
    valueText: value != null ? money(value) : priced.value == null ? `No ${crop} price yet` : keep == null ? 'Needs a clean-out %' : '—',
    priceText: priced.value != null ? `${crop} at ${money(priced.value, true)}/${worth?.unit ?? cropRow?.yield_unit ?? 'bu'} · ${priced.label}` : null,
  }
}

export const UNITS_HEAD = ['', 'Kilograms', 'Pounds', 'Tonnes', 'Bushels']
/** What the after-clean-out row says in place of its weights when no clean-out is known. */
export const NO_CLEAN = 'Set an estimated clean-out % on the crop'

const weightCells = (kg: number, bu: number | null) => [`${num(kg)} kg`, `${num(kg * KG_TO_LB)} lb`, `${num(kg / 1000, 2)} t`, bu ? `${num(bu, 1)} bu` : '—']

/** Pre-cleaned, then after clean-out; a one-cell row when the clean-out is not known. */
export function netRows(t: TicketFacts): string[][] {
  if (t.net == null) return []
  return [
    ['Pre-cleaned', ...weightCells(t.net, t.bushels)],
    t.keep == null ? [t.cleanLabel, NO_CLEAN] : [t.cleanLabel, ...weightCells(t.net * t.keep, t.bushels == null ? null : t.bushels * t.keep)],
  ]
}

type Img = { dataUrl: string; width: number; height: number }

/** A ticket's page: its details, weights, net, value and photos. */
function ticketSections(t: TicketFacts, photos: [Img | null, Img | null], opts: { title?: string; pageBreakBefore?: boolean } = {}): ReportSection[] {
  const l = t.load
  const pics = [photos[0] && { row: 0, col: 0, image: photos[0] }, photos[1] && { row: 0, col: 1, image: photos[1] }].filter(
    (p): p is { row: number; col: number; image: Img } => !!p,
  )
  const details: [string, Cell][] = [
    ['Field', t.field],
    ['Crop', t.cropText],
    [t.delivered ? 'Delivered to' : 'Bin', t.wentTo],
    ['Driver', t.driver],
    ['Truck', l.truck?.trim() || '—'],
    ['Trailer', l.trailer?.trim() || '—'],
    ...(l.moisture_pct != null ? ([['Moisture', `${l.moisture_pct}%`]] as [string, Cell][]) : []),
    ...(t.net != null ? ([['Estimated value', t.valueText]] as [string, Cell][]) : []),
  ]
  // Two pairs a row, so a load and both its photos fit on one page.
  const pairs: Cell[][] = []
  for (let i = 0; i < details.length; i += 2) pairs.push([...details[i], ...(details[i + 1] ?? ['', ''])])
  const basis = [t.priceText, t.clean && t.cleanLabel.toLowerCase()].filter(Boolean).join(', ')
  return [
    {
      title: opts.title ?? 'Ticket',
      head: ['', '', '', ''],
      rows: pairs,
      note: [basis && t.net != null ? `Value: ${basis}.` : '', l.note ? `Note: ${l.note}` : ''].filter(Boolean).join(' ') || undefined,
      pageBreakBefore: opts.pageBreakBefore,
    },
    {
      title: 'Weights',
      head: ['', 'Weight', 'When', 'Entered by'],
      rows: [
        ['Weighed in (full)', kgText(l.gross_kg == null ? null : Number(l.gross_kg)), t.inWhen, t.inBy ?? '—'],
        ['Weighed out (empty)', kgText(l.tare_kg == null ? null : Number(l.tare_kg)), t.outWhen, t.outBy ?? '—'],
      ],
    },
    { title: 'Net', head: UNITS_HEAD, rows: netRows(t).map((r) => (r.length === 2 ? [...r, '', '', ''] : r)), empty: 'Not weighed out yet' },
    ...(pics.length ? [{ title: 'Scale photos', head: ['Weighed in', 'Weighed out'], rows: [['', '']], minRowHeight: 220, cellImages: pics }] : []),
  ]
}

/** One ticket, as its summary's export prints it. */
export function singleTicketReport(t: TicketFacts, photos: [Img | null, Img | null]): TableReport {
  return {
    title: 'Scale ticket',
    subtitle: `${t.field} · ${t.crop} · ${t.load.loaded_on}`,
    meta: [],
    sections: ticketSections(t, photos, { title: 'Ticket' }),
    orientation: 'portrait',
  }
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0)
const list = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

/**
 * Every ticket showing: a summary page (which fields and crops, the totals
 * pre-cleaned and after clean-out, the value, by field and crop when there is
 * more than one, then the tickets in a list), then a page per load. The CSV
 * (`withPages` false) is the summary and the list.
 */
export function ticketsReport(
  tickets: TicketFacts[],
  opts: { filters: string; photos?: (t: TicketFacts) => [Img | null, Img | null]; withPages: boolean },
): TableReport {
  const weighed = tickets.filter((t) => t.net != null)
  const fields = list(tickets.map((t) => t.field))
  const crops = list(tickets.map((t) => t.cropText))
  const days = tickets.map((t) => t.load.loaded_on).sort()
  const cleanKnown = weighed.filter((t) => t.keep != null)
  const valued = weighed.filter((t) => t.value != null)
  const totalsRow = (label: string, ts: TicketFacts[], k: (t: TicketFacts) => number) => [
    label,
    ...weightCells(sum(ts.map((t) => t.net! * k(t))), sum(ts.map((t) => (t.bushels == null ? null : t.bushels * k(t))))),
  ]
  const totals: Cell[][] = weighed.length
    ? [
        totalsRow('Pre-cleaned', weighed, () => 1),
        cleanKnown.length
          ? totalsRow(cleanKnown.length < weighed.length ? `After clean-out (${cleanKnown.length} of ${weighed.length} loads)` : 'After clean-out', cleanKnown, (t) => t.keep!)
          : ['After clean-out', NO_CLEAN, '', '', ''],
      ]
    : []
  const valueTotal = sum(valued.map((t) => t.value))

  // By field and crop, when the list holds more than one.
  const groups = new Map<string, TicketFacts[]>()
  for (const t of weighed) {
    const k = `${t.field}\u0000${t.crop}`
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  const byField: Cell[][] = [...groups.values()]
    .map((ts) => {
      const c = ts.find((t) => t.clean)?.clean
      return [
        ts[0].field,
        ts[0].crop,
        ts.length,
        `${num(sum(ts.map((t) => t.net)))} kg`,
        `${num(sum(ts.map((t) => t.bushels)), 1)} bu`,
        c ? `${c.actual ? 'actual' : 'est.'} ${num(c.pct, c.pct % 1 ? 1 : 0)}%` : '—',
        ts.some((t) => t.keep != null) ? `${num(sum(ts.map((t) => (t.bushels == null || t.keep == null ? null : t.bushels * t.keep))), 1)} bu` : '—',
        ts.some((t) => t.value != null) ? money(sum(ts.map((t) => t.value))) : '—',
      ] as Cell[]
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))

  const rows: Cell[][] = tickets.map((t) => [
    t.inWhen,
    t.field,
    t.crop,
    t.driver,
    t.load.truck?.trim() || '—',
    t.net == null ? 'waiting' : `${num(t.net)} kg`,
    t.bushels == null ? '—' : `${num(t.bushels, 1)} bu`,
    t.bushels == null || t.keep == null ? '—' : `${num(t.bushels * t.keep, 1)} bu`,
    t.value == null ? '—' : money(t.value),
  ])

  const sections: ReportSection[] = [
    { title: 'Totals', head: UNITS_HEAD, rows: totals, empty: 'No load weighed out yet' },
    ...(groups.size > 1
      ? [{ title: 'By field and crop', head: ['Field', 'Crop', 'Loads', 'Pre-cleaned', 'Bushels', 'Clean-out', 'Clean bushels', 'Value'], rows: byField }]
      : []),
    {
      title: 'Tickets',
      head: ['Weighed in', 'Field', 'Crop', 'Driver', 'Truck', 'Net', 'Bushels', 'Clean bushels', 'Value'],
      rows,
      foot: ['Total', '', '', '', '', `${num(sum(weighed.map((t) => t.net)))} kg`, `${num(sum(weighed.map((t) => t.bushels)), 1)} bu`, '', valued.length ? money(valueTotal) : '—'],
    },
  ]
  if (opts.withPages) {
    for (const t of tickets) {
      sections.push(...ticketSections(t, opts.photos?.(t) ?? [null, null], { title: `${t.field} · ${t.inWhen}`, pageBreakBefore: true }))
    }
  }
  return {
    title: 'Scale tickets',
    subtitle: opts.filters,
    meta: [
      [fields.length === 1 ? 'Field' : 'Fields', fields.join(', ') || '—'],
      [crops.length === 1 ? 'Crop' : 'Crops', crops.join(', ') || '—'],
      ['Loads', `${tickets.length}${weighed.length < tickets.length ? ` (${tickets.length - weighed.length} not weighed out)` : ''}`],
      ['Dates', days.length ? (days[0] === days[days.length - 1] ? days[0] : `${days[0]} to ${days[days.length - 1]}`) : '—'],
      [
        'Estimated value',
        valued.length ? `${money(valueTotal)}${valued.length < weighed.length ? ` (${valued.length} of ${weighed.length} loads valued)` : ''}` : '—',
      ],
    ],
    sections,
    orientation: 'portrait',
  }
}

/** A scale photo as a JPEG data URL for a PDF, no wider than `maxW` px. */
export async function photoDataUrl(src: string, maxW = 1200): Promise<Img | null> {
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const k = Math.min(1, maxW / img.naturalWidth)
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * k)
  c.height = Math.round(img.naturalHeight * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return { dataUrl: c.toDataURL('image/jpeg', 0.8), width: c.width, height: c.height }
}

/** A stored scale photo, fetched and shrunk for a PDF; null if it cannot be read. */
export async function storedPhoto(path: string | null, maxW = 900): Promise<Img | null> {
  if (!path) return null
  const { data, error } = await supabase.storage.from('scale-photos').download(path)
  if (error || !data) return null
  const shown = isHeic(data, path) ? await heicToJpeg(data) : data
  const url = URL.createObjectURL(shown)
  try {
    return await photoDataUrl(url, maxW)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Each field's crop-history rows for the seasons given, keyed field|crop|year. */
export async function fetchCleanYields(fieldIds: string[], years: number[]) {
  const out = new Map<string, { clean_total: number | null; scale_total: number | null }>()
  if (!fieldIds.length || !years.length) return out
  const { data, error } = await supabase
    .from('crop_history')
    .select('field_id, crop_id, crop_year, clean_total, scale_total')
    .in('field_id', fieldIds)
    .in('crop_year', years)
  if (error) throw error
  for (const r of data ?? []) out.set(`${r.field_id}|${r.crop_id}|${r.crop_year}`, r)
  return out
}
