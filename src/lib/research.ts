/**
 * The research library: folders of papers about what we grow, what we spray
 * and how we water.
 *
 * The papers are PDFs in the private research-library bucket, harvested by
 * scripts/research-harvest.mjs from sources that let us: open.alberta.ca for
 * the provincial work, Europe PMC and DOAJ for the journals. Nothing here is
 * behind a paywall, but not everything free could be downloaded — a paper
 * whose publisher refuses automated requests is kept as a citation with its
 * link, which is what status = 'link_only' means.
 *
 * Ordering is the point of the whole thing. A folder holds anywhere up to 200
 * papers and almost all of them were written somewhere with a different
 * climate, so the default order is by how close to home the work was done:
 * Lethbridge and Vauxhall, then Alberta, then the prairies, then Canada, then
 * the northern plains, then everywhere else.
 *
 * Every folder asks one question before that one: is the paper about this
 * folder's subject at all? A search returns plenty that are not — resistance
 * trials that list our active in a table beside twenty others, knee surgery
 * for a folder whose name contains the word "pivot" — so they go below the
 * papers written about it whatever region they came from.
 * research_paper_about holds the measurement.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type ResearchFolder = Database['public']['Views']['research_folders_v']['Row']

/**
 * A paper as the page needs it.
 *
 * Deliberately the common shape of two sources: a row of research_shelf_v,
 * which knows the folder it is being shown under, and a row of
 * research_papers, which is what a search returns. The folder fields are
 * optional so one component can render either.
 */
export type ResearchPaper = {
  id: string
  folder_id: string
  title: string
  authors: string | null
  year: number | null
  source: string | null
  doi: string | null
  source_url: string | null
  pdf_url: string | null
  storage_path: string | null
  file_bytes: number | null
  pages: number | null
  region: string
  relevance: number
  licence: string | null
  abstract: string | null
  status: string
  fetch_note: string | null
  folder_slug?: string
  folder_name?: string
  /** False when the paper is cross-filed here and lives in another folder. */
  home?: boolean
  /** The paragraph that matched a search, from inside the PDF. */
  passage?: string
  /** Which page that paragraph is on, as "p. 12". */
  passage_pages?: string | null
  /**
   * Whether that paragraph came from the paper itself or only from its
   * abstract. 735 papers are held as a citation we could not download, or as a
   * scan with no text layer, and the abstract is all the app has of them — so
   * a quote from one must say so rather than read like page 4.
   */
  passage_kind?: 'body' | 'abstract'
  /**
   * How much this paper is about this shelf's subject, 4 down to 0. Set on
   * every shelf; null on a search result, which belongs to no shelf. See
   * research_paper_about.
   */
  about?: number | null
  /** How many times the subject is named inside the paper. */
  about_mentions?: number | null
}

/** The columns both the view and the table can give, so neither sends the tsvector. */
const PAPER_COLUMNS =
  'id, folder_id, title, authors, year, source, doi, source_url, pdf_url, storage_path, file_bytes, pages, region, relevance, licence, abstract, status, fetch_note'

/** Nearest to our fields first. The order is the ranking. */
export const REGIONS = [
  'southern_alberta',
  'alberta',
  'prairies',
  'canada',
  'northern_plains',
  'other',
] as const
export type Region = (typeof REGIONS)[number]

export const REGION_LABEL: Record<string, string> = {
  southern_alberta: 'Southern Alberta',
  alberta: 'Alberta',
  prairies: 'Prairies',
  canada: 'Canada',
  northern_plains: 'Northern plains',
  other: 'Elsewhere',
}

/** Close to home is worth saying loudly; the rest is just a label. */
export const REGION_COLOR: Record<string, string> = {
  southern_alberta: 'bg-brand-100 text-brand-800',
  alberta: 'bg-brand-50 text-brand-700',
  prairies: 'bg-blue-50 text-blue-700',
  canada: 'bg-gray-100 text-gray-700',
  northern_plains: 'bg-gray-100 text-gray-700',
  other: 'bg-gray-50 text-gray-500',
}

