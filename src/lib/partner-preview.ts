/**
 * "View as partner" (Sam, 26 Oct 2026): an admin sees the app as a
 * partner sees it, in his own window, to judge and adjust it.
 *
 * Looking right is not enough: the admin's account can read everything, so a
 * screen that would come up empty or broken for the partner would look fine.
 * While a preview is on, every database request goes through partnerFetch,
 * which answers it the way the partner's database rules would (migration
 * 20261026120100): tables he cannot read come back empty, field records only
 * for his fields, lease and margin columns blank, embedded fields/crops null,
 * writes refused outside the tables he records into, functions refused.
 *
 * It only ever narrows: the requests still go out as the admin, so a preview
 * can never see more than the admin could. Not covered: the year limit on his
 * writes, and calls to the site's own server functions (/api), which the
 * partner is refused and the admin is not.
 *
 * No import of the database client here: it imports this file.
 */

export type PartnerPreview = {
  userId: string
  name: string
  fieldIds: string[]
  /** His company (users.farm_id), null before he has one. */
  farmId?: string | null
  /** The crops he grows on our fields (partner_crop_ids, as far as an admin can read). */
  cropIds?: string[]
}

const KEY = 'partnerPreview'
let current: PartnerPreview | null = read()
const listeners = new Set<() => void>()

function read(): PartnerPreview | null {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PartnerPreview) : null
  } catch {
    return null
  }
}

export const getPartnerPreview = () => current
export function setPartnerPreview(p: PartnerPreview | null) {
  current = p
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* private window: the preview lasts until reload */
  }
  listeners.forEach((l) => l())
}
export function subscribePartnerPreview(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Field-scoped tables he reads on his fields (partner_read policies). */
export const PARTNER_FIELD_TABLES = new Set([
  'field_boundaries', 'field_crop_zones', 'crop_plans', 'crop_history', 'crop_area_yields',
  'jd_field_operations', 'field_work_records', 'irrigation_events', 'field_crop_seasons',
  'soil_moisture_readings', 'water_balance_daily', 'field_pivots', 'fieldnet_passes',
  'scouting_notes', 'tissue_tests', 'soil_test_reports',
  // Views over those that his account really reads (checked as him, 26 Oct).
  'field_boundaries_geojson', 'field_centroids', 'field_season_water', 'crop_yields_v', 'product_applications',
  // Planting season (migration 20261029130000). Manure is his only in the
  // years he grows the field; the preview shows every year of it.
  'fertility_rx', 'fert_blends', 'fert_split_plans', 'fert_check_strips', 'n_trials', 'n_rich_strips',
  'field_files', 'field_yield_zones', 'map_features', 'manure_applications',
  'field_soil_units', 'field_yield_zones_geojson', 'n_rich_strip_list', 'n_strip_sufficiency',
  // Growing season and harvest (migration 20261029160000). Loads and moisture
  // tests are his only in the years he grows the field; the preview shows every year.
  'hail_inspections', 'field_hail_events', 'pivot_depth_checks', 'field_soil_profiles',
  'field_season_outlook', 'water_balance_wedges', 'bin_loads', 'moisture_tests', 'field_season_progress',
  // Road distances to his fields (20261030100000).
  'field_haul_plans',
])
/**
 * Crops by field and year, which he reads for every one of our fields (the
 * rotation, migration 20261029150000); he writes them in his field-years only.
 */
const ROTATION_TABLES = new Set(['crop_plans', 'crop_history', 'crop_plan_options', 'field_crop_zones'])
/** A soil test's samples and write-up, read through the report. */
const SOIL_REPORT_TABLES = new Set(['soil_test_samples', 'soil_test_assessments'])
/** Reference lists he reads whole. */
const PARTNER_REFERENCE_TABLES = new Set([
  'chemicals', 'chemical_labels', 'chemical_label_crops', 'chemical_recrop_rules', 'chemical_grazing_rules',
  // The rotation rules tab.
  'crop_succession_rules', 'crop_acre_limits', 'chemical_recrop_overrides',
  // Fertilizer prices and markets, and the provincial soil survey.
  'jd_products', 'jd_product_aliases', 'product_documents', 'product_purchases', 'fert_blend_products',
  'market_series', 'market_prices', 'fert_settings', 'ab_input_prices', 'ab_input_latest',
  'soil_landscape_polygons', 'soil_landscape_geojson',
  // Weather, crop water use, rain gauges, pumps, and where loads are delivered.
  'weather_daily', 'weather_stations', 'crop_coefficients', 'rain_gauges', 'rain_gauge_readings',
  'pumps', 'delivery_sites',
  // Fuel & trucking's roads and yards; the calendar's weather normals.
  'road_routes', 'farm_yards', 'weather_normals',
])
/** His company's own records (partner_own policies), and what hangs off them. */
const OWN_COMPANY_TABLES = new Set([
  'jd_equipment', 'equipment_service_log', 'equipment_service_plans', 'truck_inspections', 'jd_equipment_alerts',
  'tasks', 'tasks_with_assignees', 'task_assignees', 'task_files', 'calendar_events',
])
/** Rows that are the signed-in person's own (own-row policies). */
const OWN_TABLES = new Set(['notifications', 'notification_prefs', 'notification_settings', 'notification_push_queue', 'push_subscriptions'])
/** Tables he records into. */
const PARTNER_WRITE_TABLES = new Set([
  'field_work_records', 'scouting_notes', 'tissue_tests', 'soil_moisture_readings', 'irrigation_events',
  'crop_history', 'crop_area_yields', 'crop_plans', 'field_crop_seasons',
  // The crops he grows (partner_write on each, 29 Oct 2026).
  'crops', 'crop_prices', 'crop_varieties', 'crop_variety_settings',
  // His company's setup and people, which the one who runs it keeps.
  'partner_farm_setup', 'users',
  // His fertility plan and savings records, in his field-years.
  'fert_blends', 'fert_split_plans', 'fert_check_strips', 'n_trials', 'n_rich_strips',
  // Fertilizer prices (migration 20261029140000).
  'jd_products', 'jd_product_aliases', 'fert_blend_products',
  // His rotation plans and the rules of the crops he grows (20261029150000).
  'crop_plan_options', 'field_crop_zones', 'crop_succession_rules',
  // His weigh-scale loads (to a plant) and moisture tests (20261029160000).
  'bin_loads', 'moisture_tests',
])
/** Tables read only for the crops he grows. */
const PARTNER_CROP_TABLES = new Set(['crop_prices', 'crop_varieties', 'crop_variety_settings', 'contracts', 'scale_tickets'])
const PARTNER_RPCS = new Set(['public_brand', 'delete_field_work_record'])

/** Columns the partner_fields_v / partner_crops_v views blank. */
const BLANKED: Record<string, string[]> = {
  fields: ['rented_out_acres', 'rented_out_to', 'tenure_notes', 'rented_out_crop', 'grazing_note'],
  crops: ['margin_per_acre', 'margin_source', 'sister_value_per_acre', 'sister_value_note'],
  // Every row in a preview, though the view keeps them for his own fields.
  partner_rotation_fields_v: [
    'rented_out_acres', 'rented_out_to', 'tenure_notes', 'rented_out_crop', 'grazing_note',
    'notes_md', 'pivot_start_instructions_md', 'soil_notes_md',
  ],
  // The grant and conference lists, without ours on them.
  partner_grants_v: ['notes_md', 'assigned_to'],
  partner_events_v: ['notes_md', 'assigned_to', 'travel_notes'],
  // Joins fields, which he reads only through partner_fields_v: blank for him.
  product_applications: ['field_name'],
}

const NO_FIELD = '00000000-0000-0000-0000-000000000000'

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function emptyRead(req: Request) {
  // .single() asks for one object; with no rows PostgREST says so (PGRST116).
  if ((req.headers.get('Accept') ?? '').includes('vnd.pgrst.object')) {
    return json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null }, 406)
  }
  return json([], 200, { 'Content-Range': '*/0' })
}

