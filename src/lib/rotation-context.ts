import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fieldSalinity, useFieldSalinity } from './salinity'
import { cropKey, type CropInfo, type FieldApp, type FieldCtx, type FieldEconomics, type RecropRule, type ScoutFinding } from './rotation-engine'
import { contractMinimums, cropMargin, type MarginInputs } from './rotation-margins'
import { feedMinimums, type RanchFeed } from './feed-crops'
import { waterBudget } from './rotation-water'
import { fieldNeedResolver, useFieldNeedInputs } from './field-water-need-data'
import { dealFor, type LandDeal } from './land-deals'
import { BID_CODES } from './breakeven'
import { productResolver, sprayedProducts } from './spray-products'
import { asTrait, grownTrait, type CanolaYear } from './canola-trait'
import { companyLookup } from './crop-label'

const SANDY = /^(S|LS|SL|LFS|FS|FSL|LVFS|VFS|CS|LCS)$/i

/**
 * Everything the rotation engine needs about the farm that the planner does
 * not already load: which fields are irrigated and sandy, their topsoil EC,
 * every product sprayed on them in the last four seasons (resolved to its
 * PMRA registration through the price book), the labels' re-cropping rules,
 * the acre limits and the per-crop margins.
 */
export function useRotationContext(cropYear: number) {
  const { data: saltRows } = useFieldSalinity(true)
  const { data: needInputs } = useFieldNeedInputs()
  const q = useQuery({
    // Versioned: this query is persisted offline, and a restored copy of an
    // older shape (no history) crashed the Rotation view.
    queryKey: ['rotation-context', 'v17', cropYear],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const since = `${cropYear - 4}-01-01`
      const [pivots, soils, ops, products, aliases, rules, limits, crops, tenure, history, prices, contracts, inputs, series, licences, allotments, scouting, centroids, climate, leases, supply, feedPlans, herds, ration, harvests, bidSeries, varieties] = await Promise.all([
        supabase.from('field_pivots').select('field_id, acres_irrigated, alloted_inches, acre_feet_allotment, on_river, smrid_area, water_licence_id, water_source, fields(name)').eq('not_used', false),
        supabase.from('field_soil_units').select('field_id, texture_top, pct_of_field'),
        // Every spray, the renter's included: carryover is about the soil, not whose job it was.
        supabase
          .from('jd_field_operations')
          .select('field_id, started_at, products, not_ours')
          .eq('operation_type', 'application')
          .gte('started_at', since),
        supabase.from('jd_products').select('id, name, pmra_registration'),
        supabase.from('jd_product_aliases').select('deere_name, product_id, ignored'),
        supabase.from('chemical_recrop_rules').select('registration_number, crop_key, following_crop, months, status, condition, quote'),
        supabase.from('crop_acre_limits').select('id, crop_id, crop_group, crop_year, max_acres'),
        supabase.from('crops').select('id, name, min_return_years, margin_per_acre, margin_source, active, renter_only, yield_unit, default_yield_per_acre, irrigation_need_in, max_in_a_row, stand_min_years, stand_max_years, own_use, feed_dm_pct, test_weight_lb_per_bu, sister_value_per_acre, sister_value_note, herbicide_trait'),
        supabase.from('field_year_tenure').select('field_id, crop_year'),
        // Ten years back: return intervals and "years since" need more than the planner's two.
        supabase.from('crop_history').select('field_id, crop_year, crop_id, variety, yield_per_acre, yield_unit').gte('crop_year', cropYear - 10).lt('crop_year', cropYear),
        // For margins: target prices, contracts, input budgets, and the latest market price per crop.
        supabase.from('crop_prices').select('crop_id, crop_year, price_per_unit'),
        // A cancelled contract sets no minimum and no price; the planner skips it too.
        supabase.from('contracts').select('crop_id, crop_year, bushels, price_per_unit').gte('crop_year', cropYear).neq('status', 'cancelled'),
        supabase.from('crop_inputs').select('crop_id, crop_year, cost_per_acre, name').gte('crop_year', cropYear - 4),
        supabase.from('market_series').select('id, crop_id, commodity, unit, archived').not('crop_id', 'is', null),
        // For the water budget.
        supabase.from('water_licences').select('id, licence_number, volume'),
        supabase.from('water_allotments').select('year, inches, contract_inches, source').eq('source', 'smrid'),
        // For disease and pest carry-over.
        supabase.from('scouting_notes').select('field_id, crop_year, category, subject, severity').gte('crop_year', cropYear - 6),
        // The season ahead: heat units per weather cell, reservoirs, snow, SMRID notices.
        supabase.from('field_centroids').select('field_id, lat, lon'),
        supabase.from('field_climate').select('*'),
        supabase.from('land_leases').select('landlord, arrangement, field_ids, rent_per_acre, rent_total, our_share_pct, crop_share_pct, inputs_shared, active, start_date, end_date, direction, crop_ids'),
        supabase.from('water_supply').select('kind, station, name, feeds, observed_on, value, unit, pct_full, pct_full_last_year, pct_of_median, url').gte('observed_on', new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)).order('observed_on', { ascending: false }),
        supabase.from('feed_plans').select('*'),
        supabase.from('herd_counts').select('id, ranch_id, head_count, background_head, avg_weight_lb, feed_class, bcs, target_bcs, target_gain_lb'),
        supabase.from('feed_ration').select('id, ranch_id, crop_id, dm_share_pct'),
        // Expected yields: every yield on record (forecast.ts drops the planned ones).
        supabase.from('crop_history').select('field_id, crop_id, crop_year, acres, yield_per_acre, clean_yield_per_acre, yield_unit, source').not('yield_per_acre', 'is', null),
        // Today's elevator bids: barley, wheat, oats and durum are priced off them.
        supabase.from('market_series').select('id, code').in('code', BID_CODES),
        // The company behind a variety: a past "Canola" grown for BASF carries BASF's herbicide trait.
        supabase.from('crop_varieties').select('crop_id, name, company'),
      ])
      for (const r of [pivots, soils, ops, products, aliases, rules, limits, crops, tenure, history, prices, contracts, inputs, series, licences, allotments, scouting, centroids, climate, supply, leases, feedPlans, herds, ration, harvests, bidSeries, varieties]) if (r.error) throw r.error
      // The latest observation of each crop-linked series, from the last two years.
      const seriesIds = [...(series.data ?? []).filter((x) => !x.archived).map((x) => x.id as string), ...(bidSeries.data ?? []).map((x) => x.id as string)]
      const since2y = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10)
      const { data: obs, error: obsErr } = seriesIds.length
        ? await supabase.from('market_prices').select('series_id, observed_on, value').in('series_id', seriesIds).gte('observed_on', since2y).order('observed_on', { ascending: false })
        : { data: [], error: null }
      if (obsErr) throw obsErr
      const latest = new Map<string, { observed_on: string; value: number }>()
      for (const o of obs ?? []) if (!latest.has(o.series_id)) latest.set(o.series_id, { observed_on: o.observed_on, value: Number(o.value) })
      const bids = (bidSeries.data ?? []).flatMap((x) => {
        const l = latest.get(x.id)
        return l ? [[x.code as string, l.value] as [string, number]] : []
      })
      const market = (series.data ?? []).flatMap((x) => {
        const l = latest.get(x.id)
        return l ? [{ crop_id: x.crop_id as string, commodity: x.commodity as string | null, unit: x.unit as string | null, ...l }] : []
      })
      return {
        pivots: pivots.data ?? [],
        soils: soils.data ?? [],
        ops: ops.data ?? [],
        products: products.data ?? [],
        aliases: aliases.data ?? [],
        rules: (rules.data ?? []) as RecropRule[],
        limits: limits.data ?? [],
        crops: crops.data ?? [],
        tenure: tenure.data ?? [],
        history: history.data ?? [],
        prices: prices.data ?? [],
        contracts: contracts.data ?? [],
        inputs: inputs.data ?? [],
        market,
        bids,
        harvests: harvests.data ?? [],
        licences: licences.data ?? [],
        allotments: allotments.data ?? [],
        scouting: scouting.data ?? [],
        centroids: centroids.data ?? [],
        climate: climate.data ?? [],
        supply: supply.data ?? [],
        leases: leases.data ?? [],
        feedPlans: feedPlans.data ?? [],
        herds: herds.data ?? [],
        ration: ration.data ?? [],
        varieties: varieties.data ?? [],
      }
    },
  })

  return useMemo(() => {
    const d = q.data
    if (!d) return { loading: q.isLoading, ready: false as const }
    const irrigated = new Set(
      d.pivots
        .filter((p) => Number(p.acres_irrigated ?? 0) > 0 || p.on_river || p.smrid_area != null || p.water_licence_id || p.water_source)
        .map((p) => p.field_id as string),
    )
    const sandyShare = new Map<string, number>()
    for (const s of d.soils) {
      if (SANDY.test(String(s.texture_top ?? ''))) sandyShare.set(s.field_id, (sandyShare.get(s.field_id) ?? 0) + Number(s.pct_of_field ?? 0))
    }
    const salt = fieldSalinity(saltRows ?? [])
    // Deere name → PMRA registration, through the price book.
    const resolve = productResolver(d.products ?? [], d.aliases ?? [])
    const appsByField = new Map<string, FieldApp[]>()
    for (const o of d.ops) {
      if (!o.field_id || !o.started_at) continue
      const on = String(o.started_at).slice(0, 10)
      for (const hit of sprayedProducts(o.products, resolve)) {
        if (!hit.registration) continue
        const list = appsByField.get(o.field_id) ?? []
        if (!list.some((x) => x.registration === hit.registration && x.appliedOn === on)) list.push({ product: hit.product, registration: hit.registration, appliedOn: on })
        appsByField.set(o.field_id, list)
      }
    }
    const rulesByReg = new Map<string, RecropRule[]>()
    for (const r of d.rules) {
      const list = rulesByReg.get(r.registration_number) ?? []
      list.push(r)
      rulesByReg.set(r.registration_number, list)
    }
    const cropInfo: CropInfo[] = d.crops
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, name: c.name, key: cropKey(c.name), minReturn: c.min_return_years ?? 0, margin: c.margin_per_acre == null ? null : Number(c.margin_per_acre), renterOnly: Boolean(c.renter_only), waterNeedIn: c.irrigation_need_in == null ? null : Number(c.irrigation_need_in), maxInARow: c.max_in_a_row ?? 1, standMin: c.stand_min_years ?? null, standMax: c.stand_max_years ?? null, trait: asTrait(c.herbicide_trait) }))
    const rentedOut = new Set((d.tenure ?? []).map((t) => `${t.field_id}:${t.crop_year}`))
    /** Max acres for a crop in a year: the year's own limit, else the every-year one. */
    const maxFor = (cropId: string, year: number): number | null => {
      const y = (d.limits ?? []).find((l) => l.crop_id === cropId && l.crop_year === year)
      const any = (d.limits ?? []).find((l) => l.crop_id === cropId && l.crop_year == null)
      const v = y ?? any
      return v ? Number(v.max_acres) : null
    }
    /** Combined limits by group (all beans together) for a year. */
    const groupMaxFor = (year: number): Map<string, number> => {
      const m = new Map<string, number>()
      for (const l of (d.limits ?? []).filter((x) => x.crop_group && x.crop_year == null)) m.set(l.crop_group!, Number(l.max_acres))
      for (const l of (d.limits ?? []).filter((x) => x.crop_group && x.crop_year === year)) m.set(l.crop_group!, Number(l.max_acres))
      return m
    }
    const historyByField = new Map<string, Map<number, string[]>>()
    for (const h of d.history ?? []) {
      if (!h.crop_id) continue
      const m = historyByField.get(h.field_id) ?? new Map<number, string[]>()
      m.set(h.crop_year, [...(m.get(h.crop_year) ?? []), h.crop_id])
      historyByField.set(h.field_id, m)
    }
    // Each field's past canola with its herbicide trait: the crop's own, or
    // (plain "Canola") the trait of the company its variety names.
    const allCrops = d.crops ?? []
    const allCropsById = new Map(allCrops.map((c) => [c.id, c]))
    const companyOf = companyLookup(d.varieties ?? [])
    const historyCanola = new Map<string, Map<number, Map<string, CanolaYear>>>()
    for (const h of d.history ?? []) {
      if (!h.crop_id) continue
      const crop = allCropsById.get(h.crop_id)
      const t = grownTrait(crop, companyOf(h.crop_id, h.variety), allCrops)
      if (!crop || !t) continue
      const byYear = historyCanola.get(h.field_id) ?? new Map<number, Map<string, CanolaYear>>()
      const m = byYear.get(h.crop_year) ?? new Map<string, CanolaYear>()
      m.set(h.crop_id, { year: h.crop_year, crop: crop.name, trait: t.trait })
      byYear.set(h.crop_year, m)
      historyCanola.set(h.field_id, byYear)
    }
    /**
     * A field's canola record: history, overlaid year by year by what the
     * planner holds. A planned crop takes its own trait; one with none falls
     * back to what the history says about that crop that year.
     */
    const canolaYears = (fieldId: string, overlay: Map<number, Iterable<string>> = new Map()): CanolaYear[] => {
      const hist = historyCanola.get(fieldId) ?? new Map<number, Map<string, CanolaYear>>()
      const out: CanolaYear[] = []
      for (const y of new Set([...hist.keys(), ...overlay.keys()])) {
        const ids = overlay.get(y)
        if (!ids) {
          out.push(...hist.get(y)!.values())
          continue
        }
        for (const id of ids) {
          const crop = allCropsById.get(id)
          const own = asTrait(crop?.herbicide_trait)
          if (crop && own) out.push({ year: y, crop: crop.name, trait: own })
          else {
            const h = hist.get(y)?.get(id)
            if (h) out.push(h)
          }
        }
      }
      return out
    }
    // The winter feed plan, ranch by ranch, for the feed-crop minimums.
    const feedCrops = (d.crops ?? []).map((c) => ({ id: c.id, name: c.name, yield_unit: c.yield_unit, feed_dm_pct: c.feed_dm_pct, test_weight_lb_per_bu: c.test_weight_lb_per_bu }))
    const feedRanches: RanchFeed[] = (d.feedPlans ?? []).map((plan) => ({
      ranchId: plan.ranch_id,
      plan,
      herds: (d.herds ?? []).filter((h) => h.ranch_id === plan.ranch_id),
      ration: (d.ration ?? []).filter((r) => r.ranch_id === plan.ranch_id),
    }))
    // Margins from the farm's own yields, prices and costs.
    const marginInputs: MarginInputs = {
      crops: (d.crops ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        yield_unit: c.yield_unit ?? null,
        default_yield_per_acre: c.default_yield_per_acre == null ? null : Number(c.default_yield_per_acre),
        margin_per_acre: c.margin_per_acre == null ? null : Number(c.margin_per_acre),
        own_use: Boolean(c.own_use),
      })),
      history: (d.harvests ?? []).map((h) => ({
        ...h,
        acres: h.acres == null ? null : Number(h.acres),
        yield_per_acre: h.yield_per_acre == null ? null : Number(h.yield_per_acre),
        clean_yield_per_acre: h.clean_yield_per_acre == null ? null : Number(h.clean_yield_per_acre),
        yield_unit: h.yield_unit ?? null,
      })),
      prices: (d.prices ?? []).map((p) => ({ ...p, price_per_unit: p.price_per_unit == null ? null : Number(p.price_per_unit) })),
      contracts: (d.contracts ?? []).map((k) => ({ ...k, bushels: k.bushels == null ? null : Number(k.bushels), price_per_unit: k.price_per_unit == null ? null : Number(k.price_per_unit) })),
      inputs: (d.inputs ?? []).map((i) => ({ ...i, cost_per_acre: i.cost_per_acre == null ? null : Number(i.cost_per_acre) })),
      market: d.market ?? [],
      bids: new Map(d.bids ?? []),
      today: new Date().toISOString().slice(0, 10),
    }
    const money = (v: number) => (v < 1 ? v.toFixed(3) : v.toFixed(2))
    const deals: LandDeal[] = (d.leases ?? []).map((l) => ({
      ...l,
      arrangement: (l.arrangement ?? 'cash_rent') as LandDeal['arrangement'],
      field_ids: l.field_ids ?? [],
      rent_per_acre: l.rent_per_acre == null ? null : Number(l.rent_per_acre),
      rent_total: l.rent_total == null ? null : Number(l.rent_total),
      our_share_pct: l.our_share_pct == null ? null : Number(l.our_share_pct),
      crop_share_pct: l.crop_share_pct == null ? null : Number(l.crop_share_pct),
      inputs_shared: l.inputs_shared ?? true,
      direction: l.direction === 'out' ? 'out' : 'in',
      crop_ids: l.crop_ids ?? null,
    }))
    /** crop id → economics on one field in one year — our side of it on a shared field. */
    const economicsFor = (fieldId: string, year: number): Map<string, FieldEconomics> => {
      const m = new Map<string, FieldEconomics>()
      for (const c of cropInfo) {
        // A 50/50 field earns us half the cheque (all of it less the inputs if
        // the inputs come off the top); a crop-share field loses the owner's
        // share of the revenue. Cash rent is the same whatever the crop, so it
        // does not move the choice. On our land a grower farms (the potato
        // deal), our share of the gross is ours and the grower pays the inputs.
        const deal = dealFor(deals, fieldId, year, c.id)
        const out = deal?.direction === 'out'
        const revShare = deal?.arrangement === 'profit_share' ? (deal.our_share_pct ?? 50) / 100 : deal?.arrangement === 'crop_share' ? 1 - (deal.crop_share_pct ?? 0) / 100 : out ? 0 : 1
        const costShare = out ? 0 : deal?.arrangement === 'profit_share' && deal.inputs_shared ? revShare : 1
        const note = out
          ? ` · rented out to ${deal!.landlord}${deal!.arrangement === 'profit_share' ? `, ${Math.round(revShare * 100)}% of the gross to us, inputs theirs` : ''}`
          : deal && deal.arrangement !== 'cash_rent'
            ? ` · our side of the ${deal.arrangement === 'profit_share' ? (deal.inputs_shared ? `${Math.round(revShare * 100)}% net split` : `${Math.round(revShare * 100)}% of the gross, inputs ours`) : 'crop share'} with ${deal.landlord}`
            : ''
        const b = cropMargin(marginInputs, c.id, year, fieldId)
        const built = b.from === 'built'
        // On a gross split, insurance comes off the cheque first: we get our
        // share of (revenue − insurance) and pay the rest of the inputs.
        const offTop = deal?.arrangement === 'profit_share' && !deal.inputs_shared && !out ? b.insurance : 0
        const revenue = built ? (b.yield! * b.price! - offTop) * revShare : null
        const cost = built ? (b.cost! - offTop) * costShare : null
        m.set(c.id, {
          revenue,
          cost,
          margin: built ? revenue! - cost! : b.margin == null ? null : b.margin * revShare,
          basis: (built
            ? `${Math.round(b.yield!)} ${b.unit} (${b.yieldFrom}) × $${money(b.price!)} (${b.priceFrom}) − $${Math.round(b.cost!)} (${b.costFrom})`
            : b.from === 'budget'
              ? 'margin typed on the crop'
              : 'no margin on file') + note,
        })
      }
      return m
    }
    const scoutingByField = new Map<string, ScoutFinding[]>()
    for (const n of d.scouting ?? []) {
      if (!n.field_id || !n.subject) continue
      const list = scoutingByField.get(n.field_id) ?? []
      list.push({ category: n.category, subject: n.subject, severity: Number(n.severity ?? 1), year: n.crop_year })
      scoutingByField.set(n.field_id, list)
    }
    // Heat units: each field reads the 0.25° weather cell it sits in.
    const cellKey = (lat: number, lon: number) => `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lon * 4) / 4).toFixed(2)}`
    const climateByCell = new Map((d.climate ?? []).map((c) => [c.cell_key as string, c]))
    const climateByField = new Map<string, (typeof d.climate)[number]>()
    for (const c of d.centroids ?? []) {
      if (c.lat == null || c.lon == null) continue
      const hit = climateByCell.get(cellKey(Number(c.lat), Number(c.lon)))
      if (hit) climateByField.set(c.field_id as string, hit)
    }
    /** Corn heat units expected on a field in a year: the median, or a cool year; plus the outlook's shift when it covers that summer. */
    const chuFor = (fieldId: string, year: number, cool: boolean): number | null => {
      const c = climateByField.get(fieldId)
      if (!c) return null
      const base = Number(cool ? c.chu_p20 : c.chu_median)
      const o = c.outlook as { plan_year?: number; chu_shift?: number | null } | null
      return base + (!cool && o?.plan_year === year && o.chu_shift != null ? o.chu_shift : 0)
    }
    // The newest reading per station; notices kept whole.
    const latestSupply = new Map<string, (typeof d.supply)[number]>()
    for (const w of d.supply ?? []) if (w.kind !== 'notice' && !latestSupply.has(`${w.kind}:${w.station}`)) latestSupply.set(`${w.kind}:${w.station}`, w)

    /** The water a year's plan must live inside; smridOverride is a what-if allotment. */
    const waterFor = (year: number, fieldAcres: Map<string, number>, smridOverride: number | null = null) =>
      waterBudget(d.pivots ?? [], d.licences ?? [], d.allotments ?? [], year, fieldAcres, smridOverride)
    // Each field's own season need per crop (soil, pivot, AIMM); until it
    // loads, the engine falls back to the crop's farm figure.
    const needOn = fieldNeedResolver(needInputs)

    /** The field for the engine: ten years of history, overlaid by what the planner holds (plans and splits). */
    const fieldCtx = (
      f: { id: string; name: string },
      acres: number,
      crops: Map<number, string[]>,
      year?: number,
      water?: ReturnType<typeof waterFor>,
      coolSummer = false,
    ): FieldCtx => {
      const merged = new Map(historyByField.get(f.id) ?? [])
      for (const [y, ids] of crops) merged.set(y, ids)
      const w = water?.byField.get(f.id)
      return {
        economics: year != null ? economicsFor(f.id, year) : undefined,
        scouting: scoutingByField.get(f.id),
        waterSource: w?.source ?? null,
        irrigatedAcres: w?.irrigatedAcres,
        waterNeedIn: needOn ? (cropId: string) => needOn(f.id, cropId).needIn : undefined,
        chu: year != null ? chuFor(f.id, year, coolSummer) : null,
        id: f.id,
        name: f.name,
        acres,
        irrigated: irrigated.has(f.id),
        sandy: (sandyShare.get(f.id) ?? 0) >= 50,
        ec: salt.get(f.id)?.ec ?? null,
        crops: merged,
        apps: appsByField.get(f.id) ?? [],
        canola: canolaYears(f.id, crops),
      }
    }
    return {
      loading: false,
      ready: true as const,
      cropInfo,
      rulesByReg,
      appsByField,
      rentedOut,
      maxFor,
      groupMaxFor,
      limits: d.limits,
      marginSource: new Map((d.crops ?? []).map((c) => [c.id, c.margin_source as string | null])),
      fieldCtx,
      canolaYears,
      /** A crop's herbicide trait (set on canola), null when not set. */
      traitOf: (cropId: string) => asTrait(allCropsById.get(cropId)?.herbicide_trait),
      /** The farm-level margin build-up for a crop in a year (farm average yield). */
      marginBasis: (cropId: string, year: number) => cropMargin(marginInputs, cropId, year),
      contractMinimums: (year: number) => contractMinimums(marginInputs, year),
      /**
       * Least acres of each feed crop to grow in `year` for the winter that
       * follows it, from each ranch's feed plan and ration.
       */
      feedMinimums: (year: number) =>
        feedMinimums(feedRanches, feedCrops, (cropId) => cropMargin(marginInputs, cropId, year).yield),
      /** Value a crop earns for a sister company, shown beside the margin and never in it. */
      sisterValue: new Map(
        (d.crops ?? [])
          .filter((c) => c.sister_value_note || c.sister_value_per_acre != null)
          .map((c) => [c.id, { perAcre: c.sister_value_per_acre == null ? null : Number(c.sister_value_per_acre), note: c.sister_value_note as string | null }]),
      ),
      waterFor,
      /** Every irrigated field's name, including ones the planner doesn't list. */
      pivotFieldNames: new Map(d.pivots.map((p) => [p.field_id as string, ((p as unknown as { fields?: { name?: string } | null }).fields?.name ?? null) as string | null])),
      scoutingByField,
      climate: d.climate ?? [],
      climateByField,
      waterSupply: [...latestSupply.values()],
      notices: (d.supply ?? []).filter((w) => w.kind === 'notice').slice(0, 4),
    }
  }, [q.data, q.isLoading, saltRows, needInputs])
}

