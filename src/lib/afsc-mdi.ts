import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * AFSC Moisture Deficiency Insurance: the four forms, and what goes in them.
 *
 * MDI covers fenced dryland pasture against a dry year. It is area-based:
 * AFSC pays when the rain recorded at the weather stations you pick falls
 * below their normal for the months your option weights, whatever the grass
 * actually did. The deadline is 28 February (Deanna Klassen, AFSC Taber,
 * forwarded by Kurt 28 Oct 2026).
 *
 * The forms AFSC sends are real fillable PDFs, so the app fills AFSC's own
 * file rather than drawing a copy of it: what comes out is the form, not a
 * likeness of it. The blanks live in public/afsc/ (they are not in the
 * service worker's precache, and the originals are byte for byte as AFSC
 * issued them).
 *
 * What the app already knows goes in by itself — the farm's name, the
 * pastures and their acres, the fields' legal land. What it cannot know is
 * asked once a year in a dialog and kept in afsc_mdi_year, so next year
 * starts from last year's answers rather than from nothing.
 *
 * Never filled, deliberately, the same line agristability-form.ts draws: a
 * SIN, a date of birth, or a signature. Those are the applicant's to write.
 */

export type MdiYear = {
  crop_year: number
  identification_number: string | null
  business_name: string | null
  business_address: string | null
  gst_bn: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  home_part: string | null
  home_section: string | null
  home_township: string | null
  home_range: string | null
  home_meridian: string | null
  station_1: string | null
  station_2: string | null
  station_3: string | null
  coverage_option: 'A' | 'B' | 'C' | 'D' | null
  price_per_lb: number | null
  insure_native: boolean
  insure_improved: boolean
  insure_bush: boolean
  insure_community: boolean
  notes: string | null
}

export type MdiLand = {
  id: string
  pasture_id: string | null
  part: string | null
  section: string | null
  township: string | null
  range: string | null
  meridian: string | null
  acres: number | null
  pasture_type: string | null
  tenure: 'owned' | 'cash' | 'crop_share' | null
  title_name: string | null
  sort: number
}

/**
 * The four forms AFSC asks for, and the two that are only there to read.
 *
 * `fills` is false for the pair that carry no fields of their own — the
 * insuring agreement and the option sheet are the program's terms, and the
 * page offers them so nobody has to go looking in an email from January.
 */
export const MDI_FORMS = [
  {
    id: 'mdi-election',
    file: '/afsc/mdi-election.pdf',
    name: 'MDI Election',
    what: 'Which pasture types to insure, the weather stations, the coverage option and the price.',
    fills: true,
  },
  {
    id: 'contract-of-insurance',
    file: '/afsc/contract-of-insurance.pdf',
    name: 'Application for Contract of Insurance',
    what: 'Who is applying and the five eligibility questions.',
    fills: true,
  },
  {
    id: 'land-information-appendix',
    file: '/afsc/land-information-appendix.pdf',
    name: 'Land Information Appendix',
    what: 'Every parcel: its legal land, acres, pasture type and whether it is owned or rented.',
    fills: true,
  },
  {
    id: 'identification-number',
    file: '/afsc/identification-number.pdf',
    name: 'Application for Identification Number',
    what: 'The business, its address and its home quarter. AFSC wants it again every two years.',
    fills: true,
  },
  {
    id: 'insuring-agreement',
    file: '/afsc/mdi-insuring-agreement-2026.pdf',
    name: 'Moisture Deficiency Insuring Agreement, 2026',
    what: 'The program’s terms in full.',
    fills: false,
  },
  {
    id: 'option-information',
    file: '/afsc/mdi-option-information.pdf',
    name: 'MDI option information',
    what: 'The short version of the agreement: the four coverage options and how a payment is worked out.',
    fills: false,
  },
] as const

export type MdiFormId = (typeof MDI_FORMS)[number]['id']

