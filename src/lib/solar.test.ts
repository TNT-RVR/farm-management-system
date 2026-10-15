import { describe, expect, it } from 'vitest'
import { contentMd5, signSolis, solisClient, solisCreds, SolisNotConfigured } from '../../netlify/shared/solis.ts'
import { dateIn, monthsToPull, normSiteName, parseMonthRows, parseSolisJson, parseStation, stationListPage, summarizeSolar, toKw, toKwh, tzOffsetHours } from './solar'

describe('SolisCloud signing', () => {
  it('matches the Content-MD5 in Solis’s own API document (§2.5)', () => {
    // "Content-MD5 calculation example {"pageNo":1,"pageSize":10}" → kxdxk7rbAsrzSIWgEwhH4w== (§2.4).
    expect(contentMd5('{"pageNo":1,"pageSize":10}')).toBe('kxdxk7rbAsrzSIWgEwhH4w==')
  })

  it('matches the known header from hultenvp/soliscloud_api’s test suite', () => {
    // test/test_private_methods.py::test_prepare_header — the same HMAC-SHA1
    // over "POST\n{md5}\napplication/json\n{date}\n{path}" Home Assistant users run.
    const h = signSolis({
      keyId: '1234567891234567890',
      secret: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF',
      path: 'TEST',
      body: '{"pageNo":1,"pageSize":100}',
      date: new Date(Date.UTC(2023, 0, 1)),
    })
    expect(h).toEqual({
      'Content-MD5': 'U0Xj//qmRi3zoyapfAAuXw==',
      'Content-Type': 'application/json',
      Date: 'Sun, 01 Jan 2023 00:00:00 GMT',
      Authorization: 'API 1234567891234567890:8+oYgqSEFjxPaHIOgUKSpIdYCGU=',
    })
  })

  it('signs the path and the content type it sends', () => {
    const base = { keyId: 'k', secret: 's', body: '{}', date: new Date(Date.UTC(2026, 9, 6, 19, 51)) }
    const a = signSolis({ ...base, path: '/v1/api/userStationList' }).Authorization
    expect(signSolis({ ...base, path: '/v1/api/stationMonth' }).Authorization).not.toBe(a)
    expect(signSolis({ ...base, path: '/v1/api/userStationList', contentType: 'application/json;charset=UTF-8' }).Authorization).not.toBe(a)
  })

  it('says plainly which key is missing, and checks the URL', () => {
    expect(() => solisCreds({})).toThrow(SolisNotConfigured)
    expect(() => solisCreds({ SOLIS_KEY_ID: 'id' })).toThrow(/KeySecret not set/)
    expect(solisCreds({ SOLIS_KEY_ID: ' id ', SOLIS_KEY_SECRET: 'sec' })).toEqual({ keyId: 'id', secret: 'sec', apiUrl: 'https://www.soliscloud.com:13333' })
    expect(solisCreds({ SOLIS_KEY_ID: 'id', SOLIS_KEY_SECRET: 'sec', SOLIS_API_URL: 'https://www.soliscloud.com:13333/' }).apiUrl).toBe('https://www.soliscloud.com:13333')
    expect(() => solisCreds({ SOLIS_KEY_ID: 'id', SOLIS_KEY_SECRET: 'sec', SOLIS_API_URL: 'http://www.soliscloud.com:13333' })).toThrow(/https/)
  })
})

