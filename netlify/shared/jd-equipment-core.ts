import type { SupabaseClient } from '@supabase/supabase-js'
import { jdAccessToken, jdGet } from '../functions/_jd.mts'

// Machines and implements from Operations Center.
//
// Equipment lives under /isg/equipment, not the /platform tree the field
// operations use, and its records are less uniform: make/model/type arrive
// sometimes as strings and sometimes as objects with a `name`, depending on
// whether Deere recognises the machine or someone typed it in. Everything is
// read through pick()/pickName() for that reason, and `raw` keeps the original.

type Named = { name?: string } | string | null | undefined

/**
 * Deere writes a field as either "6155R" or {name: "6155R"}.
 *
 * "-" and "OTHER" are its placeholders for "not known", and they arrive often:
 * every implement someone typed in by hand carries make OTHER and model "-".
 * Showing those verbatim would dress an absence up as a fact.
 */
const PLACEHOLDER = /^(-+|other|unknown|n\/a)$/i
function pickName(v: Named): string | null {
  if (!v) return null
  const raw = typeof v === 'string' ? v : typeof v.name === 'string' ? v.name : ''
  const t = raw.trim()
  return !t || PLACEHOLDER.test(t) ? null : t
}

type EquipmentRecord = {
  id?: string
  name?: string
  /** "Machine" or "Implement" — this is the category, there is no `category`. */
  '@type'?: string
  category?: Named
  telematicsCapable?: boolean
  modelYear?: number | string
  engineSerialNumber?: string
  make?: Named
  model?: Named
  type?: Named
  equipmentType?: Named
  serialNumber?: string
  vin?: string
  archived?: boolean
  engineHours?: number | { value?: number; reportTime?: string }
}

export type EquipmentSyncResult = {
  ok: boolean
  equipment: number
  withHours: number
  detail: string
}

/** Page through an ISG list endpoint. */
async function listAll<T>(token: string, path: string, cap = 20): Promise<T[]> {
  const out: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 0; page < cap; page++) {
    const body = await jdGet<{ values?: T[] }>(token, `${path}${sep}page=${page}&itemLimit=100`)
    const values = body.values ?? []
    out.push(...values)
    if (values.length < 100) break
  }
  return out
}

/**
 * Latest engine hours for one machine.
 *
 * Returns null rather than throwing: plenty of equipment has no telematics at
 * all — a towed implement never reports hours — and that is a fact about the
 * machine, not a sync failure worth surfacing.
 */
async function engineHours(
  token: string,
  jdId: string,
): Promise<{ hours: number; at: string | null } | null> {
  try {
    const body = await jdGet<{
      values?: {
        reading?: { valueAsDouble?: number; valueAsInteger?: number }
        reportTime?: string
      }[]
    }>(token, `/platform/machines/${jdId}/engineHours`)
    // Deere wraps every measurement as {unit, @type, valueAsDouble} — there is no
    // plain `value`. Reading the wrong key returned null for all 84 machines
    // while the endpoint was answering perfectly, which read as "no telematics".
    const values = body.values ?? []
    const latest = values
      .filter((v) => v.reading)
      .sort((a, b) => Date.parse(b.reportTime ?? '') - Date.parse(a.reportTime ?? ''))[0]
    const reading = latest?.reading
    const hours = reading?.valueAsDouble ?? reading?.valueAsInteger
    if (typeof hours !== 'number' || !Number.isFinite(hours)) return null
    return { hours, at: latest?.reportTime ?? null }
  } catch {
    // A machine with no modem 403s or returns nothing. That is a fact about the
    // machine, not a sync failure.
    return null
  }
}

export type MachineAlert = {
  id?: string
  time?: string
  severity?: string
  color?: string
  ignored?: boolean
  acknowledgementStatus?: string
  definition?: { description?: string; threeLetterAcronym?: string; id?: string }
  engineHours?: { reading?: { valueAsDouble?: number } }
}

/**
 * Machine alerts — Deere's own diagnostic trouble codes, with plain-English
 * descriptions ("Right turn signal circuit fault. - Check bulb.").
 *
 * These are what the machine is actually reporting, which matters more than a
 * generic interval: this is the maintenance signal Deere will give us, since the
 * recommended-plan endpoints are forbidden to this app.
 */
async function machineAlerts(token: string, jdId: string): Promise<MachineAlert[]> {
  try {
    const body = await jdGet<{ values?: MachineAlert[] }>(
      token,
      `/platform/machines/${jdId}/alerts`,
    )
    return body.values ?? []
  } catch {
    return []
  }
}

// What the maintenance probe found, on 2026-08-11, recorded in jd_api_probes:
//   engineHours / hoursOfOperation / alerts on /platform/machines/{isgId}  OK
//   /platform/organizations/{org}/machines                                 403
//   /platform/organizations/{org}/maintenancePlans                         403
//   /platform/machines/{id}/maintenancePlans                               403
//   /isg/maintenancePlans, /isg/maintenance, /isg/equipment/{id}/plans     404
// So Deere's recommended plans are not available to this app; service intervals
// are Prairie Creek's own. The probe itself has served its purpose and is gone.

