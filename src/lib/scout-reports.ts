import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { normalizeLld } from './geo/lld'

/**
 * Seed canola scout reports.
 *
 * Every autumn the seed canola companies walk the quarters they are thinking
 * of contracting for next year and grade them. The grade is the gate: a field
 * the company failed cannot carry its seed canola, whatever the rotation says
 * about it. Kathryn Bilcik of Corteva, 12 November 2026: "we are willing to
 * grow on A's and B's."
 *
 * Most of the quarters a company scouts are not ours — they are the
 * neighbours' land we might take on — so a report is keyed by the legal land
 * description the company wrote, and `field_id` is filled in only where that
 * parcel is one of our own fields.
 */

export type ScoutCounts = {
  /** Weed tallies for one walk: abbreviation → in count / between counts. */
  [pass: string]: Record<string, { ic?: number | null; bc?: number | null }> | undefined
}

export type ScoutReport = {
  id: string
  company: string
  crop_year: number
  scouted_year: number | null
  field_id: string | null
  parcel: string
  grower_name: string | null
  acres: number | null
  rating: string | null
  passed: boolean | null
  crop_this_year: string | null
  crop_history: string[] | null
  last_canola_year: number | null
  last_canola_tech: string | null
  scouting_method: string | null
  ps1_on: string | null
  ps1_stage: string | null
  ps1_notes: string | null
  ps2_required: boolean | null
  ps2_on: string | null
  ps2_by: string | null
  ps2_notes: string | null
  vc_per_m2: number | null
  tissue_on: string | null
  tissue_summary: string | null
  agronomist_note: string | null
  contact_name: string | null
  contact_phone: string | null
  counts: ScoutCounts
  raw: Record<string, unknown>
  source: string | null
}

export type ScoutCompany = {
  key: string
  label: string
  /** Grades the company will grow on. */
  pass: string[]
  /**
   * Where the pass rule comes from. Null means nobody has told us, and the
   * page says so rather than letting an assumption read as the company's rule.
   */
  rule: string | null
}

/**
 * The companies the farm grows seed canola for, in the order Sam listed them
 * (12 Nov 2026). A company that sends a sheet but is not here still imports —
 * `company` is free text — and gets a tab of its own at the end.
 */
export const SCOUT_COMPANIES: ScoutCompany[] = [
  { key: 'corteva', label: 'Corteva', pass: ['A', 'B'], rule: 'Corteva grows on A and B fields — Kathryn Bilcik, 12 November 2026.' },
  { key: 'basf', label: 'BASF', pass: ['A', 'B'], rule: null },
  { key: 'bayer', label: 'Bayer', pass: ['A', 'B'], rule: null },
  { key: 'nutrien', label: 'Nutrien', pass: ['A', 'B'], rule: null },
]

export const companyOf = (key: string): ScoutCompany =>
  SCOUT_COMPANIES.find((c) => c.key === key) ?? { key, label: key.replace(/^./, (c) => c.toUpperCase()), pass: ['A', 'B'], rule: null }

/**
 * The weed abbreviations the counts use.
 *
 * VC, WM, CLV, WBW and WO are from Corteva's own key. BJ and FB are columns in
 * their sheet that the key does not explain and that have been nil on every
 * row so far, so they are shown as the company wrote them rather than guessed
 * at.
 */
export const SCOUT_WEEDS: { key: string; label: string }[] = [
  { key: 'VC', label: 'Volunteer canola' },
  { key: 'WM', label: 'Wild mustard' },
  { key: 'CLV', label: 'Cleavers' },
  { key: 'WBW', label: 'Wild buckwheat' },
  { key: 'WO', label: 'Wild oats' },
  { key: 'BJ', label: 'BJ' },
  { key: 'FB', label: 'FB' },
]

/**
 * Did this field pass?
 *
 * `passed` when the company says pass or fail outright; otherwise the grade
 * against that company's list. Null when there is no grade to go on — which
 * is not the same answer as "no", and the page keeps them apart.
 */
export function scoutPassed(r: Pick<ScoutReport, 'company' | 'rating' | 'passed'>): boolean | null {
  if (r.passed != null) return r.passed
  const grade = (r.rating ?? '').trim().toUpperCase()
  if (!grade) return null
  return companyOf(r.company).pass.includes(grade)
}

/**
 * The seed company a crop is grown for, read off its name.
 *
 * The crop list carries "Corteva Canola", "BASF Canola" and "Nutrien Canola"
 * as separate crops, which is how the rotation knows whose contract a field
 * is being planned for. Null for plain canola, for "Seed Canola (company not
 * chosen)" and for everything that is not a canola.
 */
export function seedCompanyOf(cropName: string | null | undefined): string | null {
  const n = (cropName ?? '').toLowerCase()
  if (!/canola/.test(n)) return null
  return SCOUT_COMPANIES.find((c) => n.includes(c.label.toLowerCase()))?.key ?? null
}

/**
 * Why a field passed or did not, in a sentence.
 *
 * The verdict on its own — a tick, "Corteva will grow here" — is the half
 * anybody can see. The half worth reading is the rule behind it and the
 * grade it was applied to, because that is what somebody argues with when
 * the D says "missed spray date" rather than "full of volunteer canola"
 * (Sam, 13 Nov 2026).
 */
