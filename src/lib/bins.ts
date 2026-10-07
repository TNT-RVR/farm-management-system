import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { CropPlanRow, CropRow } from './queries'

export type BinRow = Database['public']['Tables']['bins']['Row']
export type BinAllocationRow = Database['public']['Tables']['bin_allocations']['Row']

/** Convert a crop's planned production to bushels using its test weight. */
export function productionToBushels(
  crop: CropRow,
  totalInCropUnit: number,
): { bushels: number | null; note?: string } {
  switch (crop.yield_unit) {
    case 'bu':
      return { bushels: totalInCropUnit }
    case 'lbs':
      if (!crop.test_weight_lb_per_bu)
        return { bushels: null, note: 'no test weight — set one on the crop to estimate bins' }
      return { bushels: totalInCropUnit / crop.test_weight_lb_per_bu }
    default:
      // cwt / ton / MT / ac aren't stored in grain bins
      return { bushels: null, note: `${crop.yield_unit} not stored in grain bins` }
  }
}

/** One year's departure from a crop's own bin setting. */
export type CropBinOverride = {
  crop_id: string
  needs_bins: boolean | null
  stored_bu: number | null
  note: string | null
}

export type BinEstimateLine = {
  /** False where the crop never enters a bin; its line is informational only. */
  needsBins: boolean
  /** True where this year's figure came from an override, not the crop default. */
  overridden: boolean
  /** Bushels this year's override says need a bin, or null for all of it. */
  storedBu: number | null
  crop: CropRow
  fieldCount: number
  /** The fields this crop is planned on, for "which ones?" */
  fieldIds: string[]
  /** What the crop is expected to make, before any part-of-it override. */
  estimatedBu: number | null
  productionBu: number | null
  policy: CropRow['bin_policy']
  allocatedBins: number
  allocatedCapacityBu: number
  neededBins: number | null // segregated policies
  shortfallBins: number | null
  shortfallBu: number | null // mixable
  summary: string
  note?: string
}

/**
 * Bin estimator (SPEC §6). Per crop with a plan:
 *  - mixable: production bushels vs allocated bin capacity → shortfall in bu + bins
 *  - segregate_by_field: one bin per planted field, regardless of volume
 *  - segregate_by_variety: one bin per variety
 */
/**
 * How many bins a set of segregated fields takes, out of the bins you have.
 *
 * ONE SHARED POOL, not a sum of independent answers. Sizing each field against
 * the whole yard separately lets all three canola fields "use" the same pair of
 * 5,800 bushel fertiliser bins and reports five bins where six are needed —
 * which is the same class of error as counting one bin per field, just quieter.
 * Bins are consumed as they are assigned.
 *
 * BIGGEST FIELD FIRST, because otherwise a 60 acre field takes a 5,800 bushel
 * bin and the 140 acre field behind it is left splitting across three small
 * ones.
 *
 * And for each field, the LAST bin is the smallest one the remainder fits in,
 * not the biggest available. Moreaus' 9,800 bushels is 5,800 + 4,000, not two
 * 5,800s: taking the largest every time burns the big bins on remainders and is
 * not what anybody does in the yard.
 *
 * Fields with no yield are left out rather than counted as one bin — a zero is
 * a missing yield or a missing boundary, and "1 bin" hides that behind a
 * plausible number.
 */
export type FieldNeed = { fieldId: string; bushels: number | null }

export function planBinsForFields(
  needs: FieldNeed[],
  sizes: number[],
): { total: number; perField: Map<string, number> } {
  const perField = new Map<string, number>()
  const pool = [...sizes].filter((c) => c > 0).sort((a, b) => a - b)
  const largest = pool.length ? pool[pool.length - 1] : 0

  const sized = needs
    .filter((n) => n.bushels != null && Number.isFinite(n.bushels) && n.bushels > 0)
    .sort((a, b) => (b.bushels as number) - (a.bushels as number))

  let total = 0
  for (const n of sized) {
    let left = n.bushels as number
    let bins = 0
    while (left > 0) {
      if (!pool.length) {
        // Out of bins. Still an honest number: this is storage the farm does
        // not have, which is the answer the page is being asked for.
        bins += largest > 0 ? Math.ceil(left / largest) : 1
        break
      }
      // The smallest bin the rest of the field fits in, if there is one.
      const fits = pool.findIndex((c) => c >= left)
      const take = fits >= 0 ? pool.splice(fits, 1)[0] : (pool.pop() as number)
      left -= take
      bins++
    }
    perField.set(n.fieldId, bins)
    total += bins
  }
  return { total, perField }
}

