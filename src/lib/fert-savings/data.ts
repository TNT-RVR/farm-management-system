import { useMemo } from 'react'
import type { SoilZone, WaterSource } from './alberta'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { farmRetailer } from '../farm-context'
import type { Database, Json } from '../database.types'
import { useJdProducts, useProductPurchases } from '../products'
import { useMarketPrices, useMarketSeries } from '../markets'
import {
  STRAIGHTS,
  perLitreToPerTonne,
  straightByKey,
  straightKeyOf,
  usdShortTonToCadTonne,
  type PricedStraight,
} from './straights'
import { computeAdders, surveyKeyOf, type DtnWeek, type FxDay, type ProductAdder, type SurveyPrice } from './adder'

type Tables = Database['public']['Tables']
export type FertTable =
  | 'fert_bookings'
  | 'fert_quotes'
  | 'fert_programs'
  | 'fert_inventory'
  | 'fert_split_plans'
  | 'fert_check_strips'
export type Booking = Tables['fert_bookings']['Row']
export type Quote = Tables['fert_quotes']['Row']
export type Program = Tables['fert_programs']['Row']
export type InventoryRow = Tables['fert_inventory']['Row']
export type SplitPlan = Tables['fert_split_plans']['Row']
export type CheckStrip = Tables['fert_check_strips']['Row']

/**
 * The six record tables share one shape of query and mutation. The generated
 * client types cannot follow a table name through a generic, so these go
 * through an untyped handle; the row types on the way out are still exact.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const DAY = 86_400_000
const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY

/* ---------------------------------------------------------------- settings */

export const SETTING_DEFAULTS = {
  /**
   * What Alberta retail runs above US Midwest, CAD/tonne, typed in. Null (the
   * default) means work it out per product from ICI invoices and Alberta's
   * survey against DTN (adder.ts); a typed number overrides that for every
   * product.
   */
  dtn_adder_per_tonne: null as number | null,
  /** What it costs the farm to spread its own fertilizer, $/ac. */
  own_application_per_acre: null as number | null,
  /** Share of N put on at seeding on irrigated ground, %. */
  split_upfront_pct: 70,
  /** Name used on the quote request; null means the farm's own name (Farm setup). */
  farm_name: null as string | null,
  /** Check-yield fractions by crop, where the farm's own trials say otherwise. */
  check_fraction: {} as Record<string, number>,
  /** Operating-line interest, %/yr, for prepay and buy-and-store. */
  operating_rate_pct: 7,
  /** Urea lost to caking, fines and handling over a winter in the bin, %. */
  storage_shrink_pct: 1,
  /**
   * What one field's soil test costs, $. Free: ICI tests at no charge as of
   * Oct 2026. It was $215 a field (ICI's "Standard Full" package, 2023); the
   * $0 is also stored as a row (migration 20261002020100).
   */
  soil_test_per_field: 0,
  /**
   * ICI's contract terms when no invoice says otherwise: floating at $15.50 an
   * acre and Edge at 7.5 lb/ac — what the 2026 invoices billed. The latest
   * year's invoices win over these (iciContractTerms).
   */
  ici_floating_per_acre: 15.5,
  ici_edge_lb_per_acre: 7.5,
  /** Manure hauling, $ a ton for each km driven (round trip counted). */
  haul_per_tonne_km: 0.3,
  /** Loading and spreading manure, $ a ton. */
  manure_load_per_ton: 2,
  /** What the manure itself costs, $ a ton (0 when it is the farm's own). */
  manure_buy_per_ton: 0,
  /** Soil zone for Alberta's dryland tables and the AOPA limit. Southern Alberta's dryland is Brown. */
  soil_zone: 'Brown' as SoilZone,
  /** Share of N put on at seeding, by crop, % — overrides the researched defaults. */
  split_upfront_by_crop: {} as Record<string, number>,
  /** Irrigation water applied in a season, inches, for the water-sulphur credit. */
  irrigation_inches: 12,
  /** Where the irrigation water comes from; sets the sulphur it carries. */
  irrigation_water: 'smrid' as WaterSource,
}
export type SettingKey = keyof typeof SETTING_DEFAULTS