function refused(what: string) {
  return json({ code: '42501', message: `A partner cannot ${what}. (Viewing as partner)`, details: null, hint: null }, 403)
}

/** Keys in a select= that embed fields or crops, which he cannot read embedded. */
function embeddedKeys(select: string | null): string[] {
  if (!select) return []
  const keys: string[] = []
  for (const m of select.matchAll(/(?:(\w+):)?(fields|crops)(?:!\w+)?\(/g)) keys.push(m[1] ?? m[2])
  return keys
}

async function reshape(res: Response, table: string, embedded: string[]): Promise<Response> {
  const blank = BLANKED[table] ?? []
  if (!res.ok || (!blank.length && !embedded.length)) return res
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return new Response(text, { status: res.status, headers: res.headers })
  }
  const fix = (row: unknown) => {
    if (!row || typeof row !== 'object') return row
    const r = row as Record<string, unknown>
    for (const k of blank) if (k in r) r[k] = null
    for (const k of embedded) if (k in r) r[k] = null
    return r
  }
  body = Array.isArray(body) ? body.map(fix) : fix(body)
  return new Response(JSON.stringify(body), { status: res.status, headers: res.headers })
}

/** The database client's fetch. Passes straight through unless a preview is on. */
export async function partnerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const p = current
  if (!p) return fetch(input, init)
  const req = new Request(input, init)
  const url = new URL(req.url)
  const m = url.pathname.match(/\/rest\/v1\/(rpc\/)?([^/]+)$/)
  if (!m) return fetch(req) // sign-in, storage: unchanged
  const [, rpc, name] = m
  const method = req.method.toUpperCase()
  const read = method === 'GET' || method === 'HEAD'

  if (rpc) return PARTNER_RPCS.has(name) ? fetch(req) : refused(`run ${name}`)

  if (!read && !PARTNER_WRITE_TABLES.has(name)) return refused(`change ${name}`)

  const ids = p.fieldIds.length ? p.fieldIds : [NO_FIELD]
  const embedded = embeddedKeys(url.searchParams.get('select'))
  const onlyHis = async (col: string) => {
    url.searchParams.append(col, `in.(${ids.join(',')})`)
    return reshape(await fetch(new Request(url, req)), name, embedded)
  }

  if (name === 'fields') return read ? onlyHis('id') : refused('change fields')
  // The rotation's list of all our fields: names only, as the view gives him.
  if (read && name === 'partner_rotation_fields_v') {
    url.pathname = url.pathname.replace(/[^/]+$/, 'fields')
    return reshape(await fetch(new Request(url, req)), 'partner_rotation_fields_v', embedded)
  }
  // Grants and conferences: the lists, blanked as his views blank them.
  // Either name: the preview may ask for the table itself.
  const list = name === 'grants' || name === 'partner_grants_v' ? 'partner_grants_v' : name === 'events' || name === 'partner_events_v' ? 'partner_events_v' : null
  if (read && list) {
    url.pathname = url.pathname.replace(/[^/]+$/, list === 'partner_grants_v' ? 'grants' : 'events')
    const res = await reshape(await fetch(new Request(url, req)), list, embedded)
    if (!res.ok) return res
    // Our progress on each is ours: a grant is new to him unless it closed, a conference one he is watching.
    const rows = (await res.json()) as { status?: string | null }[]
    const status = (r: { status?: string | null }) => (list === 'partner_events_v' ? 'watching' : r.status === 'closed' ? 'closed' : 'new')
    return json(Array.isArray(rows) ? rows.map((r) => ({ ...r, status: status(r) })) : rows, res.status)
  }
  // His company's own machines, tasks and calendar. An admin cannot read
  // them, so a preview shows none; ours never show.
  if (read && OWN_COMPANY_TABLES.has(name)) return emptyRead(req)
  // Field progress, which his account reads through a function: the same rows, his fields.
  if (read && name === 'partner_season_progress_v') {
    url.pathname = url.pathname.replace(/[^/]+$/, 'field_season_progress')
    return onlyHis('field_id')
  }
  if (read && ROTATION_TABLES.has(name)) return reshape(await fetch(req), name, embedded)
  if (name === 'crops') return reshape(await fetch(req), name, embedded)
  if (PARTNER_CROP_TABLES.has(name) && read) {
    url.searchParams.append('crop_id', `in.(${(p.cropIds?.length ? p.cropIds : [NO_FIELD]).join(',')})`)
    return fetch(new Request(url, req))
  }
  // His company: its row, its setup and its people. An admin's account cannot
  // read his company's own fields or crops at all, so those stay out of a preview.
  const company = p.farmId ?? NO_FIELD
  if (read && name === 'farms') {
    url.searchParams.append('id', `eq.${company}`)
    return fetch(new Request(url, req))
  }
  if (read && name === 'partner_farm_setup') {
    url.searchParams.append('farm_id', `eq.${company}`)
    return fetch(new Request(url, req))
  }
  if (read && name === 'users' && !url.searchParams.get('id')?.startsWith('eq.')) {
    url.searchParams.append('farm_id', `eq.${company}`)
    return fetch(new Request(url, req))
  }
  if (PARTNER_FIELD_TABLES.has(name)) return read ? onlyHis('field_id') : reshape(await fetch(req), name, embedded)
  if (read && SOIL_REPORT_TABLES.has(name)) {
    const reports = new URL(url)
    reports.pathname = reports.pathname.replace(/[^/]+$/, 'soil_test_reports')
    reports.search = `select=id&field_id=in.(${ids.join(',')})`
    const res = await fetch(new Request(reports, { headers: req.headers }))
    const rows = res.ok ? ((await res.json()) as { id: string }[]) : []
    url.searchParams.append('report_id', `in.(${(rows.length ? rows.map((r) => r.id) : [NO_FIELD]).join(',')})`)
    return fetch(new Request(url, req))
  }
  if (!read) return reshape(await fetch(req), name, embedded)
  if (PARTNER_REFERENCE_TABLES.has(name) || OWN_TABLES.has(name)) return reshape(await fetch(req), name, embedded)
  // What his company is given: its own rows only.
  if (name === 'partner_fields' || name === 'partner_crops' || name === 'partner_access') {
    url.searchParams.append('farm_id', `eq.${p.farmId ?? NO_FIELD}`)
    return fetch(new Request(url, req))
  }
  // His own users row only; the app reads the signed-in profile by id.
  if (name === 'users' && url.searchParams.get('id')?.startsWith('eq.')) return fetch(req)
  return emptyRead(req)
}
