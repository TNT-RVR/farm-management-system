import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  CONNECTIONS,
  buildConnections,
  clip,
  connectionStatus,
  countByStatus,
  effectiveStatus,
  filterConnections,
  loadPrefs,
  resolveOpenConnection,
  savePrefs,
  sortConnections,
  span,
  withoutOpenParams,
  type AccountLike,
  type Connection,
  type HealthLike,
} from './connections'
import { KEY_GROUPS, SETUP_KEYS, type KeyStatus } from './setup-keys'

const NOW = new Date('2026-10-14T18:00:00Z').getTime()
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

const feed = (source_key: string, over: Partial<HealthLike> = {}): HealthLike => ({
  source_key,
  label: source_key,
  check_kind: 'heartbeat',
  status: 'ok',
  detail: null,
  enabled: true,
  last_success_at: ago(2),
  data_at: ago(2),
  ...over,
})

const account = (provider: string, over: Partial<AccountLike> = {}): AccountLike => ({
  provider,
  status: 'connected',
  last_sync_at: ago(1),
  last_error: null,
  meta: null,
  ...over,
})

/** Every key in a group set (or only the listed ones). */
const keysFor = (group: string, only?: string[]): KeyStatus[] =>
  SETUP_KEYS.filter((k) => k.group === group && (!only || only.includes(k.env))).map((k) => ({
    env: k.env,
    source: 'app',
    updated_at: ago(100),
  }))

const def = (id: string) => CONNECTIONS.find((d) => d.id === id)!