/** Set (or clear, with null) a crop's every-year acre limit. */
export function useSetAcreLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { cropId: string; maxAcres: number | null }) => {
      await supabase.from('crop_acre_limits').delete().eq('crop_id', v.cropId).is('crop_year', null)
      if (v.maxAcres != null) {
        const { error } = await supabase.from('crop_acre_limits').insert({ crop_id: v.cropId, crop_year: null, max_acres: v.maxAcres })
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rotation-context'] }),
  })
}

/** Set (or clear, with null) a group's every-year combined acre limit (all beans together). */
export function useSetGroupLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { group: 'dry_bean' | 'canola' | 'forage_legume'; maxAcres: number | null }) => {
      await supabase.from('crop_acre_limits').delete().eq('crop_group', v.group).is('crop_year', null)
      if (v.maxAcres != null) {
        const { error } = await supabase.from('crop_acre_limits').insert({ crop_group: v.group, crop_year: null, max_acres: v.maxAcres })
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rotation-context'] }),
  })
}

/** Mark a crop as grown here only by a renter (kept out of the recommendations). */
export function useSetRenterOnly() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { cropId: string; renterOnly: boolean }) => {
      const { error } = await supabase.from('crops').update({ renter_only: v.renterOnly }).eq('id', v.cropId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rotation-context'] }),
  })
}

