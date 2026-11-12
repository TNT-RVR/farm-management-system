import { describe, expect, it } from 'vitest'
import type { BinLoad } from '@/lib/bin-loads'
import { singleTicketReport, ticketFacts, ticketsReport, type TicketLookups } from './scale-ticket-report'
import { tableReportPdfDoc } from './table-report'

const load = (id: string, net: number, over: Partial<BinLoad> = {}) =>
  ({
    id,
    field_id: 'f1',
    crop_id: 'c1',
    crop_year: 2026,
    loaded_on: '2026-10-27',
    gross_kg: net + 20_000,
    tare_kg: 20_000,
    net_kg: net,
    bushels: null,
    lb_per_bu: 56,
    truck: 'Kenworth',
    trailer: null,
    bin_id: 'b1',
    overflow_bin_id: null,
    delivery_site_id: null,
    variety: null,
    driver: 'Lane',
    driver_id: null,
    full_at: null,
    empty_at: null,
    empty_guessed: false,
    entry_kind: 'weighed',
    weighed_in_by: null,
    weighed_out_by: null,
    moisture_pct: null,
    note: null,
    ...over,
  }) as BinLoad

const lookups = (clean: { clean_total: number; scale_total: number } | null): TicketLookups => ({
  fields: [{ id: 'f1', name: '7-55 acres' }],
  crops: [{ id: 'c1', name: 'Grain Corn', yield_unit: 'bu', est_cleanout_pct: 5, test_weight_lb_per_bu: 56 }],
  bins: [{ id: 'b1', name: 'Main Yard - #14' }],
  sites: [],
  users: [],
  prices: [{ crop_id: 'c1', crop_year: 2026, price_per_unit: 5 }],
  cleanYield: () => clean,
})

describe('ticketFacts', () => {
  it('values a load after the crop estimate, then after the field actual', () => {
    const l = load('a', 25_401) // 1,000 bu at 56 lb
    const est = ticketFacts(l, lookups(null))
    expect(est.clean).toEqual({ pct: 5, actual: false })
    expect(est.value).toBeCloseTo(950 * 5, 0)
    expect(est.wentTo).toBe('#14')
    const act = ticketFacts(l, lookups({ clean_total: 900, scale_total: 1000 }))
    expect(act.clean).toEqual({ pct: 10, actual: true })
    expect(act.value).toBeCloseTo(900 * 5, 0)
  })
})

describe('ticketsReport', () => {
  it('opens with the totals and the tickets, then a page per load', () => {
    const ts = [load('a', 25_401), load('b', 25_401)].map((l) => ticketFacts(l, lookups(null)))
    const r = ticketsReport(ts, { filters: '2026 · 7-55 acres', withPages: true })
    expect(r.meta.find(([k]) => k === 'Field')?.[1]).toBe('7-55 acres')
    expect(r.meta.find(([k]) => k === 'Estimated value')?.[1]).toMatch(/9,500$/)
    expect(r.sections[0].title).toBe('Totals')
    expect(r.sections[1].title).toBe('Tickets')
    expect(r.sections.filter((s) => s.pageBreakBefore)).toHaveLength(2)
  })
  it('leaves the pages out of the CSV', () => {
    const ts = [load('a', 25_401)].map((l) => ticketFacts(l, lookups(null)))
    expect(ticketsReport(ts, { filters: '', withPages: false }).sections.some((s) => s.pageBreakBefore)).toBe(false)
  })
})

describe('the PDF', () => {
  // A 1-pixel JPEG stands in for a scale photo; it is drawn at the photo's size.
  const JPG =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
  const img = { dataUrl: JPG, width: 1200, height: 900 }
  const brand = { farmName: 'Farm', appName: 'App', logo: null }
  it('prints a load, photos and all, on one page', async () => {
    const one = ticketFacts(load('a', 44_900, { moisture_pct: 18.3, trailer: 'Trailer #4' }), lookups(null))
    expect((await tableReportPdfDoc(singleTicketReport(one, [img, img]), { brand, now: new Date(0) })).getNumberOfPages()).toBe(1)
    const six = Array.from({ length: 6 }, (_, i) => ticketFacts(load(String(i), 44_900), lookups(null)))
    const doc = await tableReportPdfDoc(ticketsReport(six, { filters: '', withPages: true, photos: () => [img, img] }), { brand, now: new Date(0) })
    expect(doc.getNumberOfPages()).toBe(7)
  })
})