/**
 * A season's plans with split fields broken into their crop areas.
 *
 * A field split on the map (Whitfield: corn on 31 ac, potatoes on the rest) has
 * one plan row naming one crop, and counting that row would put the whole
 * field down as that crop. Each crop area stands in for the plan instead, as
 * its own crop and acres — at the plan's yield where it is the plan's crop,
 * and the crop's default yield otherwise.
 */
export function plansWithZones<P extends { field_id: string; crop_id: string; crop_year: number; planned_acres: number | null; yield_per_acre_override: number | null }>(
  plans: P[],
  zones: { id: string; field_id: string; crop_year: number; crop_id: string; acres: number | string | null }[],
  cropYear: number,
): P[] {
  const byField = new Map<string, typeof zones>()
  for (const z of zones) {
    if (z.crop_year !== cropYear) continue
    const list = byField.get(z.field_id) ?? []
    list.push(z)
    byField.set(z.field_id, list)
  }
  const out: P[] = []
  for (const p of plans) {
    const zs = byField.get(p.field_id)
    if (!zs?.length) {
      out.push(p)
      continue
    }
    for (const z of zs) {
      out.push({
        ...p,
        id: `zone:${z.id}`,
        crop_id: z.crop_id,
        planned_acres: z.acres == null ? null : Number(z.acres),
        // The area growing the plan's own crop keeps the plan's yield.
        yield_per_acre_override: z.crop_id === p.crop_id ? p.yield_per_acre_override : null,
      })
    }
  }
  return out
}