export function passReason(r: Pick<ScoutReport, 'company' | 'rating' | 'passed'>): string {
  const c = companyOf(r.company)
  const grade = (r.rating ?? '').trim().toUpperCase()
  const grades = c.pass.length === 1 ? c.pass[0] : `${c.pass.slice(0, -1).join(', ')} and ${c.pass[c.pass.length - 1]}`
  if (r.passed != null && !grade) {
    return r.passed ? `${c.label} says yes to this field.` : `${c.label} says no to this field.`
  }
  if (!grade) return `${c.label} has not graded this field, so there is nothing to go on.`
  const assumed = c.rule ? '' : ` Nobody has told us ${c.label}'s own rule, so Corteva's is assumed.`
  if (r.passed === true && !c.pass.includes(grade)) return `${c.label} will grow here in spite of the ${grade}.`
  if (r.passed === false && c.pass.includes(grade)) return `${c.label} will not grow here in spite of the ${grade}.`
  return c.pass.includes(grade)
    ? `${c.label} grows on ${grades} fields, and this one graded ${grade}.${assumed}`
    : `${c.label} grows on ${grades} fields only, and this one graded ${grade}.${assumed}`
}

/** A, B, C or D on its own; anything else is shown as written. */
export const GRADE_STYLE: Record<string, string> = {
  A: 'bg-green-100 text-green-900',
  B: 'bg-green-50 text-green-800',
  C: 'bg-amber-50 text-amber-800',
  D: 'bg-red-50 text-red-800',
}

/* ----------------------------------------------------------------- matching */

/**
 * Whether a scouted parcel and one of our fields are the same ground.
 *
 * Exact on the normalised description, with the meridian optional because the
 * companies leave it off and we do not. Deliberately strict: a half section
 * (N 35-40-23) is not the quarter inside it (NE 35-40-23), and a report linked
 * to twice the acres it was walked on would be worse than one left for
 * somebody to link by hand.
 */
export const parcelKey = (v: string | null | undefined) => normalizeLld(v).replace(/W\d$/, '')

export function matchParcel<T extends { id: string; legal_land_description: string | null }>(
  parcel: string,
  fields: T[],
): T | null {
  const k = parcelKey(parcel)
  if (!k) return null
  const hits = fields.filter((f) => parcelKey(f.legal_land_description) === k)
  return hits.length === 1 ? hits[0] : null
}

/* ------------------------------------------------------------------ queries */

const SELECT =
  'id, company, crop_year, scouted_year, field_id, parcel, grower_name, acres, rating, passed, crop_this_year, crop_history, last_canola_year, last_canola_tech, scouting_method, ps1_on, ps1_stage, ps1_notes, ps2_required, ps2_on, ps2_by, ps2_notes, vc_per_m2, tissue_on, tissue_summary, agronomist_note, contact_name, contact_phone, counts, raw, source'

const shape = (r: Record<string, unknown>): ScoutReport => ({
  ...(r as unknown as ScoutReport),
  acres: r.acres == null ? null : Number(r.acres),
  vc_per_m2: r.vc_per_m2 == null ? null : Number(r.vc_per_m2),
  counts: (r.counts ?? {}) as ScoutCounts,
  raw: (r.raw ?? {}) as Record<string, unknown>,
  crop_history: (r.crop_history ?? null) as string[] | null,
})

/** Every scout report, newest crop year first. */
export function useScoutReports() {
  return useQuery({
    queryKey: ['scout_reports'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ScoutReport[]> => {
      const { data, error } = await supabase
        .from('scout_reports')
        .select(SELECT)
        .order('crop_year', { ascending: false })
        .order('parcel')
      if (error) throw error
      return (data ?? []).map((r) => shape(r as Record<string, unknown>))
    },
  })
}

/** One field's scout reports, every company and year. */
export function useFieldScoutReports(fieldId: string | undefined) {
  return useQuery({
    queryKey: ['scout_reports', 'field', fieldId],
    enabled: !!fieldId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ScoutReport[]> => {
      const { data, error } = await supabase
        .from('scout_reports')
        .select(SELECT)
        .eq('field_id', fieldId!)
        .order('crop_year', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => shape(r as Record<string, unknown>))
    },
  })
}

/** Link a report to one of our fields, or unlink it again. */
export function useSetScoutField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, fieldId }: { id: string; fieldId: string | null }) => {
      const { error } = await supabase.from('scout_reports').update({ field_id: fieldId }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scout_reports'] })
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
    },
  })
}

/* ------------------------------------------------------------------ reading */

/** The years on record, newest first. */
export const scoutYears = (rows: ScoutReport[]) => [...new Set(rows.map((r) => r.crop_year))].sort((a, b) => b - a)

/** The companies on record, the four known ones first and in order. */
export function scoutCompanies(rows: ScoutReport[]): ScoutCompany[] {
  const seen = new Set(rows.map((r) => r.company))
  const extra = [...seen].filter((k) => !SCOUT_COMPANIES.some((c) => c.key === k)).sort()
  return [...SCOUT_COMPANIES, ...extra.map(companyOf)]
}

export type FieldVerdict = {
  company: string
  report: ScoutReport | null
  passed: boolean | null
}

/**
 * One field's standing with every company in a year: the report if there is
 * one, and whether it passed. A company with no report is listed too — "not
 * scouted" is the answer somebody is looking for when they wonder why a field
 * is not on the list.
 */
export function verdictsFor(rows: ScoutReport[], fieldId: string, year: number, companies: ScoutCompany[]): FieldVerdict[] {
  return companies.map((c) => {
    const report = rows.find((r) => r.field_id === fieldId && r.crop_year === year && r.company === c.key) ?? null
    return { company: c.key, report, passed: report ? scoutPassed(report) : null }
  })
}

/** Grades, worst first, for sorting a list so the problems are at the top. */
export const gradeRank = (rating: string | null | undefined) => {
  const g = (rating ?? '').trim().toUpperCase()
  const at = ['A', 'B', 'C', 'D'].indexOf(g)
  return at < 0 ? 99 : at
}