describe('the registry', () => {
  it('gives every connection a unique id and a known category', () => {
    const ids = CONNECTIONS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of CONNECTIONS) expect(CATEGORIES).toContain(d.category)
  })

  it('claims every company that has keys, once', () => {
    for (const g of KEY_GROUPS) expect(CONNECTIONS.filter((d) => d.keyGroup === g), g).toHaveLength(1)
  })

  it('claims each health feed at most once', () => {
    const keys = CONNECTIONS.flatMap((d) => d.health ?? [])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('includes the sign-ins, the import tools and the new QuickBooks PDF readers', () => {
    expect(CONNECTIONS.filter((d) => d.signIn).map((d) => d.signIn).sort()).toEqual(['fieldnet', 'google_drive', 'john_deere', 'quickbooks'])
    expect(CONNECTIONS.filter((d) => d.tool).map((d) => d.id).sort()).toEqual(['binsense', 'crop_history_csv'])
    const claimed = CONNECTIONS.flatMap((d) => d.health ?? [])
    for (const k of ['fuel_supplier_qb_invoices', 'ici_qb_invoices', 'power_bills_qb', 'gas_bills_qb', 'plc_agent']) expect(claimed).toContain(k)
  })
})

describe('status', () => {
  it('is Working when keys, sign-in and feeds are all fine', () => {
    const s = connectionStatus(def('john_deere'), {
      keys: keysFor('John Deere Operations Center'),
      account: account('john_deere'),
      feeds: [feed('john_deere'), feed('jd_field_ops')],
      now: NOW,
    })
    expect(s).toEqual({ status: 'working', reason: null, waiting: false })
  })

  it('says how long a stale feed has had no data', () => {
    const s = connectionStatus(def('oldman_river'), {
      feeds: [feed('river_flow', { status: 'stale', check_kind: 'probe', data_at: ago(72), label: 'Oldman River flow (WSC 05AD007)' })],
      now: NOW,
    }).reason
    // Two feeds belong to the river, but only one exists here, so no label prefix.
    expect(s).toBe('No data for 3 days')
  })

  it('names the feed when the connection has several, and counts the rest', () => {
    const s = connectionStatus(def('utility_bills'), {
      feeds: [
        feed('power_bills_qb', { label: 'Power bills from QuickBooks (nightly)', status: 'stale', last_success_at: ago(50) }),
        feed('gas_bills_qb', { label: 'Gas bills from QuickBooks (nightly)', status: 'error', detail: 'Bad PDF. More text here.' }),
      ],
      now: NOW,
    })
    expect(s.status).toBe('attention')
    expect(s.reason).toBe('Power bills from QuickBooks: no data for 2 days (+1 more)')
  })

  it('treats a failing sign-in and an unshared Deere organization as needing attention', () => {
    expect(
      connectionStatus(def('quickbooks'), { account: account('quickbooks', { status: 'error', last_error: 'Token refresh failed. intuit_tid=1' }), feeds: [], now: NOW }),
    ).toMatchObject({ status: 'attention', reason: 'Token refresh failed.' })
    expect(
      connectionStatus(def('john_deere'), { account: account('john_deere', { meta: { needs_org_access: true } }), feeds: [], now: NOW }).reason,
    ).toBe('Organization not shared yet')
  })

  it('says which key is missing when only some are entered', () => {
    const s = connectionStatus(def('john_deere'), {
      keys: keysFor('John Deere Operations Center', ['JD_CLIENT_ID']),
      account: undefined,
      feeds: [],
      now: NOW,
    })
    expect(s).toMatchObject({ status: 'attention', reason: 'Key missing: Application secret' })
  })

  it('is Not set up with no keys, or keys but no sign-in', () => {
    expect(connectionStatus(def('fieldnet'), { keys: [], feeds: [], now: NOW })).toMatchObject({ status: 'not_set_up', reason: 'Keys not entered' })
    expect(
      connectionStatus(def('fieldnet'), { keys: keysFor('Lindsay FieldNET'), account: account('fieldnet', { status: 'disconnected' }), feeds: [], now: NOW }),
    ).toMatchObject({ status: 'not_set_up', reason: 'Sign in needed' })
    // A manager (no key status) still sees the sign-in is missing.
    expect(connectionStatus(def('quickbooks'), { feeds: [], now: NOW })).toMatchObject({ status: 'not_set_up', reason: 'Sign in needed' })
  })

  it('is Off when every feed has monitoring off and nothing else is connected', () => {
    expect(connectionStatus(def('plc'), { feeds: [feed('plc_agent', { enabled: false, status: 'unknown' })], now: NOW })).toMatchObject({
      status: 'off',
      reason: 'Monitoring off',
    })
    // Off feeds do not hide a working sign-in.
    expect(
      connectionStatus(def('quickbooks'), { account: account('quickbooks'), feeds: [feed('quickbooks', { enabled: false })], now: NOW }).status,
    ).toBe('working')
  })

  it('is Off for an optional company with nothing entered and nothing ever in', () => {
    expect(
      connectionStatus(def('timeoff'), { keys: [], feeds: [feed('timeoff_calendar', { status: 'unknown', last_success_at: null, data_at: null })], now: NOW }),
    ).toMatchObject({ status: 'off', reason: 'Not in use (optional)' })
  })

  it('ignores a disabled feed that is stale', () => {
    expect(connectionStatus(def('weather'), { feeds: [feed('weather_sync'), feed('field_rain', { enabled: false, status: 'stale' })], now: NOW }).status).toBe('working')
  })

  it('marks a working connection that has had nothing in yet as waiting', () => {
    expect(connectionStatus(def('season_outlook'), { feeds: [feed('season_outlook', { status: 'unknown', last_success_at: null, data_at: null })], now: NOW })).toEqual({
      status: 'working',
      reason: null,
      waiting: true,
    })
  })
})

describe('buildConnections', () => {
  const health = [
    feed('river_flow', { check_kind: 'probe', data_at: ago(0.5), last_success_at: ago(30) }),
    feed('jd_field_ops', { last_success_at: ago(5) }),
    feed('brand_new_job', { label: 'Brand New Job' }),
  ]

  it('lists keys-only companies for admins only', () => {
    const admin = buildConnections({ keys: [], accounts: [], health, now: NOW })
    const manager = buildConnections({ accounts: [], health, now: NOW })
    expect(admin.some((c) => c.id === 'site')).toBe(true)
    expect(manager.some((c) => c.id === 'site')).toBe(false)
    expect(manager.some((c) => c.id === 'resend')).toBe(false)
    // Sign-ins, tools and panels show for managers.
    for (const id of ['john_deere', 'crop_history_csv', 'binsense', 'plc', 'quickbooks']) expect(manager.some((c) => c.id === id), id).toBe(true)
    expect(manager.find((c) => c.id === 'john_deere')?.keys).toBeUndefined()
  })

  it('leaves out feed-only connections whose feeds this install does not have', () => {
    const rows = buildConnections({ accounts: [], health, now: NOW })
    expect(rows.some((c) => c.id === 'cattle_markets')).toBe(false)
    expect(rows.some((c) => c.id === 'oldman_river')).toBe(true)
  })

  it('lists a feed nobody claims under Other', () => {
    const extra = buildConnections({ health, now: NOW }).find((c) => c.id === 'feed:brand_new_job')
    expect(extra).toMatchObject({ name: 'Brand New Job', category: 'Other', status: 'working' })
  })

  it('takes the newest of a probe reading, a heartbeat and the account sync as last data', () => {
    const rows = buildConnections({ accounts: [account('john_deere', { last_sync_at: ago(10) })], health, now: NOW })
    expect(rows.find((c) => c.id === 'oldman_river')?.lastDataAt).toBe(ago(0.5))
    expect(rows.find((c) => c.id === 'john_deere')?.lastDataAt).toBe(ago(5))
  })
})

describe('filter and sort', () => {
  const rows: Connection[] = buildConnections({
    keys: [...keysFor('Your site'), ...keysFor('John Deere Operations Center', ['JD_CLIENT_ID'])],
    accounts: [account('quickbooks')],
    health: [
      feed('river_flow', { status: 'stale', last_success_at: ago(80), check_kind: 'probe', data_at: ago(80), label: 'Oldman River flow' }),
      feed('quickbooks', { last_success_at: ago(3) }),
      feed('plc_agent', { enabled: false }),
      feed('auction_mhfc', { label: 'Medicine Hat auction reports (MHFC)', last_success_at: ago(20) }),
    ],
    now: NOW,
  })

  it('counts each status', () => {
    const c = countByStatus(rows)
    expect(c.all).toBe(rows.length)
    expect(c.attention).toBe(2) // the river, and John Deere's half-entered keys
    expect(c.attention + c.not_set_up + c.working + c.off).toBe(c.all)
  })

  it('opens on Needs attention when anything needs it, else All', () => {
    const counts = countByStatus(rows)
    expect(effectiveStatus(null, undefined, counts)).toBe('attention')
    expect(effectiveStatus(null, undefined, { ...counts, attention: 0 })).toBe('all')
    // A remembered or chosen chip wins, unless nothing is under it.
    expect(effectiveStatus(null, 'working', counts)).toBe('working')
    expect(effectiveStatus('off', 'working', counts)).toBe('off')
    expect(effectiveStatus(null, 'attention', { ...counts, attention: 0 })).toBe('all')
    expect(effectiveStatus('all', undefined, counts)).toBe('all')
  })

  it('filters by status, category and search words together', () => {
    expect(filterConnections(rows, { status: 'attention', category: 'all', query: '' }).map((r) => r.id).sort()).toEqual(['john_deere', 'oldman_river'])
    // The admin sees the companies with keys (eShepherd, the feed sheet) as well as the feeds.
    expect(filterConnections(rows, { status: 'all', category: 'Cattle', query: '' }).map((r) => r.id).sort()).toEqual(['cattle_markets', 'eshepherd', 'feed_sheet'])
    // By a feed's label, a key's name, a keyword.
    expect(filterConnections(rows, { status: 'all', category: 'all', query: 'medicine hat' }).map((r) => r.id)).toEqual(['cattle_markets'])
    expect(filterConnections(rows, { status: 'all', category: 'all', query: 'JD_CLIENT_SECRET' }).map((r) => r.id)).toEqual(['john_deere'])
    expect(filterConnections(rows, { status: 'all', category: 'all', query: 'modbus' }).map((r) => r.id)).toEqual(['plc'])
    expect(filterConnections(rows, { status: 'working', category: 'all', query: 'modbus' })).toEqual([])
  })

  it('sorts problems first, by name, or by last update', () => {
    const byStatus = sortConnections(rows, 'status').map((r) => r.status)
    const order = ['attention', 'not_set_up', 'working', 'off']
    for (let i = 1; i < byStatus.length; i++) expect(order.indexOf(byStatus[i])).toBeGreaterThanOrEqual(order.indexOf(byStatus[i - 1]))
    const names = sortConnections(rows, 'name').map((r) => r.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    const updated = sortConnections(rows, 'updated')
    expect(updated[0].id).toBe('quickbooks')
    // Never-updated ones sink to the bottom.
    expect(updated[updated.length - 1].lastDataAt).toBeNull()
  })
})

describe('remembered choices', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }

  it('round-trips per person', () => {
    const s = memory()
    savePrefs('u1', { status: 'off', category: 'Cattle', sort: 'name' }, s)
    expect(loadPrefs('u1', s)).toEqual({ status: 'off', category: 'Cattle', sort: 'name' })
    expect(loadPrefs('u2', s)).toEqual({})
  })

  it('drops values it does not know, and survives storage that throws', () => {
    const s = memory()
    s.setItem('connections-view:v1:u1', JSON.stringify({ status: 'broken', category: 'Nope', sort: 'name' }))
    expect(loadPrefs('u1', s)).toEqual({ sort: 'name' })
    s.setItem('connections-view:v1:u1', '{not json')
    expect(loadPrefs('u1', s)).toEqual({})
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadPrefs('u1', throwing)).toEqual({})
    expect(() => savePrefs('u1', { sort: 'name' }, throwing)).not.toThrow()
    expect(loadPrefs('u1', null)).toEqual({})
  })
})