const rank = (region: string) => {
  const i = (REGIONS as readonly string[]).indexOf(region)
  return i === -1 ? REGIONS.length : i
}

/** The shelves, and the order they are shown in. */
export const SECTIONS = ['crops', 'chemicals', 'irrigation', 'cattle'] as const
export type Section = (typeof SECTIONS)[number]

/** Every folder, with how many papers it holds. */
export function useResearchFolders() {
  return useQuery({
    queryKey: ['research-folders'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_folders_v')
        .select('*')
        .order('sort')
        .order('name')
      if (error) throw error
      return data as ResearchFolder[]
    },
  })
}

/** A folder as the picker shows it: in tree order, with how deep it sits. */
export type PickerFolder = ResearchFolder & {
  depth: number
  /** A grouping row — the Herbicides and Fungicides headings — not a shelf. */
  heading: boolean
}

/**
 * One section's folders, flattened into the order they are read in.
 *
 * The tree is three deep in places and the shape differs by section: a crop
 * has its varieties under it, Chemicals has Herbicides and Fungicides as
 * headings with the active ingredients under those, and Irrigation is flat.
 * Returning a flat list with a depth lets one picker render all three, with a
 * variety indented under its crop rather than sitting beside Buckwheat.
 *
 * The group rows under Chemicals are headings, not shelves: nothing is filed
 * directly on "Herbicides", so it cannot be selected.
 */
export function sectionFolders(
  folders: ResearchFolder[] | undefined,
  section: Section,
): PickerFolder[] {
  if (!folders) return []
  const sectionRow = folders.find((f) => f.slug === section)
  if (!sectionRow) return []

  const children = (parentId: string) =>
    folders
      .filter((f) => f.parent_id === parentId)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  const out: PickerFolder[] = []
  const walk = (parentId: string, depth: number) => {
    for (const f of children(parentId)) {
      // A 'section' row this far down is one of the chemical groups.
      out.push({ ...f, depth, heading: f.kind === 'section' })
      if (depth < 2) walk(f.id, depth + 1)
    }
  }
  walk(sectionRow.id, 0)
  return out
}

/** Everything on one folder's shelf, in the order worth reading it in. */
export function useResearchShelf(folderSlug: string | null) {
  return useQuery({
    queryKey: ['research-shelf', folderSlug],
    enabled: Boolean(folderSlug),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_shelf_v')
        .select(`${PAPER_COLUMNS}, folder_slug, folder_name, home, about, about_mentions`)
        .eq('folder_slug', folderSlug!)
      if (error) throw error
      return sortForUs(data as unknown as ResearchPaper[])
    },
  })
}

/**
 * Is this paper about the folder's subject, or does it only mention it?
 *
 * Three bands, not five grades, because the grade is a finer thing than the
 * ordering should be: "named in the title" and "named in the abstract" are
 * both papers about the subject and both deserve to be sorted by how close to
 * home the work was done, which is the whole premise of the library. What must
 * not happen is a trial that lists it in one table outranking a paper written
 * about it.
 *
 * null — a search result, which sits on no shelf — lands in the middle band,
 * so the ordering falls straight through to region.
 */
const aboutBand = (paper: ResearchPaper) => {
  if (paper.about == null) return 1
  if (paper.about >= 3) return 2 // named in the title or the abstract
  if (paper.about >= 1) return 1 // named somewhere inside
  return 0 // never named: a mis-filing
}

/**
 * About this subject first, then nearest, then the paper others lean on, then
 * the recent one.
 *
 * Relevance is already mostly region, so it breaks ties within a region rather
 * than deciding between them. It comes behind how much the paper is about the
 * subject, because relevance was set when the paper was discovered, by a
 * heuristic with no idea which of the twenty chemicals in a resistance trial —
 * or which of the crops in an Alberta weed-control sheet — the folder was
 * asking about.
 */
