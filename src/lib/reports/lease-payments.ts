import { supabase } from '@/lib/supabase'
import { annualRent, noticeBy, paymentsForYear, type LeaseLike, type PaymentLike } from '@/lib/leases'
import { fieldLabel, longDate, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportColumn, type ReportData, type ReportGroup } from './framework'

/**
 * Lease payments and renewals: every land lease with its terms, the rent it
 * owes in the year (its payment schedule, leases.ts), what has been paid
 * against it, and when it ends and notice has to be given.
 *
 * A payment recorded on the Leases page wins over the schedule's figure for
 * the same date; one recorded on a date the schedule does not have is listed
 * too. A share deal pays no rent: it is settled on the crop (the landlord
 * statements), so its rent columns are empty.
 */

export type LeaseRow = LeaseLike & {
  arrangement: string | null
  direction: string | null
  field_ids: string[] | null
  our_share_pct: unknown
  legal_land: string | null
}

export const LEASE_COLUMNS: ReportColumn[] = [
  { label: 'Landlord' },
  { label: 'Arrangement' },
  { label: 'Fields' },
  { label: 'Acres', decimals: 1 },
  { label: 'Rent or share' },
  { label: 'Year’s rent', decimals: 2, money: true },
  { label: 'Due' },
  { label: 'Amount', decimals: 2, money: true },
  { label: 'Paid on' },
  { label: 'Owing', decimals: 2, money: true },
  { label: 'Starts' },
  { label: 'Ends' },
  { label: 'Notice by' },
]

export function arrangementLabel(l: Pick<LeaseRow, 'arrangement' | 'direction'>): string {
  const out = l.direction === 'out'
  if (l.arrangement === 'profit_share') return out ? 'Share of the gross (our land)' : 'Profit share'
  if (l.arrangement === 'crop_share') return 'Crop share'
  return out ? 'Cash rent (our land rented out)' : 'Cash rent'
}

export function rentLabel(l: LeaseRow): string | null {
  if (l.arrangement === 'profit_share') {
    const ours = num(l.our_share_pct) ?? 50
    return `${ours}% ours`
  }
  if (l.rent_per_acre != null) return `$${Number(l.rent_per_acre)}/ac`
  if (l.rent_total != null) return `$${Number(l.rent_total).toLocaleString('en-CA')} the year`
  return 'rate not set'
}

/**
 * One lease's lines for the year: the first carries the lease's terms, then
 * one line per payment due (scheduled, or recorded on its own), and a lease
 * with no payments that year still gets its one line.
 */
export function leaseLines(l: LeaseRow, payments: PaymentLike[], year: number, fieldNames: string[], today: string): Cell[][] {
  const scheduled = l.arrangement === 'profit_share' ? [] : paymentsForYear(l, year)
  const recorded = payments.filter((p) => p.lease_id === l.id && p.due_on.startsWith(String(year)))
  const dates = [...new Set([...scheduled.map((s) => s.due_on), ...recorded.map((r) => r.due_on)])].sort()
  const terms: Cell[] = [
    l.landlord,
    arrangementLabel(l),
    fieldNames.length ? fieldNames.map(fieldLabel).join(', ') : l.legal_land,
    num(l.acres),
    rentLabel(l),
    l.arrangement === 'profit_share' ? null : annualRent(l),
  ]
  const ends: Cell[] = [l.start_date, l.end_date, noticeBy(l)]
  if (!dates.length) return [[...terms, null, null, null, null, ...ends]]
  return dates.map((due, i) => {
    const rec = recorded.find((r) => r.due_on === due)
    const amount = rec?.amount ?? scheduled.find((s) => s.due_on === due)?.amount ?? null
    const paid = rec?.paid_on ?? null
    const owing = paid ? 0 : amount
    const lead = i === 0 ? terms : [l.landlord, null, null, null, null, null]
    return [...lead, due, amount, paid ?? (due < today ? 'overdue' : null), owing, ...(i === 0 ? ends : [null, null, null])]
  })
}

export async function gatherLeasePayments(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [leases, payments, fields] = await Promise.all([
    supabase.from('land_leases').select('id, landlord, arrangement, direction, field_ids, legal_land, acres, rent_per_acre, rent_total, our_share_pct, start_date, end_date, notice_days, payment_schedule, active').order('landlord'),
    supabase.from('land_lease_payments').select('lease_id, due_on, amount, paid_on').gte('due_on', `${year}-01-01`).lte('due_on', `${year}-12-31`),
    supabase.from('fields').select('id, name'),
  ])
  for (const r of [leases, payments, fields]) if (r.error) throw new Error(r.error.message)
  const inYear = (l: LeaseRow) => (!l.start_date || l.start_date <= `${year}-12-31`) && (!l.end_date || l.end_date >= `${year}-01-01`)
  const list = ((leases.data ?? []) as unknown as LeaseRow[])
    .map((l) => ({ ...l, rent_per_acre: num(l.rent_per_acre), rent_total: num(l.rent_total), acres: num(l.acres) }))
    .filter((l) => l.active && inYear(l))
  if (!list.length) throw new Error(`No land lease runs in ${year}.`)
  const pays = (payments.data ?? []).map((x) => ({ ...x, amount: num(x.amount) }))
  const names = new Map((fields.data ?? []).map((f) => [f.id, f.name]))
  const fieldsOf = (l: LeaseRow) => (l.field_ids ?? []).map((id) => names.get(id)).filter((n): n is string => !!n)

  let due = 0
  let paid = 0
  const group = (title: string, ls: LeaseRow[]): ReportGroup | null => {
    if (!ls.length) return null
    const rows = ls.flatMap((l) => leaseLines(l, pays, year, fieldsOf(l), ctx.today))
    const amount = rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0)
    const owing = rows.reduce((s, r) => s + (typeof r[9] === 'number' ? r[9] : 0), 0)
    due += amount
    paid += amount - owing
    return { title, rows, totals: ['Total', null, null, null, null, ls.reduce((s, l) => s + (l.arrangement === 'profit_share' ? 0 : (annualRent(l) ?? 0)), 0), null, amount, null, owing, null, null, null] }
  }
  const groups = [
    group('Land we rent', list.filter((l) => l.direction !== 'out')),
    group('Our land rented out', list.filter((l) => l.direction === 'out')),
  ].filter((g): g is ReportGroup => g != null)
  const renewals = list
    .map((l) => ({ l, by: noticeBy(l) }))
    .filter((x) => x.l.end_date)
    .sort((a, b) => (a.by ?? '').localeCompare(b.by ?? ''))
  return {
    title: 'Lease payments and renewals',
    subtitle: `${year} · as at ${longDate(ctx.today)}`,
    meta: [
      ['Leases', list.length],
      ['Rent due in the year', `$${Math.round(due).toLocaleString('en-CA')}`],
      ['Paid', `$${Math.round(paid).toLocaleString('en-CA')}`],
      ['Next notice date', renewals.find((x) => x.by && x.by >= ctx.today)?.by ?? 'none'],
    ],
    summary: [
      'Each lease running in the year, with the rent its payment schedule says is due and what has been recorded as paid on the Leases page. Rent for land we rent out is money in; for land we rent, money out. A share deal is settled on the crop, not in rent — see the landlord settlement statements.',
      'Notice by is the lease’s end date less its notice period: the last day to say whether it is renewed. A lease with no end date runs on and has no notice date.',
    ],
    columns: LEASE_COLUMNS,
    groups,
    groupLabel: 'Group',
    orientation: 'landscape',
    filename: `Lease payments ${year}`,
  }
}