export async function runJdEquipmentSync(sb: SupabaseClient): Promise<EquipmentSyncResult> {
  const { data: acct } = await sb
    .from('integration_accounts')
    .select('external_org_id')
    .eq('provider', 'john_deere')
    .single()
  const org = acct?.external_org_id as string | null
  if (!org) return { ok: false, equipment: 0, withHours: 0, detail: 'No organization selected' }

  const token = await jdAccessToken(sb)
  const now = new Date().toISOString()

  const list = await listAll<EquipmentRecord>(token, `/isg/equipment?organizationIds=${org}`)
  const usable = list.filter((e) => e.id)

  // Telematics uses a different id from the equipment inventory, and there is no
  // endpoint we may call that maps between them —
  // /platform/organizations/{org}/machines is 403 for this app.
  //
  // The link is already in our own data: field operations record both the
  // machine's telematics id and its VIN, and the equipment inventory records
  // that same number as the serial. Joining on it resolves the sprayer (ISG
  // 1000001 -> 200001) and the 8R 250 (1000002 -> 200002). The 9560 works
  // either way because its two ids happen to be identical, which is exactly what
  // made the earlier "the ISG id IS the machine id" reading look right.
  const { data: opsRows } = await sb
    .from('jd_field_operations')
    .select('raw')
    .not('machine_vin', 'is', null)
  const telematicsIdByVin = new Map<string, string>()
  for (const r of opsRows ?? []) {
    const machines = (r.raw as { fieldOperationMachines?: { vin?: string; machineId?: number }[] })
      ?.fieldOperationMachines
    for (const m of machines ?? []) {
      if (m.vin && m.machineId != null) {
        telematicsIdByVin.set(m.vin.trim().toUpperCase(), String(m.machineId))
      }
    }
  }

  // Only machines carry a modem, so implements are never asked — ~57 pointless
  // requests a sync avoided, and an implement's empty answer was never evidence
  // of a fault.
  let withHours = 0
  let alertCount = 0
  const rows = []
  const alertRows: Record<string, unknown>[] = []
  for (const e of usable) {
    const isMachine = (e['@type'] ?? '').toLowerCase() === 'machine'
    const telematicsId =
      (e.serialNumber ? telematicsIdByVin.get(e.serialNumber.trim().toUpperCase()) : undefined) ??
      // The ISG id works when the two spaces coincide, as they do for the 9560.
      (isMachine ? e.id : undefined)
    const canReport = isMachine && !e.archived && Boolean(telematicsId)

    const hours = canReport ? await engineHours(token, telematicsId!) : null
    if (hours) withHours++

    if (canReport) {
      for (const a of await machineAlerts(token, telematicsId!)) {
        if (!a.id) continue
        alertCount++
        alertRows.push({
          jd_id: a.id,
          equipment_jd_id: e.id!,
          occurred_at: a.time ?? null,
          severity: a.severity ?? null,
          color: a.color ?? null,
          description: a.definition?.description ?? null,
          code: a.definition?.threeLetterAcronym ?? null,
          engine_hours: a.engineHours?.reading?.valueAsDouble ?? null,
          acknowledged: (a.acknowledgementStatus ?? '').toLowerCase() === 'acknowledged',
          ignored: Boolean(a.ignored),
          raw: a as unknown as Record<string, unknown>,
          synced_at: now,
        })
      }
    }

    rows.push({
      jd_id: e.id!,
      platform_machine_id: telematicsId ?? null,
      name: e.name ?? null,
      // The category lives in @type ("Machine" / "Implement"); there is no
      // `category` field, which is why the first import left it blank on all 84.
      category: (e['@type'] ?? pickName(e.category) ?? 'other').toLowerCase(),
      make: pickName(e.make),
      model: pickName(e.model),
      equipment_type: pickName(e.equipmentType ?? e.type),
      serial_number: e.serialNumber ?? null,
      // ISG equipment records carry no VIN. The VINs we hold come from field
      // operations, which is genuinely a separate id space.
      vin: e.vin ?? null,
      engine_hours: hours?.hours ?? null,
      engine_hours_at: hours?.at ?? null,
      archived: Boolean(e.archived),
      raw: e as unknown as Record<string, unknown>,
      synced_at: now,
      updated_at: now,
    })
  }

  if (rows.length) {
    // Hand-added equipment is never touched: its jd_id is ours, not Deere's.
    const { error } = await sb.from('jd_equipment').upsert(rows, { onConflict: 'jd_id' })
    if (error) throw new Error(error.message)
  }

  if (alertRows.length) {
    const { error } = await sb
      .from('jd_equipment_alerts')
      .upsert(alertRows, { onConflict: 'jd_id' })
    if (error) throw new Error(error.message)
  }

  const detail =
    `${rows.length} machines and implements, ${withHours} reporting engine hours, ` +
    `${alertCount} alerts`
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'jd_equipment',
    p_detail: detail,
    p_data_at: null,
  })

  return { ok: true, equipment: rows.length, withHours, detail }
}