export function sortForUs(papers: ResearchPaper[]) {
  return [...papers].sort(
    (a, b) =>
      aboutBand(b) - aboutBand(a) ||
      rank(a.region) - rank(b.region) ||
      (b.about ?? 0) - (a.about ?? 0) ||
      (b.about_mentions ?? 0) - (a.about_mentions ?? 0) ||
      b.relevance - a.relevance ||
      (b.year ?? 0) - (a.year ?? 0) ||
      a.title.localeCompare(b.title),
  )
}

/**
 * Search every folder at once — the citations and the papers themselves.
 *
 * Two searches, merged. The first is Postgres full text over title, authors,
 * journal and abstract, which is how you find a paper you half remember. The
 * second is research_search, which reads the text inside the PDFs and hands
 * back the paragraph that matched, which is how you find out what the shelf
 * actually says about petal-stage timing.
 *
 * Both are needed: a title search misses what is only said on page 12, and a
 * text search misses the papers whose PDF is a scan with no text layer, or
 * that we hold only as a citation.
 *
 * websearch_to_tsquery on both, so quoting a phrase and typing OR work the way
 * anyone would expect.
 */
export function useResearchSearch(term: string) {
  const query = term.trim()
  return useQuery({
    queryKey: ['research-search', query],
    enabled: query.length > 2,
    queryFn: async () => {
      const [byCitation, byText] = await Promise.all([
        supabase
          .from('research_papers')
          .select(PAPER_COLUMNS)
          .textSearch('fts', query, { type: 'websearch', config: 'english' })
          .limit(200),
        supabase.rpc('research_search', { q: query, max_rows: 40 }),
      ])
      if (byCitation.error) throw byCitation.error
      if (byText.error) throw byText.error

      const papers = new Map<string, ResearchPaper>()
      for (const p of (byCitation.data ?? []) as unknown as ResearchPaper[]) papers.set(p.id, p)

      const passages = (byText.data ?? []) as {
        paper_id: string
        passage: string
        pages: string | null
        kind: 'body' | 'abstract'
      }[]
      const missing = passages.map((h) => h.paper_id).filter((id) => !papers.has(id))
      if (missing.length) {
        // A passage hit whose paper the citation search did not return: fetch
        // the rest of its row, so the result can be opened like any other.
        const { data, error } = await supabase
          .from('research_papers')
          .select(PAPER_COLUMNS)
          .in('id', missing)
        if (error) throw error
        for (const p of (data ?? []) as unknown as ResearchPaper[]) papers.set(p.id, p)
      }

      // Order by how well each paper answers the question, NOT by sortForUs:
      // that sorts by region first, which is right for a folder, where every
      // paper is already on the subject, and wrong for a search, where it put
      // every southern Alberta paper above the one that actually said the
      // words. research_search has already weighted region into its own rank.
      const ranked: ResearchPaper[] = []
      for (const h of passages) {
        const p = papers.get(h.paper_id)
        if (!p) continue
        p.passage = h.passage
        p.passage_pages = h.pages
        p.passage_kind = h.kind ?? 'body'
        ranked.push(p)
        papers.delete(h.paper_id)
      }
      // Then the papers whose title, journal or abstract matched but whose
      // text did not — or that have no text to search. Nearest first, since
      // nothing else distinguishes them.
      return [...ranked, ...sortForUs([...papers.values()]).slice(0, 40)]
    },
  })
}

/**
 * Open a paper.
 *
 * A stored PDF is in a private bucket, so it needs a signed link, good for an
 * hour. A link_only paper has no file here and opens at its publisher.
 */