export function estimateBins(
  crops: CropRow[],
  plans: CropPlanRow[],
  bins: BinRow[],
  allocations: BinAllocationRow[],
  acresFor: (fieldId: string) => number | null,
  /** This year's per-crop overrides, keyed by crop id. Optional. */
  overrideByCrop?: Map<string, CropBinOverride>,
  /**
   * Bins with something already in them — last year's durum in #2, say.
   *
   * Excluded from the ladder this year's crop is sized against, because a bin
   * that is full is not storage you have. It is NOT excluded from allocated
   * capacity: an allocation onto an occupied bin is still an allocation, and
   * hiding it would turn a conflict somebody should see into a silent one.
   */
  occupiedBinIds?: Set<string>,
): BinEstimateLine[] {
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const activeBins = bins.filter((b) => b.active)
  const capById = new Map(activeBins.map((b) => [b.id, b.capacity_bu]))
  const avgCapacity =
    activeBins.length > 0
      ? activeBins.reduce((s, b) => s + b.capacity_bu, 0) / activeBins.length
      : 0
  // Largest first, so sizing a field walks the real yard rather than an
  // average. The yard is not uniform — 4,000 bushel grain bins, a pair of
  // 5,800 bushel fertiliser bins, and some 400s — and an average of them all
  // describes no bin that exists.
  const binSizes = activeBins
    .filter((b) => !occupiedBinIds?.has(b.id))
    .map((b) => b.capacity_bu)
    .filter((c) => c > 0)
    .sort((a, b) => b - a)

  // group plans by crop
  const plansByCrop = new Map<string, CropPlanRow[]>()
  for (const p of plans) {
    const list = plansByCrop.get(p.crop_id) ?? []
    list.push(p)
    plansByCrop.set(p.crop_id, list)
  }

  const lines: BinEstimateLine[] = []
  for (const [cropId, cropPlans] of plansByCrop) {
    const crop = cropById.get(cropId)
    if (!crop) continue
    // An archived crop is one somebody has retired. Its plans stay on the books
    // for the year they were made — deleting them would rewrite history — but
    // it has no place in a list of what needs a bin this season. Summer Fallow
    // is the case that prompted this: retired, still carrying plans, and
    // needing no storage by definition.
    if (crop.active === false) continue

    // The crop setting is the default; this year's override wins where it
    // exists. Only an explicit true or false overrides — null means nobody said
    // anything about this year, not "no".
    const ov = overrideByCrop?.get(cropId)
    const binned = ov?.needs_bins ?? crop.needs_bins !== false

    // A crop that never enters a bin is not a storage problem. Counting alfalfa
    // tonnage, or potatoes that leave on a truck from the field, against bin
    // capacity makes the farm look short of storage it does not need — which is
    // the one number this page exists to get right. Kept as a LINE so it is
    // visible and can be toggled back, rather than vanishing from the list.
    if (!binned) {
      lines.push({
        crop,
        fieldCount: new Set(cropPlans.map((p) => p.field_id)).size,
        fieldIds: [...new Set(cropPlans.map((p) => p.field_id))],
        estimatedBu: null,
        productionBu: 0,
        policy: crop.bin_policy,
        allocatedBins: 0,
        allocatedCapacityBu: 0,
        neededBins: 0,
        shortfallBins: 0,
        shortfallBu: 0,
        summary:
          ov?.needs_bins === false
            ? `Not binned this year${ov.note ? ` — ${ov.note}` : ''}.`
            : 'Not stored in bins — baled or shipped direct from the field.',
        note: undefined,
        needsBins: false,
        overridden: ov?.needs_bins === false,
        storedBu: null,
      })
      continue
    }

    const alloc = allocations.filter((a) => a.crop_id === cropId)
    const allocatedBins = alloc.length
    const allocatedCapacityBu = alloc.reduce((s, a) => s + (capById.get(a.bin_id) ?? 0), 0)
    const fieldCount = new Set(cropPlans.map((p) => p.field_id)).size

    const totalInUnit = cropPlans.reduce((s, p) => {
      const acres = p.planned_acres ?? acresFor(p.field_id) ?? 0
      const y = p.yield_per_acre_override ?? crop.default_yield_per_acre ?? 0
      return s + acres * y
    }, 0)
    const conv = productionToBushels(crop, totalInUnit)
    // What has to FIT IN A BIN, which is not the same as what is grown. Where
    // only part of the corn is binned and the rest goes straight to the plant,
    // sizing storage against the whole crop invents a shortfall.
    const storedBu = ov?.stored_bu == null ? null : Number(ov.stored_bu)
    const productionBu = storedBu ?? conv.bushels
    const note = conv.note

    let neededBins: number | null = null
    let shortfallBins: number | null = null
    let shortfallBu: number | null = null
    let summary: string

    if (crop.bin_policy === 'segregate_by_field') {
      // ONE BIN PER FIELD IS A FLOOR, NOT AN ANSWER, and reporting it as the
      // answer was wrong on exactly the fields that matter. Moreaus makes about
      // 9,800 bushels of canola against 4,000 bushel bins: it needs three, and
      // the old line said one. Keeping fields apart means no bin holds two
      // fields — it says nothing about a field fitting in one bin.
      //
      // So each field is sized on its own and the counts are added. A field
      // cannot borrow space from another field's bin, which is the whole point
      // of the policy, so summing per field is the correct arithmetic rather
      // than a conservative one.
      const needs = cropPlans.map((p) => {
        const acres = p.planned_acres ?? acresFor(p.field_id) ?? 0
        const y = p.yield_per_acre_override ?? crop.default_yield_per_acre ?? 0
        return { fieldId: p.field_id, bushels: productionToBushels(crop, acres * y).bushels }
      })
      const plan = planBinsForFields(needs, binSizes)
      // A field nobody could size still needs somewhere to go, so it counts as
      // one rather than disappearing out of the total.
      const unsized = needs.length - plan.perField.size
      neededBins = plan.total + unsized
      shortfallBins = Math.max(0, neededBins - allocatedBins)

      // Named where it is more than one, because "7 bins for 3 fields" invites
      // the reader to think something has gone wrong with the arithmetic.
      const counts = [...plan.perField.values()]
      const splits = counts.filter((n) => n > 1).length
      const biggest = counts.length ? Math.max(...counts) : 1
      const detail =
        splits > 0
          ? ` ${splits === 1 ? 'One field needs' : `${splits} fields need`} more than one bin${biggest > 1 ? ` — the largest takes ${biggest}` : ''}.`
          : ''
      summary =
        shortfallBins > 0
          ? `${neededBins} bins for ${fieldCount} fields kept apart, ${allocatedBins} allocated. Short ${shortfallBins}.${detail}`
          : `${allocatedBins} bins allocated across ${fieldCount} fields, none shared. Covered.${detail}`
    } else if (crop.bin_policy === 'segregate_by_variety') {
      const varieties = new Set(cropPlans.map((p) => p.variety ?? '—')).size
      neededBins = varieties
      shortfallBins = Math.max(0, neededBins - allocatedBins)
      summary =
        shortfallBins > 0
          ? `Needs ${neededBins} bins for ${varieties} varieties, ${allocatedBins} allocated. Short ${shortfallBins}.`
          : `${neededBins} bins for ${varieties} varieties — covered.`
    } else {
      // mixable
      if (productionBu == null) {
        summary = note ?? 'Not bin-stored.'
      } else {
        shortfallBu = Math.max(0, productionBu - allocatedCapacityBu)
        shortfallBins = avgCapacity > 0 ? Math.ceil(shortfallBu / avgCapacity) : null
        summary =
          shortfallBu > 0
            ? `${Math.round(productionBu).toLocaleString()} bu vs ${Math.round(allocatedCapacityBu).toLocaleString()} bu allocated — short ${Math.round(shortfallBu).toLocaleString()} bu${shortfallBins != null ? ` (~${shortfallBins} bins)` : ''}.`
            : `${Math.round(productionBu).toLocaleString()} bu vs ${Math.round(allocatedCapacityBu).toLocaleString()} bu allocated — covered.`
      }
    }

    lines.push({
      crop,
      fieldCount,
      fieldIds: [...new Set(cropPlans.map((p) => p.field_id))],
      estimatedBu: conv.bushels,
      productionBu,
      policy: crop.bin_policy,
      allocatedBins,
      allocatedCapacityBu,
      neededBins,
      shortfallBins,
      shortfallBu,
      summary,
      note,
      needsBins: true,
      overridden: storedBu != null,
      storedBu,
    })
  }
  return lines.sort((a, b) => a.crop.name.localeCompare(b.crop.name))
}