/** The four coverage options, and how each weights the months' rain. */
export const COVERAGE_OPTIONS = [
  { value: 'A', label: 'A — short season', weights: 'May 40 · June 40 · July 20 · Aug 0' },
  { value: 'B', label: 'B — short season', weights: 'May 40 · June 30 · July 30 · Aug 0' },
  { value: 'C', label: 'C — long season', weights: 'May 30 · June 30 · July 20 · Aug 20' },
  { value: 'D', label: 'D — long season', weights: 'May 25 · June 25 · July 25 · Aug 25' },
] as const

/**
 * AFSC's own words for an insuring crop type, exactly as the Land Information
 * Appendix's dropdown spells them — a value it does not know is dropped
 * silently, so these are copied from the PDF's option list, not guessed.
 */
export const INSURING_CROP_TYPES = [
  'Improved pasture',
  'Native pasture',
  'Native bush (60 - 70%)',
  'Native bush (71 - 80%)',
  'Native bush (81-100%)',
] as const

/** Our pasture_type against AFSC's list. Anything else is left for a person to pick. */
export function insuringCropType(pastureType: string | null | undefined): string | null {
  switch ((pastureType ?? '').toLowerCase()) {
    case 'native':
      return 'Native pasture'
    case 'improved':
    case 'tame':
    case 'seeded':
      return 'Improved pasture'
    case 'bush':
      return 'Native bush (60 - 70%)'
    default:
      return null
  }
}

export type LegalLand = { part: string; section: string; township: string; range: string; meridian: string }

/**
 * A legal land description split into the five boxes AFSC's forms want.
 *
 * The app writes them several ways — "SW-13-40-26-W4", "SE 14-40-26",
 * "N-35-40-23-W4", "W1/2 SE-9-40-26-W4", and "2-41-23-W4" for a whole
 * section with no quarter — because they were typed by different people over
 * several years. All of them are Part, Section, Township, Range, Meridian in
 * that order once the separators are ignored; the only real decision is
 * whether the first group is a part or a section number.
 *
 * The meridian is W4 unless the text says otherwise: every acre this farm
 * works is west of the fourth. Returns null rather than a half-read guess —
 * a wrong quarter on an insurance form is worse than an empty box.
 */
export function parseLegalLand(text: string | null | undefined): LegalLand | null {
  if (!text) return null
  const cleaned = text.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!cleaned) return null

  // A leading fraction ("W1/2 SE-9-40-26") belongs with the part.
  const fraction = cleaned.match(/^([NSEW]\s?1\/2|[NSEW]1\/2)\s+/)
  const rest = fraction ? cleaned.slice(fraction[0].length) : cleaned

  const bits = rest.split(/[\s\-–]+/).filter(Boolean)
  if (bits.length < 3) return null

  const isPart = (s: string) => /^(NE|NW|SE|SW|N|S|E|W|ALL)$/.test(s)
  const isNum = (s: string) => /^\d{1,3}$/.test(s)
  const isMer = (s: string) => /^W?[1-6]$/.test(s) || /^W[1-6]$/.test(s)

  let part = ''
  let i = 0
  if (isPart(bits[0])) {
    part = bits[0]
    i = 1
  }
  if (fraction) part = `${fraction[1].replace(/\s/g, '')} ${part}`.trim()

  // Section, township, range must all be numbers.
  const [section, township, range] = [bits[i], bits[i + 1], bits[i + 2]]
  if (!isNum(section) || !isNum(township) || !isNum(range)) return null

  const tail = bits[i + 3]
  const meridian = tail && isMer(tail) ? (tail.startsWith('W') ? tail : `W${tail}`) : 'W4'

  return { part, section, township, range, meridian }
}

/** "SW-13-40-26-W4" from the five boxes, for showing a parsed row back. */
export function formatLegalLand(l: Partial<Record<keyof LegalLand, string | null>> | null | undefined): string {
  if (!l) return ''
  return [l.part, l.section, l.township, l.range, l.meridian].filter(Boolean).join('-')
}

