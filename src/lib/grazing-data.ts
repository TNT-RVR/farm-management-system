import type { SupabaseClient } from '@supabase/supabase-js'
import type { GrazingData, GrazingRule } from './grazing-restrictions'

/**
 * Everything grazingPicture needs, read with whichever client the caller has:
 * the screens' (row-level security hides duplicate and unconfirmed passes) or
 * the daily job's service client (which filters the same passes out itself).
 * From 1 January last year: a "not at all" on last season's crop runs until
 * this spring.
 */
export async function loadGrazingData(sb: SupabaseClient, today: string): Promise<GrazingData> {
  const year = Number(today.slice(0, 4))
  const since = `${year - 1}-01-01`

  /** Every row, a thousand at a time (PostgREST stops at a thousand). */
  async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(from, from + 999)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as T[]
      out.push(...rows)
      if (rows.length < 1000) break
    }
    return out
  }

  const [ops, products, aliases, rules, labels, crops, plans, history, fields, pastures, pastureSprays, overlaps, stubble, events] = await Promise.all([
    all<GrazingData['ops'][number]>((a, b) =>
      sb
        .from('jd_field_operations')
        .select('id, field_id, started_at, ended_at, products, treated_crop')
        .eq('operation_type', 'application')
        .gte('started_at', since)
        .is('duplicate_of', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('id')
        .range(a, b),
    ),
    all<GrazingData['products'][number]>((a, b) => sb.from('jd_products').select('id, name, pmra_registration').order('id').range(a, b)),
    all<GrazingData['aliases'][number]>((a, b) => sb.from('jd_product_aliases').select('deere_name, product_id, ignored').order('deere_name').range(a, b)),
    all<GrazingRule>((a, b) =>
      sb.from('chemical_grazing_rules').select('registration_number, crop, crop_key, kind, days, never, condition, quote').order('id').range(a, b),
    ),
    all<{ registration_number: string; grazing_rules_status: string | null }>((a, b) =>
      sb.from('chemical_labels').select('registration_number, grazing_rules_status').order('registration_number').range(a, b),
    ),
    all<GrazingData['crops'][number]>((a, b) => sb.from('crops').select('id, name, feed_dm_pct').order('id').range(a, b)),
    all<GrazingData['fieldCrops'][number]>((a, b) =>
      sb.from('crop_plans').select('field_id, crop_year, crop_id').gte('crop_year', year - 1).lte('crop_year', year + 1).order('id').range(a, b),
    ),
    all<GrazingData['fieldCrops'][number]>((a, b) =>
      sb.from('crop_history').select('field_id, crop_year, crop_id').gte('crop_year', year - 1).lte('crop_year', year).order('id').range(a, b),
    ),
    all<GrazingData['fields'][number]>((a, b) => sb.from('fields').select('id, name, grazed_after_harvest, open_to_pasture').order('name').range(a, b)),
    all<GrazingData['pastures'][number]>((a, b) => sb.from('pastures').select('id, name').order('name').range(a, b)),
    all<GrazingData['pastureSprays'][number]>((a, b) =>
      sb.from('pasture_sprays').select('id, pasture_id, applied_on, product, registration_number').gte('applied_on', since).order('id').range(a, b),
    ),
    all<GrazingData['overlaps'][number]>((a, b) =>
      sb.from('field_pasture_overlap').select('field_id, pasture_id, overlap_acres, field_acres').order('field_id').range(a, b),
    ),
    all<GrazingData['stubble'][number]>((a, b) => sb.from('stubble_grazing').select('id, field_id, name, start_date').order('id').range(a, b)),
    all<GrazingData['events'][number]>((a, b) =>
      sb
        .from('grazing_events')
        .select('id, pasture_id, turned_in_on, moved_out_on, head_count')
        .or(`moved_out_on.is.null,moved_out_on.gte.${since}`)
        .order('id')
        .range(a, b),
    ),
  ])

  // The plan is what the field holds this year; history fills the years
  // with no plan row (the plan for a past year is often gone).
  const planned = new Set(plans.map((p) => `${p.field_id}:${p.crop_year}`))
  return {
    ops,
    products,
    aliases,
    rules,
    // A plain object, not a Map: the screens' copy is persisted for offline use.
    labelStatus: Object.fromEntries(labels.map((l) => [l.registration_number, l.grazing_rules_status])),
    crops,
    fieldCrops: [...plans, ...history.filter((h) => !planned.has(`${h.field_id}:${h.crop_year}`))],
    fields,
    pastures,
    pastureSprays,
    overlaps,
    stubble,
    events,
  }
}