/** Just enough of a bin to sort a yard list. */
type Placeable = { name: string; site: string | null }

/** #2 before #10. A plain name sort puts #10, #11, #12 ahead of #2. */
export function binNumber(name: string): number {
  const m = name.match(/#\s*(\d+)/)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

export function byYardThenNumber(a: Placeable, b: Placeable): number {
  const site = (a.site ?? '').localeCompare(b.site ?? '')
  if (site !== 0) return site
  const n = binNumber(a.name) - binNumber(b.name)
  return n !== 0 ? n : a.name.localeCompare(b.name)
}

/**
 * What is actually in each bin right now, from the grain movements ledger.
 *
 * Separate from allocations: an allocation is a plan for the year ("#7 is for
 * the pinto beans"), on-hand is the running total of what has been augered in
 * and hauled out. The bin drawing needs the second one — a fill line drawn from
 * a plan would show every bin full on the first of May.
 */
export type BinOnHand = { bin_id: string; crop_id: string | null; onhand_bu: number }

export function useBinOnHand() {
  return useQuery({
    queryKey: ['bins', 'onhand'],
    queryFn: async (): Promise<BinOnHand[]> => {
      const { data, error } = await supabase.from('bin_grain_onhand').select('*')
      if (error) throw error
      return (data ?? []).map((r) => ({
        bin_id: String(r.bin_id),
        crop_id: r.crop_id == null ? null : String(r.crop_id),
        onhand_bu: Number(r.onhand_bu) || 0,
      }))
    },
  })
}

export function binsQuery() {
  return {
    queryKey: ['bins'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bins').select('*')
      if (error) throw error
      // Sorted here rather than by the database, because the order wanted is
      // #1, #2, #3 and a name sort gives #1, #10, #11, #12, #2. Doing it in the
      // query means every screen that reads bins — the yard list, the moisture
      // tester's bin picker, the air alerts — agrees without each remembering.
      return [...data].sort(byYardThenNumber)
    },
  }
}

export function useBins() {
  return useQuery(binsQuery())
}

export function useBinAllocations(cropYear: number) {
  return useQuery({
    queryKey: ['bin_allocations', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bin_allocations')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data
    },
  })
}

export function useBinMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['bins'] })
  const create = useMutation({
    mutationFn: async (bin: Database['public']['Tables']['bins']['Insert']) => {
      const { error } = await supabase.from('bins').insert(bin)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['bins']['Update']
    }) => {
      const { error } = await supabase.from('bins').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bins').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function useAllocationMutations(cropYear: number) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['bin_allocations', cropYear] })
  const upsert = useMutation({
    mutationFn: async (alloc: Database['public']['Tables']['bin_allocations']['Insert']) => {
      const { error } = await supabase
        .from('bin_allocations')
        .upsert(alloc, { onConflict: 'crop_year,bin_id' })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async ({ binId }: { binId: string }) => {
      const { error } = await supabase
        .from('bin_allocations')
        .delete()
        .eq('crop_year', cropYear)
        .eq('bin_id', binId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { upsert, remove }
}

/**
 * Whether a crop is stored in bins at all.
 *
 * Lives with the bin code rather than crop settings because this is where the
 * question gets asked — somebody looking at a storage shortfall wants to strike
 * the alfalfa off it there and then, not go hunting through settings.
 */
/** The bin policy is a fact about the crop, so it is edited wherever it shows. */
export function useSetCropBinPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, bin_policy }: { id: string; bin_policy: CropRow['bin_policy'] }) => {
      const { error } = await supabase.from('crops').update({ bin_policy }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crops'] }),
  })
}

export function useSetCropNeedsBins() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, needs_bins }: { id: string; needs_bins: boolean }) => {
      const { error } = await supabase.from('crops').update({ needs_bins }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      void qc.invalidateQueries({ queryKey: ['bins'] })
    },
  })
}