export async function paperUrl(paper: {
  storage_path: string | null
  source_url: string | null
  pdf_url?: string | null
}) {
  if (!paper.storage_path) return paper.source_url ?? paper.pdf_url
  const { data, error } = await supabase.storage
    .from('research-library')
    .createSignedUrl(paper.storage_path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

/** "12 pages · 1.4 MB", leaving out whichever we do not know. */
export function paperSize(paper: ResearchPaper) {
  const bits: string[] = []
  if (paper.pages) bits.push(`${paper.pages} page${paper.pages === 1 ? '' : 's'}`)
  if (paper.file_bytes) bits.push(`${(paper.file_bytes / 1_048_576).toFixed(1)} MB`)
  return bits.join(' · ')
}

/** How much of the library is actually here, for the page's one line of subtitle. */
export function useResearchTotals() {
  return useQuery({
    // Version 3 because the shape grew again. The app keeps its query cache
    // across loads, so an older answer comes back from storage and a field it
    // never had reads undefined — which the Gaps tab once added into a NaN. A
    // new key is the whole fix: changing a cached query's shape means changing
    // its key.
    queryKey: ['research-totals', 3],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const stored = await papersCount().eq('status', 'stored')
      if (stored.error) throw stored.error
      const near = await papersCount()
        .eq('status', 'stored')
        .in('region', ['southern_alberta', 'alberta'])
      if (near.error) throw near.error
      // Papers we hold only as a citation, and PDFs that turned out to be
      // scans with no text layer: what the library does not have a file for,
      // which the Gaps tab says out loud.
      const linkOnly = await papersCount().eq('status', 'link_only')
      if (linkOnly.error) throw linkOnly.error
      const noText = await papersCount().eq('text_status', 'no_text')
      if (noText.error) throw noText.error
      // How much of the library the search can actually read, counted from
      // the chunks rather than from text_status, because the chunks are what
      // it reads. A paper with no file still answers from its abstract.
      const coverage = await supabase.rpc('research_text_coverage').single()
      if (coverage.error) throw coverage.error
      return {
        stored: stored.count ?? 0,
        alberta: near.count ?? 0,
        linkOnly: linkOnly.count ?? 0,
        noText: noText.count ?? 0,
        fullText: coverage.data?.full_text ?? 0,
        abstractOnly: coverage.data?.abstract_only ?? 0,
        noTextAtAll: coverage.data?.nothing ?? 0,
      }
    },
  })
}

/** A head-only count of research_papers, for the figures in the two headers. */
const papersCount = () =>
  supabase.from('research_papers').select('id', { count: 'exact', head: true })

/**
 * What the library is short of.
 *
 * The count of papers on a shelf says nothing on its own: 233 on wheat, which
 * is one year of the five-year plan, against 125 on alfalfa hay, which is all
 * five. research_gaps_v puts each shelf beside what we actually do with that
 * crop or that chemical, so the next harvest can be aimed rather than guessed.
 */
export type ResearchGap = Database['public']['Views']['research_gaps_v']['Row']

export function useResearchGaps() {
  return useQuery({
    queryKey: ['research-gaps'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('research_gaps_v').select('*')
      if (error) throw error
      return data as ResearchGap[]
    },
  })
}

/** Crops in the rotation plan that no folder claims. Normally none. */
export function useUnfiledCrops() {
  return useQuery({
    queryKey: ['research-unfiled-crops'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_unfiled_crops_v')
        .select('*')
        .order('acres', { ascending: false })
      if (error) throw error
      return data as Database['public']['Views']['research_unfiled_crops_v']['Row'][]
    },
  })
}

/**
 * Which of the three shelves a gap row belongs to, so a row can be clicked
 * through to the folder itself. A variety sits under its crop, and the two
 * sorts of topic are told apart by their parent.
 */
export function gapSection(row: Pick<ResearchGap, 'kind' | 'parent_slug'>): Section {
  if (row.kind === 'crop' || row.kind === 'variety') return 'crops'
  if (row.parent_slug === 'irrigation') return 'irrigation'
  return 'chemicals'
}

/**
 * The chemicals we actually spray, most-sprayed first.
 *
 * Only the ones with a spray record: a folder exists for every active on the
 * farm's product list, but a product bought and not yet used says nothing
 * about what to read next. Ties go to the one with least nearby work.
 */
export function sprayGaps(rows: ResearchGap[] | undefined): ResearchGap[] {
  return (rows ?? [])
    .filter((r) => r.kind === 'chemical' && (r.passes ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.passes ?? 0) - (a.passes ?? 0) || a.near - b.near || a.name.localeCompare(b.name),
    )
}

/**
 * The crops, most acres first.
 *
 * A crop with no acres in the plan goes last rather than first: Spinach seed
 * and Grass seed are recorded as custom crops and carry no planned acres, so
 * a null means we do not know, not that we do not grow it.
 */
export function cropGaps(rows: ResearchGap[] | undefined): ResearchGap[] {
  return (rows ?? [])
    .filter((r) => r.kind === 'crop')
    .sort((a, b) => {
      if ((a.acres == null) !== (b.acres == null)) return a.acres == null ? 1 : -1
      return (b.acres ?? 0) - (a.acres ?? 0) || a.papers - b.papers
    })
}

/** Under this many papers, a shelf cannot answer much. */
export const THIN_SHELF = 10

/**
 * The shelves to fill next: too few papers, or nothing written anywhere near
 * here. Emptiest first, so the top of the list is where to start.
 */
export function thinShelves(rows: ResearchGap[] | undefined): ResearchGap[] {
  return (rows ?? [])
    .filter((r) => r.papers < THIN_SHELF || r.near === 0)
    .sort((a, b) => a.papers - b.papers || a.near - b.near || a.name.localeCompare(b.name))
}

// ---- the figures in the papers --------------------------------------------

/**
 * One figure lifted out of one passage: the threshold, the rate, the stage.
 *
 * Hand-written rather than taken from the generated types because the view is
 * a straight join and this is the shape the page wants, in one place where the
 * comments can say what each field is for.
 */
export type ResearchNumber = {
  id: string
  paper_id: string
  page: number | null
  measure: string
  /** What it is about, in the paper's words: 'flea beetle', 'canola'. */
  subject: string
  /** Our own crop name, where the paper's folder already named one. */
  crop_name: string | null
  /** Our own active ingredient, same rule. */
  active: string | null
  value_low: number | null
  value_high: number | null
  unit: string | null
  /** The condition it holds under. Without it the number means the wrong thing. */
  qualifier: string | null
  /** The sentence it came from, copied from the paper. The proof. */
  passage: string
  confidence: number
  /**
   * 'rejected' means the reading is wrong — a defect to go and fix.
   * 'not_for_us' means the reading is right and this farm does not do that.
   * Keeping them apart is the only way either signal is worth anything.
   */
  status: 'unreviewed' | 'confirmed' | 'rejected' | 'not_for_us'
  review_note: string | null
  created_at: string
  title: string | null
  authors: string | null
  year: number | null
  source: string | null
  doi: string | null
  region: string | null
  storage_path: string | null
  source_url: string | null
}

/** The figures the extraction has found, the ones worth judging first in front. */
export function useResearchNumbers(status: ResearchNumber['status'], measure: string | null) {
  return useQuery({
    queryKey: ['research-numbers', status, measure],
    queryFn: async () => {
      let q = supabase
        .from('research_numbers_v')
        .select('*')
        .eq('status', status)
        // The list is longer than anyone goes through in one sitting, and only
        // the first 400 come back, so its order decides which figures get
        // looked at at all. judge_rank puts a named crop first, then the
        // nearest work, then the readings that were sure of themselves.
        .order('judge_rank', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(400)
      if (measure) q = q.eq('measure', measure)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as ResearchNumber[]
    },
  })
}

/** How many are waiting, confirmed and rejected — the header, and the progress. */
export function useNumberCounts() {
  return useQuery({
    queryKey: ['research-number-counts'],
    staleTime: 30_000,
    queryFn: async () => {
      const count = (status: string) =>
        supabase.from('research_numbers').select('id', { count: 'exact', head: true }).eq('status', status)
      const [waiting, confirmed, rejected, notForUs] = await Promise.all([
        count('unreviewed'),
        count('confirmed'),
        count('rejected'),
        count('not_for_us'),
      ])
      for (const r of [waiting, confirmed, rejected, notForUs]) if (r.error) throw r.error
      return {
        waiting: waiting.count ?? 0,
        confirmed: confirmed.count ?? 0,
        rejected: rejected.count ?? 0,
        not_for_us: notForUs.count ?? 0,
      }
    },
  })
}

/** Which measures actually have figures, so the filter offers only those. */
export function useNumberMeasures() {
  return useQuery({
    queryKey: ['research-number-measures'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_numbers')
        .select('measure, status')
        .limit(2000)
      if (error) throw error
      const byMeasure = new Map<string, { waiting: number; confirmed: number }>()
      for (const r of (data ?? []) as { measure: string; status: string }[]) {
        const seen = byMeasure.get(r.measure) ?? { waiting: 0, confirmed: 0 }
        if (r.status === 'unreviewed') seen.waiting += 1
        if (r.status === 'confirmed') seen.confirmed += 1
        byMeasure.set(r.measure, seen)
      }
      return [...byMeasure].sort(
        (a, b) => b[1].waiting + b[1].confirmed - (a[1].waiting + a[1].confirmed),
      )
    },
  })
}

/**
 * Confirm or reject one figure.
 *
 * The app reads only confirmed rows, so this is the gate: nothing a model read
 * reaches a decision page until a manager has looked at the passage beside it.
 */
export function useReviewNumber() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; status: ResearchNumber['status']; note?: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      // Putting one back means it was never judged, so the judgement goes too.
      const judged = v.status !== 'unreviewed'
      const { error } = await supabase
        .from('research_numbers')
        .update({
          status: v.status,
          reviewed_by: judged ? (user?.id ?? null) : null,
          reviewed_at: judged ? new Date().toISOString() : null,
          ...(v.note ? { review_note: v.note } : {}),
        })
        .eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['research-numbers'] })
      void qc.invalidateQueries({ queryKey: ['research-number-counts'] })
      void qc.invalidateQueries({ queryKey: ['research-number-measures'] })
    },
  })
}