export function useFertSettings() {
  const q = useQuery({
    queryKey: ['fert_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fert_settings').select('*')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })
  const get = <K extends SettingKey>(key: K): (typeof SETTING_DEFAULTS)[K] => {
    const row = q.data?.find((r) => r.key === key)
    return (row ? (row.value as unknown) : SETTING_DEFAULTS[key]) as (typeof SETTING_DEFAULTS)[K]
  }
  return { ...q, get }
}

export function useSaveFertSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { key: SettingKey; value: Json }) => {
      // The column is NOT NULL; null means "back to the default", which is no row.
      if (v.value === null) {
        const { error } = await supabase.from('fert_settings').delete().eq('key', v.key)
        if (error) throw error
        return
      }
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('fert_settings')
        .upsert({ key: v.key, value: v.value, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fert_settings'] }),
  })
}

/* ------------------------------------------------------------ record tables */

export function useFertRows<T extends FertTable>(table: T, cropYear?: number) {
  return useQuery({
    queryKey: [table, cropYear ?? 'all'],
    queryFn: async (): Promise<Tables[T]['Row'][]> => {
      let q = db.from(table).select('*').order('created_at', { ascending: false })
      if (cropYear != null && table !== 'fert_programs' && table !== 'fert_inventory') q = q.eq('crop_year', cropYear)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Tables[T]['Row'][]
    },
    staleTime: 60_000,
  })
}

