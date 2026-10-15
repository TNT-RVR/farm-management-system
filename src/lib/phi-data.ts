import { supabase } from './supabase'
import { deereCropCode, phiDaysFor, type PhiApplication, type PhiRow } from './phi'

export type PhiSeason = { apps: PhiApplication[]; names: Map<string, string>; harvestStart: Map<string, string> }

/**
 * Every chemical sprayed in a season with its pre-harvest interval, and when
 * harvest began on each field: the first Deere harvest pass or the first load
 * weighed off the field, whichever is earlier. Read once for the Harvest
 * page's panel and the Reports page's clearance report, so the two agree.
 */
export async function loadPhiSeason(cropYear: number): Promise<PhiSeason> {
  const [apps, harvests, loads, plans, crops] = await Promise.all([
    supabase
      .from('product_applications')
      .select('field_id, field_name, applied_on, applied_name, product_id, operation_id')
      .eq('crop_season', cropYear),
    // The renter's crop is theirs to time; only our crops are checked. The
    // screens' row security hides duplicate and unconfirmed passes already;
    // said again so a report read any other way agrees.
    supabase
      .from('jd_field_operations')
      .select('id, field_id, started_at, operation_type, treated_crop')
      .eq('crop_season', cropYear)
      .is('not_ours', null)
      .is('duplicate_of', null)
      .or('confirm_status.is.null,confirm_status.eq.confirmed'),
    supabase.from('bin_loads').select('field_id, loaded_on').eq('crop_year', cropYear).not('field_id', 'is', null),
    supabase.from('crop_plans').select('field_id, crop_id').eq('crop_year', cropYear),
    supabase.from('crops').select('id, name'),
  ])
  for (const r of [apps, harvests, loads, plans, crops]) if (r.error) throw r.error
  const productIds = [...new Set((apps.data ?? []).map((a) => a.product_id).filter(Boolean))] as string[]
  const { data: products } = productIds.length
    ? await supabase.from('jd_products').select('id, pmra_registration, category').in('id', productIds)
    : { data: [] }
  const productById = new Map((products ?? []).map((p) => [p.id, p]))
  const regs = [...new Set((products ?? []).map((p) => p.pmra_registration).filter(Boolean))] as string[]
  const { data: rows } = regs.length
    ? await supabase.from('chemical_label_crops').select('registration_number, crop, preharvest_interval_days').in('registration_number', regs)
    : { data: [] }
  const rowsByReg = new Map<string, PhiRow[]>()
  for (const r of rows ?? []) rowsByReg.set(r.registration_number, [...(rowsByReg.get(r.registration_number) ?? []), r])

  const opById = new Map((harvests.data ?? []).map((o) => [o.id, o]))
  const cropName = new Map((crops.data ?? []).map((c) => [c.id, c.name]))
  const planCrop = new Map((plans.data ?? []).map((p) => [p.field_id, cropName.get(p.crop_id) ?? null]))
  const harvestStart = new Map<string, string>()
  const note = (fieldId: string | null, d: string | null | undefined) => {
    if (!fieldId || !d) return
    const day = d.slice(0, 10)
    const cur = harvestStart.get(fieldId)
    if (!cur || day < cur) harvestStart.set(fieldId, day)
  }
  for (const o of harvests.data ?? []) if (o.operation_type === 'harvest') note(o.field_id, o.started_at)
  for (const l of loads.data ?? []) note(l.field_id, l.loaded_on)

  const names = new Map<string, string>()
  const out: PhiApplication[] = []
  for (const a of apps.data ?? []) {
    if (!a.field_id || !a.applied_on) continue
    // A spray on the renter's crop, or a copy of a pass already counted.
    const op = opById.get(a.operation_id ?? '')
    if (!op) continue
    names.set(a.field_id, a.field_name ?? '')
    const p = a.product_id ? productById.get(a.product_id) : null
    // Fertilizer carries no PHI; a chemical with no registration on file is unknown.
    if (p?.category === 'fertilizer') continue
    const crop = op.treated_crop ?? deereCropCode(planCrop.get(a.field_id))
    const reg = p?.pmra_registration ?? null
    out.push({
      fieldId: a.field_id,
      product: a.applied_name ?? 'product',
      registration: reg,
      appliedOn: String(a.applied_on).slice(0, 10),
      phiDays: reg ? phiDaysFor(rowsByReg.get(reg) ?? [], crop) : null,
    })
  }
  return { apps: out, names, harvestStart }
}
