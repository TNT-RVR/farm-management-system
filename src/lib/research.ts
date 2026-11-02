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
 */
import { useQuery } from '@tanstack/react-query'
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

/** The three shelves, and the order they are shown in. */
export const SECTIONS = ['crops', 'chemicals', 'irrigation'] as const
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

/** Everything on one folder's shelf, nearest-to-home first. */
export function useResearchShelf(folderSlug: string | null) {
  return useQuery({
    queryKey: ['research-shelf', folderSlug],
    enabled: Boolean(folderSlug),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_shelf_v')
        .select(`${PAPER_COLUMNS}, folder_slug, folder_name, home`)
        .eq('folder_slug', folderSlug!)
      if (error) throw error
      return sortForUs(data as unknown as ResearchPaper[])
    },
  })
}

/**
 * Nearest first, then the paper others lean on, then the recent one.
 *
 * Relevance is already mostly region, so it breaks ties within a region rather
 * than deciding between them.
 */
export function sortForUs(papers: ResearchPaper[]) {
  return [...papers].sort(
    (a, b) =>
      rank(a.region) - rank(b.region) ||
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

      const passages = (byText.data ?? []) as { paper_id: string; passage: string; pages: string | null }[]
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
export async function paperUrl(paper: ResearchPaper) {
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
    queryKey: ['research-totals'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const stored = await supabase
        .from('research_papers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'stored')
      if (stored.error) throw stored.error
      const near = await supabase
        .from('research_papers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'stored')
        .in('region', ['southern_alberta', 'alberta'])
      if (near.error) throw near.error
      return { stored: stored.count ?? 0, alberta: near.count ?? 0 }
    },
  })
}
