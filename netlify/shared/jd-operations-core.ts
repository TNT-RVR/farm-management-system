import type { SupabaseClient } from '@supabase/supabase-js'
import { checkNewSprays } from './spray-rotation-check.ts'
import { seasonFor } from '../../src/lib/jd-season.ts'
import { jdAccessToken, jdGet } from '../functions/_jd.mts'
import { backfillConditions } from './jd-conditions.ts'
import { syncPlantingDates } from './jd-planting-dates.ts'
import { rowChanged } from './row-diff.ts'

// Pulls completed field work (and the operator list) from Operations Center.
// Shapes confirmed against the live org on 2026-08-07 — see the migration for
// the sampled payload.

type Link = { rel?: string; uri?: string }
type Rate = { value?: number; unitId?: string }
type Component = { name?: string; rate?: Rate; productType?: string; guid?: string }
type Product = {
  name?: string
  tankMix?: boolean
  rate?: Rate
  carrier?: Component
  components?: Component[]
}
type Operator = { name?: string; operatorId?: string }
type Machine = { vin?: string; machineId?: number; operators?: Operator[] }
type FieldOperation = {
  id?: string
  fieldOperationType?: string
  cropSeason?: string
  startDate?: string
  endDate?: string
  treatedCropName?: string
  products?: Product[]
  fieldOperationMachines?: Machine[]
  links?: Link[]
}

export type OpsSyncResult = {
  ok: boolean
  fields: number
  operations: number
  /** Passes new or changed since the last run (the only ones written). */
  written: number
  operators: number
  plantingDates: number
  detail: string
}

// The columns the sync writes, bar synced_at (stamped on written rows only;
// the run's own time is the jd_field_ops heartbeat).
const OP_COLUMNS = ['field_id', 'operation_type', 'crop_season', 'started_at', 'ended_at', 'treated_crop', 'operator_name', 'operator_jd_id', 'machine_id', 'machine_vin', 'products', 'raw'] as const

/** A pass is written when it is new or Deere's copy differs from the stored one. */
function opChanged(next: Record<string, unknown>, stored: Record<string, unknown> | undefined): boolean {
  // A hand correction replaces products on every write (fn_apply_product_correction),
  // so the stored products are the correction's, not Deere's: compare the rest.
  const cols = stored?.products_corrected != null ? OP_COLUMNS.filter((c) => c !== 'products') : OP_COLUMNS
  return rowChanged(
    next,
    stored,
    cols.filter((c) => c !== 'started_at' && c !== 'ended_at'),
    ['started_at', 'ended_at'],
  )
}

/** Page through a Deere list endpoint. */
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