describe('links', () => {
  const p = (q: string) => new URLSearchParams(q)

  it('opens ?c=, the old ?open= cards, sign-in returns and #keys- anchors', () => {
    expect(resolveOpenConnection(p('tab=Connections&c=plc'))).toBe('plc')
    expect(resolveOpenConnection(p('tab=Integrations&open=deere'))).toBe('john_deere')
    expect(resolveOpenConnection(p('open=fieldnet&field=abc'))).toBe('fieldnet')
    expect(resolveOpenConnection(p('jd_connected=1'))).toBe('john_deere')
    expect(resolveOpenConnection(p('tab=Farm setup&part=connections&qb_error=denied'))).toBe('quickbooks')
    expect(resolveOpenConnection(p('qb_disconnected=1'))).toBe('quickbooks')
    expect(resolveOpenConnection(p('fieldnet_connected=1'))).toBe('fieldnet')
    expect(resolveOpenConnection(p('gd_connected=1'))).toBe('google_drive')
    expect(resolveOpenConnection(p(''), '#keys-john-deere-operations-center')).toBe('john_deere')
    expect(resolveOpenConnection(p(''), '#keys-satellite-imagery-copernicus-')).toBe('copernicus')
    expect(resolveOpenConnection(p('tab=Connections'))).toBeNull()
  })

  it('clears what opened a detail when it closes, and keeps the tab', () => {
    expect(withoutOpenParams(p('tab=Connections&c=plc&jd_connected=1&open=deere&field=x')).toString()).toBe('tab=Connections')
  })
})

describe('text', () => {
  it('spans minutes, hours and days', () => {
    expect(span(ago(0.25), NOW)).toBe('15 min')
    expect(span(ago(1), NOW)).toBe('1 hour')
    expect(span(ago(30), NOW)).toBe('30 hours')
    expect(span(ago(72), NOW)).toBe('3 days')
  })

  it('cuts an error to its first sentence', () => {
    expect(clip('First thing broke. Then more.')).toBe('First thing broke.')
    expect(clip('x'.repeat(200)).length).toBe(90)
  })
})