export function useFertMutations<T extends FertTable>(table: T) {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: [table] })
  const add = useMutation({
    mutationFn: async (row: Tables[T]['Insert']) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await db.from(table).insert({ ...row, created_by: user?.id ?? null })
      if (error) throw error
    },
    onSuccess: done,
  })
  const update = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Tables[T]['Update']) => {
      const { error } = await db.from(table).update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  const upsert = useMutation({
    mutationFn: async ({ row, onConflict }: { row: Tables[T]['Insert']; onConflict: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await db.from(table).upsert({ ...row, created_by: user?.id ?? null }, { onConflict })
      if (error) throw error
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from(table).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  return { add, update, upsert, remove }
}

/* ------------------------------------------------------------------ prices */

export type DtnPoint = { on: string; usd: number; cad: number }

/** The adder a DTN price is lifted by, and where it came from. */
export type AdderUsed = {
  perTonne: number
  /** True when typed into the Savings settings; false when worked out. */
  typed: boolean
  /** The worked-out figure behind it, typed or not, for the page to show. */
  auto: ProductAdder | null
}

/**
 * Alberta's monthly survey prices for the bulk straights. A couple of hundred
 * rows, six more a month — small enough to read whole and work on here.
 */
export function useAbFertilizerPrices() {
  return useQuery({
    queryKey: ['ab_input_prices', 'fertilizer'],
    queryFn: async (): Promise<SurveyPrice[]> => {
      // Not in the generated types (only its ab_input_latest view is), hence `db`.
      const { data, error } = await db.from('ab_input_prices').select('item_key, observed_on, price').eq('category', 'fertilizer')
      if (error) throw error
      const out: SurveyPrice[] = []
      for (const r of (data ?? []) as { item_key: string; observed_on: string; price: number | string }[]) {
        const key = surveyKeyOf(r.item_key)
        if (key) out.push({ key, on: r.observed_on, perTonne: Number(r.price) })
      }
      return out
    },
    staleTime: 60 * 60_000,
  })
}

/**
 * What each straight costs now, from the best source there is.
 *
 * An ICI invoice or a quote from the last thirteen months wins — it is what
 * this farm pays. Otherwise this week's DTN US retail, converted at the Bank
 * of Canada rate and lifted by each product's Alberta adder (adderOf). `dtn` is kept
 * separately so the tools that compare against "this week" can.
 */
export function usePricedStraights() {
  const { data: products } = useJdProducts()
  const { data: purchases } = useProductPurchases()
  const { data: quotes } = useFertRows('fert_quotes')
  const { data: series } = useMarketSeries(['fertilizer', 'fx'])
  const settings = useFertSettings()
  const { data: survey } = useAbFertilizerPrices()
  // Never set (null) means work it out; a typed 0 is a real override.
  const typedRaw = settings.get('dtn_adder_per_tonne')
  const typedAdder = typedRaw == null || !Number.isFinite(Number(typedRaw)) ? null : Number(typedRaw)
  const dtnSeries = useMemo(() => (series ?? []).filter((s) => s.source === 'dtn' || s.code === 'fx.usdcad'), [series])
  const { data: points } = useMarketPrices(dtnSeries.map((s) => s.id))

  return useMemo(() => {
    const now = today()
    const fxSeries = dtnSeries.find((s) => s.code === 'fx.usdcad')
    const fxPoints = (points ?? []).filter((p) => p.series_id === fxSeries?.id && p.value != null).sort((a, b) => b.observed_on.localeCompare(a.observed_on))
    const fx = fxPoints[0]?.value ?? null

    // ICI: every invoice line for a straight, in CAD/tonne.
    const iciLines: { key: string; perTonne: number; on: string; invoice: string | null; tonnes: number | null }[] = []
    for (const p of products?.products ?? []) {
      if (p.category !== 'fertilizer') continue
      const key = straightKeyOf(p.name)
      if (!key) continue
      const st = straightByKey(key)!
      for (const l of purchases?.byProduct.get(p.id) ?? []) {
        if (l.price_per_canonical == null || !l.invoice_date) continue
        const v = Number(l.price_per_canonical)
        const perTonne = p.unit === 'kg' ? v * 1000 : st.densityKgL ? perLitreToPerTonne(v, st.densityKgL) : null
        if (perTonne != null) {
          const amount = l.amount == null ? null : Number(l.amount)
          iciLines.push({ key, perTonne, on: l.invoice_date, invoice: l.invoice_no, tonnes: amount != null && perTonne > 0 ? amount / perTonne : null })
        }
      }
    }

    // The adder per straight: worked out month by month from ICI and Alberta's
    // survey against DTN, unless one is typed into the settings.
    const weeks = new Map<string, DtnWeek[]>()
    for (const st of STRAIGHTS) {
      const s = st.dtn ? dtnSeries.find((x) => x.code === st.dtn) : null
      if (!s) continue
      const w = (points ?? []).filter((p) => p.series_id === s.id && p.value != null).map((p) => ({ on: p.observed_on, usd: p.value as number }))
      if (w.length) weeks.set(st.key, w)
    }
    const fxDays: FxDay[] = fxPoints.map((p) => ({ on: p.observed_on, rate: p.value as number }))
    const adders = computeAdders({ ici: iciLines, survey: survey ?? [], dtn: weeks, fx: fxDays })
    const adderOf = (key: string): AdderUsed => {
      const auto = adders.get(key) ?? null
      if (typedAdder != null) return { perTonne: typedAdder, typed: true, auto }
      return { perTonne: auto?.perTonne ?? 0, typed: false, auto }
    }

    // DTN history per straight, in CAD/tonne with the adder. Converted at
    // today's rate: the chart is "what that week's price would cost now".
    const dtnHistory = new Map<string, DtnPoint[]>()
    for (const [key, w] of weeks) {
      if (fx == null) continue
      const add = adderOf(key).perTonne
      const pts = w.map((p) => ({ on: p.on, usd: p.usd, cad: usdShortTonToCadTonne(p.usd, fx) + add }))
      dtnHistory.set(key, pts.sort((a, b) => a.on.localeCompare(b.on)))
    }
    const dtn: PricedStraight[] = [...dtnHistory.entries()].map(([key, pts]) => {
      const last = pts[pts.length - 1]
      return { key, perTonne: last.cad, source: 'DTN US retail', on: last.on, adder: adderOf(key).perTonne }
    })

    // Best current price per straight.
    const current = new Map<string, PricedStraight>()
    const consider = (c: PricedStraight) => {
      const cur = current.get(c.key)
      // Newer wins; on the same date, the cheaper (bulk over the jug).
      if (!cur || (c.on ?? '') > (cur.on ?? '') || (c.on === cur.on && c.perTonne < cur.perTonne)) current.set(c.key, c)
    }
    for (const l of iciLines) if (daysBetween(l.on, now) <= 400) consider({ key: l.key, perTonne: l.perTonne, source: 'ICI invoice', on: l.on })
    for (const q of quotes ?? []) {
      const key = straightByKey(q.product) ? q.product : straightKeyOf(q.product)
      if (!key) continue
      const live = q.valid_until ? q.valid_until >= now : daysBetween(q.quoted_on, now) <= 120
      if (live) consider({ key, perTonne: Number(q.price_per_tonne), source: 'Quote', on: q.quoted_on })
    }
    for (const d of dtn) if (!current.has(d.key)) current.set(d.key, d)

    /** A straight's price on a past date: an ICI line within six months, else DTN within two. */
    const priceAt = (key: string, on: string): { perTonne: number; source: string } | null => {
      const ici = iciLines
        .filter((l) => l.key === key && daysBetween(l.on, on) <= 183)
        .sort((a, b) => daysBetween(a.on, on) - daysBetween(b.on, on))[0]
      if (ici) return { perTonne: ici.perTonne, source: `${farmRetailer()} ${ici.on}` }
      const d = (dtnHistory.get(key) ?? [])
        .filter((p) => daysBetween(p.on, on) <= 60)
        .sort((a, b) => daysBetween(a.on, on) - daysBetween(b.on, on))[0]
      if (d) return { perTonne: d.cad, source: `DTN ${d.on}` }
      return null
    }

    return {
      current: [...current.values()],
      currentOf: (key: string) => current.get(key) ?? null,
      dtn,
      dtnHistory,
      iciLines,
      fx,
      adderOf,
      typedAdder,
      priceAt,
      ready: !!products && !!purchases,
    }
  }, [products, purchases, quotes, dtnSeries, points, survey, typedAdder])
}

/* --------------------------------------------------------- field lookups */

export type FieldSoil = {
  fieldId: string
  reportId: string
  reportYear: number
  cropLabel: string | null
  oP: number | null
  k: number | null
  residualN: number | null
  recs: { nutrient?: string; product?: string; lb_per_ac?: number; note?: string; timing?: string }[] | null
  assessedAt: string | null
}

/** The newest soil test on each field up to the crop year, with its recommendation. */
export function useSoilByField(cropYear: number) {
  return useQuery({
    queryKey: ['fert_soil_by_field', cropYear],
    queryFn: async (): Promise<Map<string, FieldSoil>> => {
      const { data, error } = await supabase
        .from('soil_test_reports')
        .select('id, field_id, crop_year, crop_label, soil_test_samples(depth_top_in, p_bicarb_ppm, k_ppm, no3n_lb_ac, sample_code), soil_test_assessments(recommendation, generated_at)')
        .lte('crop_year', cropYear)
        .order('crop_year', { ascending: false })
      if (error) throw error
      const out = new Map<string, FieldSoil>()
      type Sample = { depth_top_in: number | null; p_bicarb_ppm: number | null; k_ppm: number | null; no3n_lb_ac: number | null; sample_code: string }
      for (const r of data ?? []) {
        const row = r as unknown as {
          id: string
          field_id: string
          crop_year: number
          crop_label: string | null
          soil_test_samples: Sample[]
          soil_test_assessments: { recommendation: unknown; generated_at: string | null } | { recommendation: unknown; generated_at: string | null }[] | null
        }
        const prev = out.get(row.field_id)
        if (prev && prev.reportYear > row.crop_year) continue
        const top = row.soil_test_samples.filter((s) => Number(s.depth_top_in) === 0)
        const avg = (k: 'p_bicarb_ppm' | 'k_ppm') => {
          const v = top.map((s) => s[k]).filter((x): x is number => x != null).map(Number)
          return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
        }
        // Profile nitrate: the layers add within a site, then sites average.
        const bySite = new Map<string, number>()
        for (const s of row.soil_test_samples) {
          if (s.no3n_lb_ac == null) continue
          const site = s.sample_code.replace(/[A-Z]$/, '')
          bySite.set(site, (bySite.get(site) ?? 0) + Number(s.no3n_lb_ac))
        }
        const residualN = bySite.size ? [...bySite.values()].reduce((a, b) => a + b, 0) / bySite.size : null
        const a = Array.isArray(row.soil_test_assessments) ? row.soil_test_assessments[0] : row.soil_test_assessments
        const recs = a && Array.isArray(a.recommendation) ? (a.recommendation as FieldSoil['recs']) : null
        // Two reports in one year (a field sampled in halves): keep the first
        // with a recommendation, and average nothing — the halves differ.
        if (prev && prev.reportYear === row.crop_year && prev.recs) continue
        out.set(row.field_id, {
          fieldId: row.field_id,
          reportId: row.id,
          reportYear: row.crop_year,
          cropLabel: row.crop_label,
          oP: avg('p_bicarb_ppm'),
          k: avg('k_ppm'),
          residualN,
          recs,
          assessedAt: a?.generated_at ?? null,
        })
      }
      return out
    },
    staleTime: 5 * 60_000,
  })
}

export type HistoryRow = { field_id: string; crop_year: number; crop: string | null; yield_per_acre: number | null; yield_unit: string | null; acres: number | null }

export function useCropHistoryAll() {
  return useQuery({
    queryKey: ['fert_crop_history'],
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await supabase
        .from('crop_history')
        .select('field_id, crop_year, yield_per_acre, yield_unit, acres, crops(name)')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as HistoryRow & { crops?: { name?: string } | null }
        return {
          field_id: row.field_id,
          crop_year: row.crop_year,
          crop: row.crops?.name ?? null,
          yield_per_acre: row.yield_per_acre == null ? null : Number(row.yield_per_acre),
          yield_unit: row.yield_unit,
          acres: row.acres == null ? null : Number(row.acres),
        }
      })
    },
    staleTime: 10 * 60_000,
  })
}

export function useIrrigatedFields() {
  return useQuery({
    queryKey: ['fert_irrigated_fields'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_pivots').select('field_id').eq('not_used', false)
      if (error) throw error
      return new Set((data ?? []).map((r) => r.field_id as string))
    },
    staleTime: 30 * 60_000,
  })
}

export function useTissueForYear(cropYear: number) {
  return useQuery({
    queryKey: ['fert_tissue', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tissue_tests')
        .select('field_id, sampled_on, crop, growth_stage, n_pct')
        .eq('crop_year', cropYear)
        .order('sampled_on', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** Manure spreads with when they were written down, for the credit check. */
export function useManureWithTimes() {
  return useQuery({
    queryKey: ['fert_manure_times'],
    queryFn: async () => {
      const { data, error } = await supabase.from('manure_applications').select('*')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** Crop prices by crop id for a season. */
export function useCropPriceMap(cropYear: number) {
  return useQuery({
    queryKey: ['fert_crop_prices', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase.from('crop_prices').select('crop_id, crop_year, price_per_unit').lte('crop_year', cropYear).order('crop_year', { ascending: false })
      if (error) throw error
      const m = new Map<string, number>()
      for (const r of data ?? []) if (!m.has(r.crop_id) && r.price_per_unit != null) m.set(r.crop_id, Number(r.price_per_unit))
      return m
    },
    staleTime: 10 * 60_000,
  })
}

/** The DTN article each week's prices were read from, newest first. */
export function useDtnArticles() {
  return useQuery({
    queryKey: ['dtn_articles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_prices')
        .select('observed_on, source_url')
        .not('source_url', 'is', null)
        .order('observed_on', { ascending: false })
      if (error) throw error
      const byDate = new Map<string, string>()
      for (const r of data ?? []) if (r.source_url && !byDate.has(r.observed_on)) byDate.set(r.observed_on, r.source_url)
      return byDate
    },
    staleTime: 30 * 60_000,
  })
}

/** Straight-line kilometres from the main yard to each field. */
export function useYardDistances() {
  return useQuery({
    queryKey: ['field_yard_distance'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_yard_distance').select('field_id, km')
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.field_id, r.km == null ? null : Number(r.km)]))
    },
    staleTime: 60 * 60_000,
  })
}

export type WaterSCredit = {
  water_source: 'oldman' | 'smrid'
  lb_s_per_inch: number | null
  so4_median_mg_l: number | null
  so4_samples: number
  no3n_median_mg_l: number | null
  no3n_all_below_dl: boolean | null
  ec_median_us_cm: number | null
  sar_median: number | null
  latest_sample: string | null
}

/**
 * The measured water-sulphur credit: May–Sep median sulphate over the last five
 * seasons at the stations that stand for each water source, from the monthly
 * provincial pull. Empty until the first pull lands; callers fall back to the
 * researched constants in WATER_S_BY_SOURCE.
 */
export function useWaterSCredit() {
  return useQuery({
    queryKey: ['water_s_credit'],
    queryFn: async (): Promise<Map<string, WaterSCredit>> => {
      const { data, error } = await supabase.from('water_s_credit').select('*')
      if (error) throw error
      const rows = (data ?? []) as unknown as WaterSCredit[]
      return new Map(rows.map((r) => [r.water_source, { ...r, lb_s_per_inch: r.lb_s_per_inch == null ? null : Number(r.lb_s_per_inch) }]))
    },
    staleTime: 60 * 60_000,
  })
}