export async function runJdOperationsSync(sb: SupabaseClient): Promise<OpsSyncResult> {
  const { data: acct } = await sb
    .from('integration_accounts')
    .select('external_org_id')
    .eq('provider', 'john_deere')
    .single()
  const org = acct?.external_org_id as string | null
  if (!org)
    return { ok: false, fields: 0, operations: 0, written: 0, operators: 0, plantingDates: 0, detail: 'No organization selected' }

  const token = await jdAccessToken(sb)
  const now = new Date().toISOString()

  // Operators first, so an operation can carry a name we already know.
  let operatorCount = 0
  try {
    const ops = await listAll<{ id?: string; name?: string; archived?: boolean }>(
      token,
      `/platform/organizations/${org}/operators`,
    )
    const rows = ops
      .filter((o) => o.id && o.name)
      .map((o) => ({ jd_id: o.id!, name: o.name!, archived: Boolean(o.archived), synced_at: now }))
    if (rows.length) {
      // Never clobber a user_id an admin has mapped by hand.
      await sb.from('jd_operators').upsert(rows, { onConflict: 'jd_id', ignoreDuplicates: false })
      operatorCount = rows.length
    }
  } catch {
    // Operators are a nicety; a failure here must not stop the operations sync.
  }

  // Only fields we've linked to Deere — the rest have no operations to fetch.
  const { data: fields } = await sb
    .from('fields')
    .select('id, jd_field_id')
    .not('jd_field_id', 'is', null)
  const linked = fields ?? []

  // Passes a manager has deleted stay deleted; the headstones say which.
  const { data: dismissedRows } = await sb.from('jd_dismissed_operations').select('jd_id')
  const dismissed = new Set((dismissedRows ?? []).map((d) => d.jd_id as string))

  let operations = 0
  let written = 0
  let failures = 0
  for (const f of linked) {
    try {
      const list = await listAll<FieldOperation>(
        token,
        `/platform/organizations/${org}/fields/${f.jd_field_id}/fieldOperations`,
        5,
      )
      // What is already stored for the field, so only new or changed passes
      // are written: re-upserting every pass every hour rewrote the whole
      // season (raw JSON and all) to change nothing.
      const { data: storedRows, error: readErr } = await sb
        .from('jd_field_operations')
        .select('jd_id, field_id, operation_type, crop_season, started_at, ended_at, treated_crop, operator_name, operator_jd_id, machine_id, machine_vin, products, raw, products_corrected')
        .eq('field_id', f.id as string)
      if (readErr) throw new Error(readErr.message)
      const stored = new Map((storedRows ?? []).map((r) => [r.jd_id as string, r as Record<string, unknown>]))
      const rows = list
        .filter((o) => o.id && !dismissed.has(o.id))
        .map((o) => {
          const machine = o.fieldOperationMachines?.[0]
          const operator = machine?.operators?.[0]
          return {
            jd_id: o.id!,
            field_id: f.id as string,
            operation_type: o.fieldOperationType ?? null,
            // Deere's season is whatever the display was set to; an impossible
            // one is corrected to the year of the work (jd-season.ts).
            crop_season: seasonFor(o.cropSeason, o.startDate),
            started_at: o.startDate ?? null,
            ended_at: o.endDate ?? null,
            treated_crop: o.treatedCropName ?? null,
            operator_name: operator?.name ?? null,
            operator_jd_id: operator?.operatorId ?? null,
            machine_id: machine?.machineId != null ? String(machine.machineId) : null,
            machine_vin: machine?.vin ?? null,
            products: o.products ?? [],
            raw: o as unknown as Record<string, unknown>,
            synced_at: now,
          }
        })
      operations += rows.length
      const changed = rows.filter((r) => opChanged(r, stored.get(r.jd_id)))
      if (changed.length) {
        const { error } = await sb
          .from('jd_field_operations')
          .upsert(changed, { onConflict: 'jd_id' })
        if (error) throw new Error(error.message)
        written += changed.length
      }
    } catch {
      failures++
    }
  }

  // Both passes look only at the operations, so a run that wrote none has
  // nothing new for them.
  if (written > 0) {
    // A job typed into Operations Center by hand as well as logged by the
    // sprayer arrives twice; the copy is flagged so nothing counts it again.
    const { error: dupErr } = await sb.rpc('fn_flag_duplicate_operations')
    if (dupErr) console.warn('[jd-operations] duplicate flagging failed: ' + dupErr.message)
    // Then: hand entries with nothing logged wait for a yes/no, and passes on
    // a rented-out field or a renter's crop are marked not our cost.
    const { error: clsErr } = await sb.rpc('fn_classify_operations')
    if (clsErr) console.warn('[jd-operations] classification failed: ' + clsErr.message)
  }

  // New sprays against the crops planned on those fields: a label that rules
  // one out tells the managers now, not at planting.
  try {
    const r = await checkNewSprays(sb)
    if (r.flagged) console.log(`[jd-operations] ${r.flagged} rotation conflict(s) from ${r.checked} new spray(s)`)
  } catch (e) {
    console.warn('[jd-operations] rotation check failed: ' + (e as Error).message)
  }

  // Planting dates are derived from the seeding rows just upserted, so this runs
  // inside the operations sync rather than on a schedule of its own: a seeding
  // pass closed in the cab reaches the AIMM stage clock in the same run that
  // recorded it, with no second job to keep in step.
  let planting = 0
  let plantingDetail = ''
  try {
    const p = await syncPlantingDates(sb)
    planting = p.written
    plantingDetail = p.detail
  } catch {
    // Never fail an operations sync over the dates derived from it.
  }

  // Conditions come after the operations, and only for passes that have none:
  // each is up to four extra requests, so they are drip-fed rather than fetched
  // for a whole season at once.
  let conditions = { filled: 0, withWind: 0 }
  try {
    conditions = await backfillConditions(sb, token)
  } catch {
    // Never fail an operations sync over the weather on it.
  }

  const detail =
    `${operations} operations across ${linked.length} linked fields (${written} new or changed)` +
    (conditions.filled ? ` · conditions on ${conditions.filled} (${conditions.withWind} with wind)` : '') +
    (planting ? ` · ${planting} planting date(s) → AIMM` : '') +
    (failures ? ` · ${failures} field(s) failed` : '')

  await sb.rpc('record_integration_heartbeat', {
    p_key: 'jd_field_ops',
    p_detail: detail,
    p_data_at: null,
  })

  return {
    ok: failures < linked.length,
    fields: linked.length,
    operations,
    written,
    operators: operatorCount,
    plantingDates: planting,
    detail: detail + (plantingDetail ? ` [planting: ${plantingDetail}]` : ''),
  }
}
