import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

/**
 * Alberta's per-crop irrigation trigger, read off the province's own sheets.
 *
 * The water-balance engine has one trigger per field: field capacity over the
 * root zone less the soil profile's allowable depletion. That is the right
 * number for the checkbook but it says nothing about WHICH crop is in the
 * field or what stage it is at, and Alberta's advice differs sharply between
 * them -- potato wants 70 per cent of available at tuber initiation and loses
 * marketable yield below 65, while winter wheat tolerates 50 before heading.
 *
 * So this layer sits beside the engine, not inside it: it reads the sheet for
 * the field's crop, works out which growth stage the crop is at, and says what
 * the province would do about today's reading. Every figure traces to the PDF
 * the research library holds (`paperId`), so it can be checked.
 */

export type StagePhase = 'ini' | 'dev' | 'mid' | 'late'
export const STAGE_PHASES: StagePhase[] = ['ini', 'dev', 'mid', 'late']

export type SheetRow = Database['public']['Tables']['crop_irrigation_sheets']['Row']
export type StageRow = Database['public']['Tables']['crop_irrigation_stages']['Row']
export type RefillRow = Database['public']['Tables']['crop_irrigation_refill']['Row']

/** A sheet with its stages and its soil-texture table. */
export type CropSheet = SheetRow & { stages: StageRow[]; refill: RefillRow[] }

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The stage lengths the engine already keeps per crop (FAO-56, days). */
export type StageLengths = { l_ini: number; l_dev: number; l_mid: number; l_late: number }

/**
 * Which FAO-56 phase a crop is in, `days` after planting.
 *
 * The same boundaries `kcForDay` walks, so the stage shown here is the stage
 * the water-use curve is already using -- there is no second, disagreeing idea
 * of when flowering starts. Past the end of the late season the crop stays in
 * 'late': a crop still standing after its table says it should be off is
 * mature, not back at the beginning.
 */
export function phaseForDay(c: StageLengths, days: number): StagePhase {
  if (days <= c.l_ini) return 'ini'
  if (days <= c.l_ini + c.l_dev) return 'dev'
  if (days <= c.l_ini + c.l_dev + c.l_mid) return 'mid'
  return 'late'
}

/** Whole days between two ISO dates (local noon, so a DST hop cannot shave one off). */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO.slice(0, 10)}T12:00:00`).getTime()
  const b = new Date(`${toISO.slice(0, 10)}T12:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** Where a stage came from: the planting date, or somebody who walked the field. */
export type StageSource = 'planting_date' | 'by_hand'

export type CropVerdict = 'below' | 'start' | 'watch' | 'ok'

/**
 * How far above the trigger still counts as "getting close".
 *
 * The app's own convention, not Alberta's -- the sheets give a trigger and a
 * floor and say nothing about a warning band. Five points of available water
 * is roughly a day of peak use on a 100 mm zone, which is about the notice a
 * pivot needs to finish a lap.
 */
export const WATCH_BAND_PCT = 5

/**
 * What the province would say about this reading at this stage.
 *
 *   below -- past the floor the sheet says not to cross; yield is being lost
 *   start -- at or under the per cent the sheet says to start irrigating at
 *   watch -- within WATCH_BAND_PCT of that trigger
 *   ok    -- above it
 */
export function cropVerdict(pct: number, stage: Pick<StageRow, 'start_pct' | 'floor_pct'>): CropVerdict {
  const floor = num(stage.floor_pct) ?? 0
  const trigger = num(stage.start_pct) ?? floor
  if (pct < floor) return 'below'
  if (pct <= trigger) return 'start'
  if (pct <= trigger + WATCH_BAND_PCT) return 'watch'
  return 'ok'
}

export const VERDICT_LABEL: Record<CropVerdict, string> = {
  below: 'Past the floor',
  start: 'Start now',
  watch: 'Getting close',
  ok: 'Holding',
}
export const VERDICT_COLOR: Record<CropVerdict, string> = {
  below: 'bg-red-200 text-red-900',
  start: 'bg-red-100 text-red-800',
  watch: 'bg-amber-100 text-amber-900',
  ok: 'bg-green-100 text-green-800',
}
const VERDICT_RANK: Record<CropVerdict, number> = { below: 0, start: 1, watch: 2, ok: 3 }

/** The trigger (per cent of available) a stage fires at. */
export function stageTriggerPct(stage: Pick<StageRow, 'start_pct' | 'floor_pct'>): number {
  return num(stage.start_pct) ?? num(stage.floor_pct) ?? 0
}

