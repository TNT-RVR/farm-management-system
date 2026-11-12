import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { pastureRanchId, usePastureRanchLinks } from '@/lib/pastures'
import { useRanches } from '@/lib/ranches'
import { useFarmSetup } from '@/lib/farm-setup'

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
  /** The ranch this subscription covers: AFSC allows one per block of pasture. */
  ranch_id: string
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
  ranch_id: string | null
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

/** The year row for one ranch's subscription, which may not exist yet. */
export function useMdiYear(cropYear: number, ranchId: string) {
  return useQuery({
    queryKey: ['afsc-mdi-year', cropYear, ranchId],
    enabled: !!ranchId,
    queryFn: async (): Promise<MdiYear | null> => {
      const { data, error } = await supabase
        .from('afsc_mdi_year')
        .select('*')
        .eq('crop_year', cropYear)
        .eq('ranch_id', ranchId)
        .maybeSingle()
      if (error) throw error
      return (data as MdiYear | null) ?? null
    },
  })
}

/** Last year's answers for the same ranch, to start a new year from. */
export function useMdiPreviousYear(cropYear: number, ranchId: string) {
  return useQuery({
    queryKey: ['afsc-mdi-year-prev', cropYear, ranchId],
    enabled: !!ranchId,
    queryFn: async (): Promise<MdiYear | null> => {
      const { data, error } = await supabase
        .from('afsc_mdi_year')
        .select('*')
        .eq('ranch_id', ranchId)
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
    mutationFn: async (row: Partial<MdiYear> & { crop_year: number; ranch_id: string }) => {
      const { error } = await supabase.from('afsc_mdi_year').upsert(row, { onConflict: 'crop_year,ranch_id' })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['afsc-mdi-year'] })
      void qc.invalidateQueries({ queryKey: ['afsc-mdi-year-prev'] })
    },
  })
}

/** The parcels insured under one ranch's subscription. */
export function useMdiLand(ranchId: string) {
  return useQuery({
    queryKey: ['afsc-mdi-land', ranchId],
    enabled: !!ranchId,
    queryFn: async (): Promise<MdiLand[]> => {
      const { data, error } = await supabase.from('afsc_mdi_land').select('*').eq('ranch_id', ranchId).order('sort')
      if (error) throw error
      return (data ?? []) as MdiLand[]
    },
  })
}