/** Mark a crop as our own feed (its price is a feed value, not a sale). */
export function useSetOwnUse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { cropId: string; ownUse: boolean }) => {
      const { error } = await supabase.from('crops').update({ own_use: v.ownUse }).eq('id', v.cropId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rotation-context'] }),
  })
}

/** Value per acre a crop earns for a sister company (null clears it). Never added to RVR's margin. */
export function useSetSisterValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { cropId: string; perAcre: number | null }) => {
      const { error } = await supabase.from('crops').update({ sister_value_per_acre: v.perAcre }).eq('id', v.cropId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rotation-context'] }),
  })
}

/**
 * Set a crop's average-year irrigation need, inches at the pivot. A typed
 * figure is the farm's own, no longer the Alberta one; each field still
 * moves off it for its soil, pivot and AIMM seasons.
 */
export function useSetCropWaterNeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { cropId: string; inches: number | null }) => {
      const { error } = await supabase.from('crops').update({ irrigation_need_in: v.inches, irrigation_need_basis: v.inches == null ? null : 'farm' }).eq('id', v.cropId)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
      void qc.invalidateQueries({ queryKey: ['field-need-inputs'] })
    },
  })
}

/** Set a crop's margin per acre, used by the "most profitable" plan. */
export function useSetCropMargin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { cropId: string; margin: number | null }) => {
      const { error } = await supabase
        .from('crops')
        .update({ margin_per_acre: v.margin, margin_source: v.margin == null ? null : 'Set by hand' })
        .eq('id', v.cropId)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
      void qc.invalidateQueries({ queryKey: ['crops'] })
    },
  })
}