/** This year's overrides, and the means to set one. */
export function useCropBinOverrides(cropYear: number) {
  return useQuery({
    queryKey: ['crop_bin_overrides', cropYear],
    queryFn: async (): Promise<Map<string, CropBinOverride>> => {
      const { data, error } = await supabase
        .from('crop_bin_overrides')
        .select('crop_id, needs_bins, stored_bu, note')
        .eq('crop_year', cropYear)
      if (error) throw error
      const m = new Map<string, CropBinOverride>()
      for (const r of data ?? []) {
        const row = r as unknown as Record<string, unknown>
        m.set(String(row.crop_id), {
          crop_id: String(row.crop_id),
          needs_bins: (row.needs_bins as boolean | null) ?? null,
          stored_bu: row.stored_bu == null ? null : Number(row.stored_bu),
          note: (row.note as string) ?? null,
        })
      }
      return m
    },
  })
}

export function useSetCropBinOverride(cropYear: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      crop_id: string
      needs_bins?: boolean | null
      stored_bu?: number | null
      note?: string | null
    }) => {
      // An override that says nothing is not an override. Clearing both fields
      // deletes the row so the crop's own setting takes over again, rather than
      // leaving an empty record that reads as a deliberate choice.
      const empty = (v.needs_bins ?? null) === null && (v.stored_bu ?? null) === null && !v.note
      if (empty) {
        const { error } = await supabase
          .from('crop_bin_overrides')
          .delete()
          .eq('crop_year', cropYear)
          .eq('crop_id', v.crop_id)
        if (error) throw error
        return
      }
      const { error } = await supabase.from('crop_bin_overrides').upsert(
        {
          crop_year: cropYear,
          crop_id: v.crop_id,
          needs_bins: v.needs_bins ?? null,
          stored_bu: v.stored_bu ?? null,
          note: v.note ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'crop_year,crop_id' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crop_bin_overrides'] }),
  })
}