/** The sheet for a crop coefficient, matching its variant where the sheet names one. */
export function sheetFor(
  sheets: CropSheet[] | undefined,
  coefCrop: string | null | undefined,
  coefVariant: string | null | undefined,
): CropSheet | null {
  if (!coefCrop) return null
  const forCrop = (sheets ?? []).filter((s) => s.coef_crop === coefCrop)
  // An exact variant match wins; a sheet with an empty variant covers them all.
  return (
    forCrop.find((s) => s.coef_variant === (coefVariant ?? '')) ??
    forCrop.find((s) => s.coef_variant === '') ??
    null
  )
}

// ---------------------------------------------------------------------------
// One field's reading against its sheet
// ---------------------------------------------------------------------------

export type TriggerInput = {
  fieldId: string
  fieldName: string
  /** The crop as the plan names it, for the row's label. */
  cropName: string | null
  /** The engine's crop coefficient: how the sheet is found and the stage timed. */
  coefCrop: string | null
  coefVariant: string | null
  lengths: StageLengths | null
  plantingDate: string | null
  /** The phase somebody set by hand, which wins over the planting date. */
  stageOverride: StagePhase | null
  /** Latest actual balance: water in the tracked root zone, and what it holds full. */
  availMm: number | null
  capacityMm: number | null
  /** The depth the balance tracks, cm (the soil profile's maximum root zone). */
  trackedDepthCm: number | null
  balanceOn: string | null
  /** Finished for the season: the sheet's advice is no longer a call to act. */
  done: boolean
  /** The season row to write a hand-set stage back to. */
  seasonId: string | null
}

export type TriggerRow = {
  fieldId: string
  fieldName: string
  cropName: string | null
  seasonId: string | null
  done: boolean
  balanceOn: string | null
  /** Per cent of available water in the tracked root zone, or null if unknown. */
  pct: number | null
  availMm: number | null
  capacityMm: number | null
  trackedDepthCm: number | null
  sheet: CropSheet | null
  stage: StageRow | null
  stageSource: StageSource | null
  verdict: CropVerdict | null
  /**
   * A sheet for the same crop but a different variant, where the crop's own
   * variant has none. Alberta publishes a silage corn sheet and no grain corn
   * sheet, so a grain corn field is pointed at the silage one by name --
   * knowing the nearest sheet exists is worth something, and borrowing its
   * season total and peak timing, which are silage figures, is not.
   */
  nearSheet: CropSheet | null
  /**
   * Why there is no verdict: said in the row rather than left blank, because
   * "no sheet for grain corn" and "no soil profile yet" need different fixes.
   */
  gap: string | null
}

/**
 * The sheet's reading for one field. Pure, so the rules are testable without
 * a database: everything it needs is in the input.
 */
export function triggerRow(input: TriggerInput, sheets: CropSheet[] | undefined): TriggerRow {
  const sheet = sheetFor(sheets, input.coefCrop, input.coefVariant)
  const pct =
    input.availMm != null && input.capacityMm != null && input.capacityMm > 0
      ? (input.availMm / input.capacityMm) * 100
      : null

  const base = {
    fieldId: input.fieldId,
    fieldName: input.fieldName,
    cropName: input.cropName,
    seasonId: input.seasonId,
    done: input.done,
    balanceOn: input.balanceOn,
    pct,
    availMm: input.availMm,
    capacityMm: input.capacityMm,
    trackedDepthCm: input.trackedDepthCm,
    sheet,
  }

  if (!sheet) {
    // The nearest thing: another variant of the same crop.
    const near = input.coefCrop
      ? ((sheets ?? []).find((s) => s.coef_crop === input.coefCrop) ?? null)
      : null
    return {
      ...base,
      stage: null,
      stageSource: null,
      verdict: null,
      nearSheet: near,
      gap: input.coefCrop
        ? `Alberta has not published a scheduling sheet for ${input.cropName ?? input.coefCrop}` +
          (near ? `; the ${near.crop_label.toLowerCase()} sheet is the nearest` : '')
        : 'This field has no crop with a water-use curve yet',
    }
  }

  // Stage: the hand-set one if there is one, else timed off the planting date.
  let phase: StagePhase | null = input.stageOverride
  let stageSource: StageSource | null = phase ? 'by_hand' : null
  if (!phase && input.plantingDate && input.lengths && input.balanceOn) {
    phase = phaseForDay(input.lengths, daysBetween(input.plantingDate, input.balanceOn))
    stageSource = 'planting_date'
  }
  const stage = phase ? (sheet.stages.find((s) => s.phase === phase) ?? null) : null

  if (!stage) {
    return {
      ...base,
      stage: null,
      stageSource: null,
      verdict: null,
      nearSheet: null,
      gap: input.plantingDate
        ? 'No water-use curve for this crop, so its stage cannot be timed — set the stage by hand'
        : 'No planting date, so the stage cannot be timed — set a planting date or the stage by hand',
    }
  }
  if (pct == null) {
    return {
      ...base,
      stage,
      stageSource,
      verdict: null,
      nearSheet: null,
      gap: 'No water balance for this field yet',
    }
  }

  return {
    ...base,
    stage,
    stageSource,
    verdict: cropVerdict(pct, stage),
    nearSheet: null,
    gap: null,
  }
}