/** The year row, which may not exist yet. */
export function useMdiYear(cropYear: number) {
  return useQuery({
    queryKey: ['afsc-mdi-year', cropYear],
    queryFn: async (): Promise<MdiYear | null> => {
      const { data, error } = await supabase.from('afsc_mdi_year').select('*').eq('crop_year', cropYear).maybeSingle()
      if (error) throw error
      return (data as MdiYear | null) ?? null
    },
  })
}

/** Last year's answers, to start a new year from. */
export function useMdiPreviousYear(cropYear: number) {
  return useQuery({
    queryKey: ['afsc-mdi-year-prev', cropYear],
    queryFn: async (): Promise<MdiYear | null> => {
      const { data, error } = await supabase
        .from('afsc_mdi_year')
        .select('*')
        .lt('crop_year', cropYear)
        .order('crop_year', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as MdiYear | null) ?? null
    },
  })
}

export function useSaveMdiYear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: Partial<MdiYear> & { crop_year: number }) => {
      const { error } = await supabase.from('afsc_mdi_year').upsert(row, { onConflict: 'crop_year' })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['afsc-mdi-year'] })
      void qc.invalidateQueries({ queryKey: ['afsc-mdi-year-prev'] })
    },
  })
}

export function useMdiLand() {
  return useQuery({
    queryKey: ['afsc-mdi-land'],
    queryFn: async (): Promise<MdiLand[]> => {
      const { data, error } = await supabase.from('afsc_mdi_land').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as MdiLand[]
    },
  })
}

export function useSaveMdiLand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rows: Partial<MdiLand>[]) => {
      const { error } = await supabase.from('afsc_mdi_land').upsert(rows)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['afsc-mdi-land'] }),
  })
}

export function useDeleteMdiLand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('afsc_mdi_land').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['afsc-mdi-land'] }),
  })
}

/** The pastures, for suggesting the land rows and adding up the acres. */
export type PastureRow = { id: string; name: string; legal_description: string | null; area_acres: number | null; pasture_type: string | null }

export function usePastures() {
  return useQuery({
    queryKey: ['afsc-mdi-pastures'],
    queryFn: async (): Promise<PastureRow[]> => {
      const { data, error } = await supabase.from('pastures').select('id, name, legal_description, area_acres, pasture_type').order('name')
      if (error) throw error
      return (data ?? []) as PastureRow[]
    },
  })
}

/**
 * A land row for each pasture that has none yet, with everything the pasture
 * already knows filled in. Its legal_description is the ranch area ("Grassy
 * Lake"), not a quarter, so the five boxes are left for a person — which is
 * the one thing on these forms the app genuinely cannot work out.
 */
export function suggestLandRows(pastures: PastureRow[], existing: MdiLand[]): Partial<MdiLand>[] {
  const have = new Set(existing.map((l) => l.pasture_id).filter(Boolean))
  return pastures
    .filter((p) => !have.has(p.id))
    .map((p, i) => ({
      pasture_id: p.id,
      acres: p.area_acres == null ? null : Math.round(p.area_acres * 10) / 10,
      pasture_type: p.pasture_type,
      tenure: 'owned' as const,
      sort: existing.length + i,
      ...(parseLegalLand(p.legal_description) ?? {}),
    }))
}

/** What the form still needs before it is worth sending. */
export function missingAnswers(y: MdiYear | null, land: MdiLand[]): string[] {
  const out: string[] = []
  if (!y?.identification_number) out.push('the AFSC identification number')
  if (!y?.business_name) out.push('the business name')
  if (!y?.station_1) out.push('at least one weather station')
  if (!y?.coverage_option) out.push('a coverage option')
  if (y?.price_per_lb == null) out.push('a price per pound')
  if (!y?.insure_native && !y?.insure_improved && !y?.insure_bush && !y?.insure_community) out.push('which pasture types to insure')
  if (land.length === 0) out.push('the land')
  else if (land.some((l) => !l.section || !l.township || !l.range)) out.push('a legal land location on every parcel')
  return out
}