describe('SolisCloud client', () => {
  const creds = { keyId: 'k', secret: 's', apiUrl: 'https://solis.example:13333' }
  const reply = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

  it('tries again after a 502, then reads the data', async () => {
    const seen: string[] = []
    const answers = [reply(502, 'Bad Gateway'), reply(200, { success: true, code: '0', msg: 'success', data: { ok: 1 } })]
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).Authorization.split(':')[0]}`)
      return answers.shift()!
    }) as unknown as typeof fetch
    const c = solisClient(creds, { fetchImpl, wait: async () => {}, gapMs: 0 })
    await expect(c.call('/v1/api/userStationList', { pageNo: 1 })).resolves.toEqual({ ok: 1 })
    expect(seen).toEqual(['https://solis.example:13333/v1/api/userStationList API k', 'https://solis.example:13333/v1/api/userStationList API k'])
    expect(c.calls).toBe(2)
  })

  it('names the Solis error code, and does not retry it', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n++
      return reply(200, { success: false, code: 'R0000', msg: 'No authority' })
    }) as unknown as typeof fetch
    const c = solisClient(creds, { fetchImpl, wait: async () => {}, gapMs: 0 })
    await expect(c.call('/v1/api/stationMonth', {})).rejects.toThrow(/R0000 "No authority" — no authority/)
    expect(n).toBe(1)
  })

  it('reads a refused signature as a key problem', async () => {
    const fetchImpl = (async () => reply(403, '')) as unknown as typeof fetch
    const c = solisClient(creds, { fetchImpl, wait: async () => {}, gapMs: 0 })
    await expect(c.call('/v1/api/userStationList', {})).rejects.toThrow(/refused the keys/)
  })

  it('gives up after three tries with the last reason', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const c = solisClient(creds, { fetchImpl, wait: async () => {}, gapMs: 0 })
    await expect(c.call('/v1/api/userStationList', {})).rejects.toThrow(/ECONNRESET.*tried 3 times/)
  })

  it('reads every page of plants', async () => {
    const page = (n: number) => reply(200, { code: '0', data: { page: { pages: 2, records: [{ id: n, stationName: `Site${n}` }] } } })
    const answers = [page(1), page(2)]
    const fetchImpl = (async () => answers.shift()!) as unknown as typeof fetch
    const c = solisClient(creds, { fetchImpl, wait: async () => {}, gapMs: 0 })
    expect((await c.stations()).map((s) => s.name)).toEqual(['Site1', 'Site2'])
  })
})

describe('reading SolisCloud', () => {
  it('keeps a 19-digit station id exact', () => {
    // JSON.parse alone gives 1298491919448631800.
    const j = parseSolisJson('{"code":"0","data":{"page":{"records":[{"id":1298491919448631809,"stationName":"Site1","capacity":144}]}}}') as {
      data: { page: { records: { id: string; capacity: number }[] } }
    }
    expect(j.data.page.records[0].id).toBe('1298491919448631809')
    expect(j.data.page.records[0].capacity).toBe(144)
    // Already a string: left alone.
    expect((parseSolisJson('{"id":"1298491919448631809"}') as { id: string }).id).toBe('1298491919448631809')
  })

  it('reads every number in its own unit', () => {
    expect(toKwh(5.603, 'MWh')).toBeCloseTo(5603)
    expect(toKwh(31.3, 'kWh')).toBe(31.3)
    expect(toKwh(1.2, 'GWh')).toBe(1_200_000)
    expect(toKwh(755, 'MWh', '0.001')).toBeCloseTo(755)
    expect(toKw(77, 'kW', '0.001')).toBeCloseTo(0.077)
    expect(toKw(5772, 'W')).toBeCloseTo(5.772)
    expect(toKwh(10, 'furlongs')).toBeNull()
    expect(toKwh(null, 'kWh')).toBeNull()
  })

  it('reads the stationDetail example in the API document', () => {
    // §4.2 return example, trimmed: dayEnergy in kWh, yearEnergy and allEnergy in MWh.
    const s = parseStation({
      id: '1298491919448631809',
      stationName: 'Forster',
      addr: '',
      power: 5.772,
      powerStr: 'kW',
      capacity: 12.0,
      capacityStr: 'kWp',
      dayEnergy: 31.3,
      dayEnergyStr: 'kWh',
      monthEnergy: 839.0,
      monthEnergyStr: 'kWh',
      yearEnergy: 5.603,
      yearEnergyStr: 'MWh',
      allEnergy: 36.393,
      allEnergyStr: 'MWh',
      allEnergy1: 36393.0,
      timeZone: 10.0,
      state: 1,
      dataTimestamp: '1687844402978',
    })!
    expect(s.stationId).toBe('1298491919448631809')
    expect(s.address).toBeNull()
    expect(s.capacityKwp).toBe(12)
    expect(s.powerKw).toBe(5.772)
    expect(s.dayKwh).toBe(31.3)
    expect(s.yearKwh).toBeCloseTo(5603)
    expect(s.totalKwh).toBeCloseTo(36393)
    expect(s.timeZone).toBe(10)
    expect(s.readingAt).toBe('2023-06-27T05:40:02.978Z')
  })

  it('reads a userStationList page', () => {
    const { stations, pages } = stationListPage({ page: { pages: 1, records: [{ id: '1', stationName: 'Site4', capacity: 144, capacityStr: 'kWp', power: 131.88, powerStr: 'kW', dayEnergy: 516.8, dayEnergyStr: 'kWh' }, { stationName: 'no id' }] } })
    expect(pages).toBe(1)
    expect(stations).toHaveLength(1)
    expect(stations[0]).toMatchObject({ name: 'Site4', capacityKwp: 144, powerKw: 131.88, dayKwh: 516.8 })
  })

  it('reads stationMonth days, and lets full hours settle the unit', () => {
    const days = parseMonthRows(
      [
        // §4.8 example: 44.9 kWh, fullHour 3.74 on a 12 kWp plant.
        { energy: 44.9, energyStr: 'kWh', energyPec: '1', fullHour: 3.74, dateStr: '2023-06-30', gridSellEnergy: 0, gridPurchasedEnergy: 0, homeLoadEnergy: 44.9 },
        // A day reported in MWh: 0.04752 MWh is 47.52 kWh, and 3.96 full hours × 12 kWp agrees.
        { energy: 0.04752, energyStr: 'MWh', energyPec: '1', fullHour: 3.96, dateStr: '2023-07-01', gridSellEnergy: 0, gridPurchasedEnergy: 0, homeLoadEnergy: 0 },
        // Unit and multiplier that cannot both be right: full hours win (4 h × 12 kWp).
        { energy: 48, energyStr: 'MWh', fullHour: 4, dateStr: '2023-07-02' },
        { energy: 1, dateStr: 'not a date' },
      ],
      12,
    )
    expect(days.map((d) => d.day)).toEqual(['2023-06-30', '2023-07-01', '2023-07-02'])
    // Metered (home load reported): the zeros are real.
    expect(days[0]).toEqual({ day: '2023-06-30', producedKwh: 44.9, gridExportKwh: 0, gridImportKwh: 0, homeLoadKwh: 44.9 })
    expect(days[1].producedKwh).toBeCloseTo(47.52)
    // All three grid figures zero on a day it made power: no meter, not "nothing exported".
    expect(days[1].gridExportKwh).toBeNull()
    expect(days[2].producedKwh).toBe(48)
  })

  it('reads the stationYear example’s "755 MWh" as 755 kWh', () => {
    // §4.9: energy 755, energyStr MWh, energyPec 0.001, fullHour 62.92, 12 kWp.
    const [m] = parseMonthRows([{ energy: 755, energyStr: 'MWh', energyPec: '0.001', fullHour: 62.92, dateStr: '2023-02-01' }], 12)
    expect(m.producedKwh).toBeCloseTo(755, 0)
  })

  it('matches a placeholder by name however Solis spaces it', () => {
    expect(normSiteName('Site 3B')).toBe(normSiteName('site3b'))
    expect(normSiteName('Site3a')).not.toBe(normSiteName('Site 3B'))
  })
})

describe('what to pull', () => {
  it('backfills the year on a plant’s first run', () => {
    expect(monthsToPull('2026-10-06', { haveYear: false })).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(monthsToPull('2026-10-06', { haveYear: false, firstGenerationOn: '2026-08-14' })).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(monthsToPull('2026-10-06', { haveYear: false, firstGenerationOn: '2021-05-01' })).toHaveLength(10)
  })

  it('then reads this month, and last month for its first three days', () => {
    expect(monthsToPull('2026-10-06', { haveYear: true })).toEqual(['2026-10'])
    expect(monthsToPull('2026-10-02', { haveYear: true })).toEqual(['2026-09', '2026-10'])
    expect(monthsToPull('2027-01-01', { haveYear: true })).toEqual(['2026-12', '2027-01'])
  })

  it('reads a past year whole when asked', () => {
    expect(monthsToPull('2026-10-06', { haveYear: true, year: 2025 })).toHaveLength(12)
    expect(monthsToPull('2026-10-06', { haveYear: true, year: 2025, firstGenerationOn: '2025-06-03' })[0]).toBe('2025-06')
    expect(monthsToPull('2026-10-06', { haveYear: true, year: 2027 })).toEqual([])
  })

  it('knows the farm’s day and offset', () => {
    // 1:51 pm MDT on 6 Oct 2026 is 19:51 UTC; 11 pm MDT is the next day in UTC.
    expect(dateIn('America/Edmonton', new Date('2026-10-07T05:00:00Z'))).toBe('2026-10-06')
    expect(tzOffsetHours('America/Edmonton', new Date('2026-10-06T19:51:00Z'))).toBe(-6)
    expect(tzOffsetHours('America/Edmonton', new Date('2026-01-06T19:51:00Z'))).toBe(-7)
  })
})

describe('the Solar screen', () => {
  const sites = [
    { id: 'a', name: 'Site1', label: null, capacity_kwp: '144', sort_order: 1, solis_station_id: '1' },
    { id: 'b', name: 'Site 3B', label: 'East shop', capacity_kwp: 36, sort_order: 4, solis_station_id: '2' },
  ]
  const o = { year: 2026, today: '2026-10-06', sellPrice: 0.35, tz: 'America/Edmonton' }

  it('adds the year up from the stored days and prices it', () => {
    const daily = [
      { site_id: 'a', day: '2026-10-05', produced_kwh: '600' },
      { site_id: 'a', day: '2026-09-30', produced_kwh: 400 },
      { site_id: 'b', day: '2026-10-05', produced_kwh: 150 },
      { site_id: 'b', day: '2025-10-05', produced_kwh: 999 },
    ]
    const latest = [
      { site_id: 'a', power_kw: '124.14', today_kwh: '570.8', year_kwh: 1, state: 1, reading_at: '2026-10-06T19:51:00Z' },
      // Last heard from yesterday: no "now" and no live today.
      { site_id: 'b', power_kw: 35.67, today_kwh: 152, year_kwh: 1, state: 2, reading_at: '2026-10-05T23:00:00Z' },
    ]
    const s = summarizeSolar(sites, latest, daily, o)
    expect(s.rows.map((r) => r.name)).toEqual(['Site1', 'East shop'])
    expect(s.rows[0]).toMatchObject({ capacityKwp: 144, powerKw: 124.14, todayKwh: 570.8, yearKwh: 1000, yearValue: 350 })
    expect(s.rows[1]).toMatchObject({ powerKw: null, todayKwh: null, yearKwh: 150 })
    expect(s.total).toMatchObject({ capacityKwp: 180, powerKw: 124.14, todayKwh: 570.8, yearKwh: 1150 })
    expect(s.total.yearValue).toBeCloseTo(402.5)
    expect(s.byMonth.map((m) => [m.month, m.total])).toEqual([
      ['2026-09', 400],
      ['2026-10', 750],
    ])
    expect(s.newestReading).toBe('2026-10-06T19:51:00Z')
  })

  it('stands SolisCloud’s year total in until the days are stored, for this year only', () => {
    const latest = [{ site_id: 'a', power_kw: 1, today_kwh: 1, year_kwh: '123456', state: 1, reading_at: '2026-10-06T19:51:00Z' }]
    expect(summarizeSolar(sites, latest, [], o).rows[0].yearKwh).toBe(123456)
    const past = summarizeSolar(sites, latest, [], { ...o, year: 2025 })
    expect(past.current).toBe(false)
    expect(past.rows[0]).toMatchObject({ yearKwh: null, powerKw: null, todayKwh: null })
  })

  it('shows placeholders with capacity and nothing else', () => {
    const s = summarizeSolar([{ id: 'p', name: 'Site4', label: null, capacity_kwp: 144, sort_order: 5, solis_station_id: null }], [], [], o)
    expect(s.rows[0]).toMatchObject({ capacityKwp: 144, yearKwh: null, yearValue: null, connected: false })
    expect(s.total.yearKwh).toBeNull()
  })
})
