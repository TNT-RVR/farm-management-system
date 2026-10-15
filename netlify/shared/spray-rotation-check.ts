import type { SupabaseClient } from '@supabase/supabase-js'
import { carryover, cropKey, type RecropRule } from '../../src/lib/rotation-engine.ts'
import { productResolver, sprayedProducts, type PriceBookAlias, type PriceBookProduct } from '../../src/lib/spray-products.ts'
import { MANAGER_ROLES } from '../functions/_jd.mts'

/**
 * Newly synced sprays checked against the crops already planned on the field
 * for the next two years. A label that rules one of them out (a crop it names,
 * or "do not plant" for everything else) tells the managers the same day —
 * while there is still time to change the plan, or the next pass's product.
 *
 * Each pass is read once (rotation_checked_at). Bioassay-only cautions stay on
 * the Rotation page; they are not worth a notification each.
 */
export async function checkNewSprays(sb: SupabaseClient): Promise<{ checked: number; flagged: number }> {
  const { data: ops } = await sb
    .from('jd_field_operations')
    .select('id, field_id, crop_season, started_at, products, fields(name)')
    .eq('operation_type', 'application')
    .is('rotation_checked_at', null)
    .is('duplicate_of', null)
    .limit(300)
  if (!ops?.length) return { checked: 0, flagged: 0 }

  const [{ data: products }, { data: aliases }, { data: rules }, { data: crops }] = await Promise.all([
    sb.from('jd_products').select('id, name, pmra_registration'),
    sb.from('jd_product_aliases').select('deere_name, product_id, ignored'),
    sb.from('chemical_recrop_rules').select('registration_number, crop_key, following_crop, months, status, condition, quote'),
    sb.from('crops').select('id, name'),
  ])
  const resolve = productResolver((products ?? []) as PriceBookProduct[], (aliases ?? []) as PriceBookAlias[])
  const rulesByReg = new Map<string, RecropRule[]>()
  for (const r of (rules ?? []) as RecropRule[]) rulesByReg.set(r.registration_number, [...(rulesByReg.get(r.registration_number) ?? []), r])
  const cropName = new Map((crops ?? []).map((c) => [c.id as string, c.name as string]))

  const lines: string[] = []
  for (const o of ops) {
    if (!o.field_id || !o.started_at) continue
    const on = String(o.started_at).slice(0, 10)
    const year = Number(on.slice(0, 4))
    const apps = []
    for (const hit of sprayedProducts(o.products, resolve)) {
      if (hit.registration && rulesByReg.has(hit.registration)) apps.push({ product: hit.product, registration: hit.registration, appliedOn: on })
    }
    if (!apps.length) continue
    const { data: plans } = await sb.from('crop_plans').select('crop_year, crop_id').eq('field_id', o.field_id).in('crop_year', [year + 1, year + 2])
    const field = (o.fields as { name?: string } | null)?.name ?? 'a field'
    for (const p of plans ?? []) {
      const crop = cropName.get(p.crop_id) ?? 'the planned crop'
      const hard = carryover(cropKey(crop), apps, rulesByReg, `${p.crop_year}-05-01`).filter((h) => h.block)
      for (const h of hard) lines.push(`${field}: ${crop} planned for ${p.crop_year} — ${h.message}`)
    }
  }

  await sb
    .from('jd_field_operations')
    .update({ rotation_checked_at: new Date().toISOString() })
    .in('id', ops.map((o) => o.id))

  if (lines.length) {
    const { data: managers } = await sb.from('users').select('id').in('role', MANAGER_ROLES).eq('active', true)
    const fields = [...new Set(lines.map((l) => l.split(':')[0]))]
    if (managers?.length)
      await sb.from('notifications').insert(
        managers.map((m) => ({
          user_id: m.id,
          kind: 'spray_rotation_conflict',
          title: `A spray rules out a planned crop on ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? '…' : ''}`,
          body: lines.slice(0, 6).join('\n'),
          link: '/rotation',
        })),
      )
  }
  return { checked: ops.length, flagged: lines.length }
}
