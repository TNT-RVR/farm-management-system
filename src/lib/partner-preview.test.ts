import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Query } from '@tanstack/react-query'
import { shouldPersistQuery } from './offline'
import { partnerFetch, setPartnerPreview } from './partner-preview'

const BASE = 'https://db.example/rest/v1'
let seen: Request[] = []
let reply: unknown = []

beforeEach(() => {
  seen = []
  reply = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init))
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => {
  setPartnerPreview(null)
  vi.unstubAllGlobals()
})

const preview = () => setPartnerPreview({ userId: 'p1', name: 'Partner', fieldIds: ['f1', 'f2'] })

describe('partnerFetch', () => {
  it('passes everything straight through with no preview on', async () => {
    await partnerFetch(`${BASE}/financial_entries?select=*`)
    expect(seen).toHaveLength(1)
  })

  it('answers a table he cannot read with no rows, without asking the database', async () => {
    preview()
    const r = await partnerFetch(`${BASE}/financial_entries?select=*`)
    expect(await r.json()).toEqual([])
    expect(seen).toHaveLength(0)
  })

  it('says "no rows" to a .single() on a closed table, as the database would', async () => {
    preview()
    const r = await partnerFetch(`${BASE}/farm_setup?select=*`, { headers: { Accept: 'application/vnd.pgrst.object+json' } })
    expect(r.status).toBe(406)
  })

  it('limits fields to his and blanks the lease columns', async () => {
    preview()
    reply = [{ id: 'f1', name: '2', rented_out_to: 'Hillside', tenure_notes: 'x' }]
    const r = await partnerFetch(`${BASE}/fields?select=*`)
    expect(new URL(seen[0].url).searchParams.get('id')).toBe('in.(f1,f2)')
    expect(await r.json()).toEqual([{ id: 'f1', name: '2', rented_out_to: null, tenure_notes: null }])
  })

  it('reads the grant list from the table, without our status or notes', async () => {
    preview()
    reply = [{ id: 'g', title: 'Water', status: 'applied', notes_md: 'ours', assigned_to: 'u' }]
    const r = await partnerFetch(`${BASE}/partner_grants_v?select=*`)
    expect(new URL(seen[0].url).pathname.endsWith('/grants')).toBe(true)
    expect(await r.json()).toEqual([{ id: 'g', title: 'Water', status: 'new', notes_md: null, assigned_to: null }])
  })

  it('reads the conference table as his view gives it', async () => {
    preview()
    reply = [{ id: 'e', name: 'Ag Expo', status: 'registered', travel_notes: 'hotel' }]
    const r = await partnerFetch(`${BASE}/events?select=*`)
    expect(await r.json()).toEqual([{ id: 'e', name: 'Ag Expo', status: 'watching', travel_notes: null }])
  })

  it('never shows our machines or tasks as his, and refuses adding them', async () => {
    preview()
    expect(await (await partnerFetch(`${BASE}/jd_equipment?select=*`)).json()).toEqual([])
    expect(await (await partnerFetch(`${BASE}/tasks_with_assignees?select=*`)).json()).toEqual([])
    expect((await partnerFetch(`${BASE}/tasks`, { method: 'POST', body: '{}' })).status).toBe(403)
    expect(seen).toHaveLength(0)
  })

  it('reads his field progress from the view behind it, his fields only', async () => {
    preview()
    await partnerFetch(`${BASE}/partner_season_progress_v?select=*&crop_year=eq.2026`)
    const url = new URL(seen[0].url)
    expect(url.pathname.endsWith('/field_season_progress')).toBe(true)
    expect(url.searchParams.get('field_id')).toBe('in.(f1,f2)')
  })

  it('limits field records to his fields and nulls embedded crops', async () => {
    // Not crop_history: he reads every field's crops by year for the rotation.
    preview()
    reply = [{ id: 'h', crop: { name: 'Potato' } }]
    const r = await partnerFetch(`${BASE}/field_work_records?select=*,crop:crops(name)`)
    expect(new URL(seen[0].url).searchParams.get('field_id')).toBe('in.(f1,f2)')
    expect(await r.json()).toEqual([{ id: 'h', crop: null }])
  })

  it("reads only his company's shares", async () => {
    setPartnerPreview({ userId: 'p1', name: 'Partner', fieldIds: ['f1', 'f2'], farmId: 'c1' })
    await partnerFetch(`${BASE}/partner_crops?select=*`)
    expect(new URL(seen[0].url).searchParams.get('farm_id')).toBe('eq.c1')
  })

  it('refuses writes outside what he records, and staff functions', async () => {
    preview()
    expect((await partnerFetch(`${BASE}/bins`, { method: 'PATCH', body: '{}' })).status).toBe(403)
    expect((await partnerFetch(`${BASE}/rpc/meeting_alerts`, { method: 'POST', body: '{}' })).status).toBe(403)
    expect(seen).toHaveLength(0)
  })

  it('lets his own kinds of record through', async () => {
    preview()
    await partnerFetch(`${BASE}/scouting_notes`, { method: 'POST', body: '{}' })
    expect(seen).toHaveLength(1)
  })
})

describe('the saved offline cache', () => {
  it('keeps nothing fetched during a preview', () => {
    // Saved, the partner's narrowed lists outlived the preview and showed as the whole farm.
    const q = { queryKey: ['fields', 'all'], state: { status: 'success' } } as unknown as Query
    preview()
    expect(shouldPersistQuery(q)).toBe(false)
    setPartnerPreview(null)
    expect(shouldPersistQuery(q)).toBe(true)
  })
})