export function useSaveMdiLand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rows: (Partial<MdiLand> & { ranch_id: string })[]) => {
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

function usePastureList() {
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
 * The pastures on one ranch, by the same rule the rest of the Cattle section
 * uses: the Grazing tab's pasture link where there is one, otherwise the
 * ranch the legal description names. Without this the page offered Bow
 * Island's outer boundary as a parcel of the Home Ranch subscription.
 */
export function usePastures(ranchId: string) {
  const list = usePastureList()
  const { data: links } = usePastureRanchLinks()
  const { data: ranches } = useRanches()
  const data = useMemo(() => {
    if (!list.data) return undefined
    if (!ranchId) return list.data
    const l = links ?? new Map<string, string>()
    const rs = (ranches ?? []).map((r) => ({ id: r.id, name: r.name }))
    return list.data.filter((p) => pastureRanchId({ id: p.id, ranch: p.legal_description }, l, rs) === ranchId)
  }, [list.data, links, ranches, ranchId])
  return { data, isLoading: list.isLoading }
}

/**
 * A land row for each pasture that has none yet, with everything the pasture
 * already knows filled in. Its legal_description is the ranch area ("Grassy
 * Lake"), not a quarter, so the five boxes are left for a person — which is
 * the one thing on these forms the app genuinely cannot work out.
 */
export function suggestLandRows(
  pastures: PastureRow[],
  existing: MdiLand[],
  ranchId: string,
): (Partial<MdiLand> & { ranch_id: string })[] {
  const have = new Set(existing.map((l) => l.pasture_id).filter(Boolean))
  return pastures
    .filter((p) => !have.has(p.id))
    .map((p, i) => ({
      ranch_id: ranchId,
      pasture_id: p.id,
      acres: p.area_acres == null ? null : Math.round(p.area_acres * 10) / 10,
      pasture_type: p.pasture_type,
      tenure: 'owned' as const,
      sort: existing.length + i,
      ...(parseLegalLand(p.legal_description) ?? {}),
    }))
}

/**
 * What the app already holds about the applicant, for a year nobody has
 * answered yet.
 *
 * The page's heading promises forms "filled in with what the app knows", and
 * until now it kept that promise only for the land: with no afsc_mdi_year row
 * every form downloaded blank, and the page listed the business name as
 * missing while farm setup had held it all along.
 *
 * Only facts the farm has already recorded go in here. The identification
 * number, the weather stations, the coverage option and the price per pound
 * are choices nobody has made yet, and an insurance election guessed from a
 * pasture's soil type would be a worse answer than an empty box: those stay
 * blank and the page says they are still needed.
 */
export type MdiFarmFacts = {
  /** Farm setup's farm name — null when the farm has not set one. */
  farmName: string | null
  ranch: { name: string; address: string | null; owner_name: string | null; owner_phone: string | null } | null
}

/**
 * What the farm has on record, for this ranch's forms.
 *
 * farm_setup's name is read straight rather than through useBrand(), which
 * falls back to the shipped app's own name — on a government form a default
 * would be somebody else's business.
 */
export function useMdiFacts(ranchId: string): MdiFarmFacts {
  const { data: setup } = useFarmSetup()
  const { data: ranches } = useRanches()
  return useMemo(() => {
    const r = (ranches ?? []).find((x) => x.id === ranchId)
    return {
      farmName: setup?.farm_name?.trim() || null,
      ranch: r ? { name: r.name, address: r.address, owner_name: r.owner_name, owner_phone: r.owner_phone } : null,
    }
  }, [setup, ranches, ranchId])
}

/** The known facts as a year row, with everything unknown left null. */
export function knownAnswers(facts: MdiFarmFacts): Partial<MdiYear> {
  const trim = (s: string | null | undefined) => (s ?? '').trim() || null
  return {
    business_name: trim(facts.farmName),
    business_address: trim(facts.ranch?.address),
    contact_person: trim(facts.ranch?.owner_name),
    contact_phone: trim(facts.ranch?.owner_phone),
  }
}

/**
 * The year as the forms should see it: what somebody answered, over what the
 * app knows. A saved answer always wins — if Sam typed a different business
 * name on the form, the form keeps it.
 */
export function mergeKnown(
  saved: MdiYear | null,
  facts: MdiFarmFacts,
  cropYear: number,
  ranchId: string,
): MdiYear {
  const known = knownAnswers(facts)
  const out = { ...EMPTY_YEAR, ...known, ...(saved ?? {}), crop_year: cropYear, ranch_id: ranchId } as MdiYear
  // An explicitly blanked answer is an answer; only null and '' fall back.
  for (const k of Object.keys(known) as (keyof MdiYear)[]) {
    const v = saved?.[k]
    if (v == null || v === '') (out as Record<string, unknown>)[k] = known[k] ?? null
  }
  return out
}

const EMPTY_YEAR: MdiYear = {
  crop_year: 0,
  ranch_id: '',
  identification_number: null,
  business_name: null,
  business_address: null,
  gst_bn: null,
  contact_person: null,
  contact_phone: null,
  contact_email: null,
  home_part: null,
  home_section: null,
  home_township: null,
  home_range: null,
  home_meridian: null,
  station_1: null,
  station_2: null,
  station_3: null,
  coverage_option: null,
  price_per_lb: null,
  insure_native: false,
  insure_improved: false,
  insure_bush: false,
  insure_community: false,
  notes: null,
}

/** Which answers the app filled in by itself, for the page to own up to. */
export function filledByApp(merged: MdiYear, saved: MdiYear | null): string[] {
  const out: string[] = []
  const was = (k: keyof MdiYear) => saved?.[k] == null || saved[k] === ''
  if (merged.business_name && was('business_name')) out.push('the business name')
  if (merged.business_address && was('business_address')) out.push('the business address')
  if (merged.contact_person && was('contact_person')) out.push('the contact')
  return out
}

/**
 * The pasture types the ranch's own parcels are, as a suggestion for the
 * dialog's tick boxes. Which types to insure is an election, not a fact, so
 * this only pre-ticks a box a person then looks at and saves — it never
 * reaches a PDF on its own.
 */
export function suggestedTypes(land: MdiLand[]): Pick<MdiYear, 'insure_native' | 'insure_improved' | 'insure_bush' | 'insure_community'> {
  const types = land.map((l) => insuringCropType(l.pasture_type))
  return {
    insure_native: types.includes('Native pasture'),
    insure_improved: types.includes('Improved pasture'),
    insure_bush: types.some((t) => t?.startsWith('Native bush')),
    insure_community: false,
  }
}

type Need = { key: string; label: string; has: (y: MdiYear | null, land: MdiLand[]) => boolean }

/** Every answer the four forms want, and how to tell whether it is there. */
const NEEDS: Need[] = [
  { key: 'id', label: 'the AFSC identification number', has: (y) => !!y?.identification_number },
  { key: 'name', label: 'the business name', has: (y) => !!y?.business_name },
  { key: 'address', label: 'the business address', has: (y) => !!y?.business_address },
  { key: 'home', label: 'the home quarter', has: (y) => !!(y?.home_section && y?.home_township && y?.home_range) },
  { key: 'stations', label: 'at least one weather station', has: (y) => !!y?.station_1 },
  { key: 'option', label: 'a coverage option', has: (y) => !!y?.coverage_option },
  { key: 'price', label: 'a price per pound', has: (y) => y?.price_per_lb != null },
  {
    key: 'types',
    label: 'which pasture types to insure',
    has: (y) => !!(y?.insure_native || y?.insure_improved || y?.insure_bush || y?.insure_community),
  },
  { key: 'land', label: 'the land', has: (_, land) => land.length > 0 },
  {
    key: 'legal',
    label: 'a legal land location on every parcel',
    has: (_, land) => land.length > 0 && land.every((l) => l.section && l.township && l.range),
  },
]

/**
 * What each form is waiting on. The Election needs the stations and the
 * option; the Identification Number form needs the address and the home
 * quarter and neither of the others does, so one list across all four told
 * each form it was missing seven answers when it was missing two.
 */
const FORM_NEEDS: Record<string, string[]> = {
  'mdi-election': ['id', 'name', 'stations', 'option', 'price', 'types'],
  'contract-of-insurance': ['id', 'name'],
  'land-information-appendix': ['id', 'name', 'land', 'legal'],
  'identification-number': ['id', 'name', 'address', 'home'],
}

/** What this one form still needs before it is worth sending. */
export function missingForForm(id: MdiFormId, y: MdiYear | null, land: MdiLand[]): string[] {
  const keys = FORM_NEEDS[id] ?? []
  return NEEDS.filter((n) => keys.includes(n.key) && !n.has(y, land)).map((n) => n.label)
}

/** What the forms still need, across all four. */
export function missingAnswers(y: MdiYear | null, land: MdiLand[]): string[] {
  return NEEDS.filter((n) => !n.has(y, land)).map((n) => n.label)
}