/**
 * Set a reading pass going.
 *
 * A background function answers 202 at once and then reads for a few minutes, so
 * there is no result to await — the counts are re-checked a few times instead,
 * which is what the page shows climbing. Press it again for the next batch.
 */
export function useReadNumbers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { limit?: number } = {}) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/research-numbers-background', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(v),
      })
      if (res.status === 202 || res.ok) return { started: true }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Could not start (${res.status})`)
    },
    onSuccess: () => {
      for (const ms of [15_000, 45_000, 120_000, 300_000]) {
        setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ['research-number-counts'] })
          void qc.invalidateQueries({ queryKey: ['research-numbers'] })
          void qc.invalidateQueries({ queryKey: ['research-number-measures'] })
        }, ms)
      }
    },
  })
}

/** "15–20 kg/ha", "40 days" — one figure as a person reads it. */
export function sayFigure(n: Pick<ResearchNumber, 'value_low' | 'value_high' | 'unit'>) {
  const { value_low: low, value_high: high, unit } = n
  const u = unit ? ` ${unit}` : ''
  if (low === null && high === null) return unit ?? '—'
  if (high === null || high === low) return `${low}${u}`
  return `${low}–${high}${u}`
}

/**
 * Open the paper in a new tab: a signed link for ours, the publisher's for the
 * rest.
 *
 * A paper we hold is in a private bucket, so its link has to be signed first,
 * and that is a round trip — by the time it lands the browser no longer counts
 * this as the user's own click and blocks the new tab, which looks exactly
 * like a row that does nothing. So the tab is opened while the click still
 * counts and pointed at the file once the link arrives. A paper we only have a
 * citation for needs no signing and opens on the click itself.
 */
export async function openPaper(paper: {
  storage_path: string | null
  source_url: string | null
  pdf_url?: string | null
}) {
  if (!paper.storage_path) {
    const link = paper.source_url ?? paper.pdf_url
    if (link) window.open(link, '_blank', 'noopener')
    return
  }
  const tab = window.open('about:blank', '_blank')
  try {
    const url = await paperUrl(paper)
    if (!url) {
      tab?.close()
      return
    }
    // Popups turned off: better the same tab than a click that does nothing.
    if (tab) tab.location.replace(url)
    else window.location.assign(url)
  } catch (e) {
    tab?.close()
    throw e
  }
}