/** Most in need of water first; fields finished for the season last. */
export function sortTriggerRows(rows: TriggerRow[]): TriggerRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.verdict ? VERDICT_RANK[a.verdict] : 9) - (b.verdict ? VERDICT_RANK[b.verdict] : 9) ||
      (a.pct ?? 999) - (b.pct ?? 999) ||
      a.fieldName.localeCompare(b.fieldName),
  )
}

/** One line of plain English for a row, the way the page says it. */
export function triggerSentence(r: TriggerRow): string | null {
  if (r.pct == null || !r.stage || !r.sheet) return null
  const at = `${Math.round(r.pct)}%`
  const crop = (r.sheet.crop_label ?? '').toLowerCase()
  const stage = r.stage.stage_label.toLowerCase()
  const trigger = Math.round(stageTriggerPct(r.stage))
  switch (r.verdict) {
    case 'below':
      return `at ${at} of available — ${crop} at ${stage} should not go below ${Math.round(num(r.stage.floor_pct) ?? 0)}%`
    case 'start':
      return `at ${at} of available — ${crop} at ${stage}, start now (${trigger}%)`
    case 'watch':
      return `at ${at} of available — ${crop} at ${stage}, close to its ${trigger}% trigger`
    case 'ok':
      return `at ${at} of available — ${crop} at ${stage}, trigger ${trigger}%`
    default:
      return null
  }
}

/** The headline over the card: how many fields the sheets say to act on. */
export function triggerSummary(rows: TriggerRow[]): string {
  const live = rows.filter((r) => !r.done)
  const act = live.filter((r) => r.verdict === 'start' || r.verdict === 'below').length
  const watch = live.filter((r) => r.verdict === 'watch').length
  const gaps = live.filter((r) => r.gap).length
  if (!live.length) return 'No field has an irrigation season running'
  const parts: string[] = []
  parts.push(
    act === 0
      ? 'No field is at its crop’s trigger'
      : `${act} field${act === 1 ? ' is' : 's are'} at or past its crop’s trigger`,
  )
  if (watch) parts.push(`${watch} getting close`)
  if (gaps) parts.push(`${gaps} with no sheet or no reading`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every Alberta sheet with its stages and its soil-texture table. */
export function useCropIrrigationSheets() {
  return useQuery({
    queryKey: ['crop_irrigation_sheets'],
    // Published 2011-2016 government sheets: they do not change in a session.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<CropSheet[]> => {
      const [sheets, stages, refill] = await Promise.all([
        supabase.from('crop_irrigation_sheets').select('*').order('crop_label'),
        supabase.from('crop_irrigation_stages').select('*').order('seq'),
        supabase.from('crop_irrigation_refill').select('*').order('depth_cm'),
      ])
      if (sheets.error) throw sheets.error
      if (stages.error) throw stages.error
      if (refill.error) throw refill.error
      return sheets.data.map((s) => ({
        ...s,
        stages: stages.data.filter((x) => x.sheet_id === s.id),
        refill: refill.data.filter((x) => x.sheet_id === s.id),
      }))
    },
  })
}

/** Set (or clear) the growth stage by hand on one field's season. */
export function useSetCropStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ seasonId, phase }: { seasonId: string; phase: StagePhase | null }) => {
      const { data: user } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('field_crop_seasons')
        .update({
          irrigation_stage: phase,
          irrigation_stage_set_at: phase ? new Date().toISOString() : null,
          irrigation_stage_set_by: phase ? (user.user?.id ?? null) : null,
        })
        .eq('id', seasonId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_crop_seasons'] }),
  })
}
