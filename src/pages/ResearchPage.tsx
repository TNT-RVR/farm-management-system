import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, ExternalLink, FileText, Link2, Search } from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { CardList, RowCard } from '@/components/RowCards'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { TABLE_HEAD } from '@/lib/table-style'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useTab } from '@/lib/useTab'
import { cn } from '@/lib/utils'
import {
  paperSize,
  paperUrl,
  REGION_COLOR,
  REGION_LABEL,
  sectionFolders,
  useResearchFolders,
  useResearchSearch,
  useResearchShelf,
  useResearchTotals,
  type ResearchPaper,
  type Section,
} from '@/lib/research'

const TABS = [
  { key: 'crops', label: 'Crops' },
  { key: 'chemicals', label: 'Chemicals' },
  { key: 'irrigation', label: 'Irrigation' },
  { key: 'search', label: 'Search all' },
] as const
type Tab = (typeof TABS)[number]['key']

/**
 * Open the paper in a new tab: a signed link for ours, the publisher's for
 * the rest.
 *
 * A paper we hold is in a private bucket, so its link has to be signed first,
 * and that is a round trip — by the time it lands the browser no longer counts
 * this as the user's own click and blocks the new tab, which looks exactly
 * like a row that does nothing. So the tab is opened while the click still
 * counts and pointed at the file once the link arrives. A paper we only have a
 * citation for needs no signing and opens on the click itself.
 */
async function openPaper(paper: ResearchPaper) {
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

function RegionBadge({ region }: { region: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
        REGION_COLOR[region] ?? REGION_COLOR.other,
      )}
    >
      {REGION_LABEL[region] ?? region}
    </span>
  )
}

/** The citation under a title: who, where and when, as one line. */
function cite(p: ResearchPaper) {
  return [p.authors?.split(', ').slice(0, 3).join(', '), p.source, p.year]
    .filter(Boolean)
    .join(' · ')
}

function PaperRows({
  papers,
  isLoading,
  folderNames,
}: {
  papers: ResearchPaper[] | undefined
  isLoading: boolean
  /** Folder name by id, for the search results, which are not folder-scoped. */
  folderNames?: Map<string, string>
}) {
  if (isLoading) return <p className="px-1 py-6 text-sm text-gray-400">Looking…</p>
  if (!papers?.length) return <p className="px-1 py-6 text-sm text-gray-400">Nothing here yet.</p>

  return (
    <>
      {/* Phone: one card a paper. */}
      <CardList>
        {papers.map((p) => (
          <RowCard
            key={`${p.folder_slug ?? ''}${p.id}`}
            heading={
              <span className="flex items-start gap-1.5">
                {p.status === 'stored' ? (
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                ) : (
                  <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                )}
                <span>{p.title}</span>
              </span>
            }
            onClick={() => void openPaper(p)}
            facts={[
              { label: 'Where', node: <RegionBadge region={p.region} /> },
              { label: 'Paper', node: cite(p) || '—' },
              ...(folderNames
                ? [{ label: 'Folder', node: folderNames.get(p.folder_id) ?? '—' }]
                : []),
              {
                label: p.status === 'stored' ? 'File' : 'Not held',
                node: p.status === 'stored' ? paperSize(p) || 'PDF' : 'Opens at the publisher',
              },
            ]}
          />
        ))}
      </CardList>

      {/* Desktop: a table, because the point is scanning down the Where column. */}
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className={TABLE_HEAD}>
            <th className="px-3 py-2 text-left font-medium">Paper</th>
            <th className="px-3 py-2 text-left font-medium">Where it was done</th>
            {folderNames && <th className="px-3 py-2 text-left font-medium">Folder</th>}
            <th className="px-3 py-2 text-right font-medium">Pages</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {papers.map((p) => (
            <tr
              key={`${p.folder_slug ?? ''}${p.id}`}
              onClick={() => void openPaper(p)}
              className="cursor-pointer align-top hover:bg-gray-50"
            >
              <td className="px-3 py-2">
                <div className="flex items-start gap-1.5 font-medium text-gray-900">
                  {p.status === 'stored' ? (
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                  ) : (
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  )}
                  <span>{p.title}</span>
                  {p.home === false && (
                    <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-1.5 text-[11px] text-gray-500">
                      also filed here
                    </span>
                  )}
                </div>
                <div className="pl-5 text-xs text-gray-500">{cite(p)}</div>
                {/* What the paper actually says, where the words were found. */}
                {p.passage && (
                  <p className="mt-1 border-l-2 border-gray-200 py-0.5 pl-2 text-xs italic text-gray-600">
                    …{p.passage}…
                    {p.passage_pages && <span className="not-italic text-gray-400"> {p.passage_pages}</span>}
                  </p>
                )}
              </td>
              <td className="px-3 py-2">
                <RegionBadge region={p.region} />
              </td>
              {folderNames && (
                <td className="px-3 py-2 text-xs text-gray-600">
                  {folderNames.get(p.folder_id) ?? '—'}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">
                {p.status === 'stored' ? (paperSize(p) || 'PDF') : 'Link only'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** One section: pick a folder, read its shelf. */
function Shelf({ section }: { section: Section }) {
  const { data: folders } = useResearchFolders()
  const all = useMemo(() => sectionFolders(folders, section), [folders, section])
  /** Only the shelves can be chosen; the group rows are headings. */
  const list = useMemo(() => all.filter((f) => !f.heading), [all])
  const [picked, setPicked] = useState<string | null>(null)
  // Opens on the fullest folder rather than on nothing, so the page says
  // something the moment it loads. Derived rather than set in an effect, so
  // there is one render and no flash of an empty shelf.
  const fullest = useMemo(
    () => [...list].sort((a, b) => Number(b.papers_below) - Number(a.papers_below))[0]?.slug ?? null,
    [list],
  )
  const slug = picked ?? fullest
  const setSlug = setPicked

  const { data: papers, isLoading } = useResearchShelf(slug)
  const folder = list.find((f) => f.slug === slug)

  return (
    <div className="mt-3 gap-4 lg:flex">
      {/* Phone and tablet: a select. Desktop: the whole shelf list beside it. */}
      <div className="lg:hidden">
        <Select
          value={slug ?? ''}
          onChange={setSlug}
          ariaLabel="Folder"
          options={list.map((f) => ({
            value: f.slug,
            // A select cannot indent, so a variety is named under its crop.
            label: `${'— '.repeat(f.depth)}${f.name} (${f.papers_below})`,
          }))}
        />
      </div>

      <nav className="hidden w-64 shrink-0 lg:block">
        <ul>
          {all.map((f) =>
            f.heading ? (
              <li
                key={f.slug}
                className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
              >
                {f.name}
              </li>
            ) : (
              <li key={f.slug}>
                <button
                  type="button"
                  onClick={() => setSlug(f.slug)}
                  style={{ paddingLeft: 8 + f.depth * 14 }}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-2 rounded py-1 pr-2 text-left text-sm',
                    f.slug === slug
                      ? 'bg-brand-50 font-medium text-brand-800'
                      : 'text-gray-700 hover:bg-gray-50',
                    // A variety with nothing in it is still worth showing — it
                    // says the folder exists and is empty — but quietly.
                    Number(f.papers_below) === 0 && f.slug !== slug && 'text-gray-400',
                  )}
                >
                  <span className="min-w-0 flex-auto truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-gray-400">{f.papers_below}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </nav>

      <div className="min-w-0 flex-1">
        {folder?.note && <p className="mb-2 mt-3 text-xs text-gray-500 lg:mt-0">{folder.note}</p>}
        <PaperRows papers={papers} isLoading={isLoading} />
      </div>
    </div>
  )
}

function SearchAll() {
  // ?q= so a link can carry the search: Ask the app ends an answer with one,
  // which reopens the library on the paper it quoted.
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const searched = useDebouncedValue(term, 250)

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (searched.trim()) next.set('q', searched.trim())
    else next.delete('q')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [searched, params, setParams])

  const { data: papers, isLoading } = useResearchSearch(searched)
  const { data: folders } = useResearchFolders()
  const folderNames = useMemo(
    () => new Map((folders ?? []).map((f) => [f.id, f.name])),
    [folders],
  )

  return (
    <div className="mt-3">
      <label className="relative block max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="sclerotinia timing, deficit irrigation, kochia…"
          className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm"
        />
      </label>
      <HelpNote summary="Searches inside the papers, not just their titles." className="mt-1.5">
        <p>
          Every title and abstract, and the text inside each PDF we hold, so a sentence on page 12
          is findable. Where the words were found inside a paper, the paragraph is shown under it
          with its page.
        </p>
        <p className="mt-1.5">
          Quote a phrase to keep its words together — &ldquo;white mould&rdquo; — and put OR
          between words to match either. Nearest work first, whichever folder it sits in.
        </p>
      </HelpNote>
      {searched.trim().length > 2 ? (
        <PaperRows papers={papers} isLoading={isLoading} folderNames={folderNames} />
      ) : (
        <p className="px-1 py-6 text-sm text-gray-400">Type a few words.</p>
      )}
    </div>
  )
}

export function ResearchPage() {
  const [tab, setTab] = useTab<Tab>(
    'research',
    TABS.map((t) => t.key),
  )
  const { data: totals } = useResearchTotals()

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <BookOpen className="h-5 w-5 text-brand-700" /> Research
        </h1>
        <p className="text-xs text-gray-500">
          {totals
            ? `${totals.stored.toLocaleString('en-CA')} papers on our crops, chemicals and water. ${totals.alberta} from Alberta.`
            : 'Papers on our crops, chemicals and water.'}
        </p>
      </div>

      <HelpNote summary="Nearest work first in every folder." className="mb-2">
        <p>
          Each folder is ordered by where the work was done — Lethbridge and Vauxhall, then
          Alberta, then the prairies, then Canada and the northern states, then everywhere else.
          The badge in the Where column says which.
        </p>
        <p className="mt-1.5">
          A <ExternalLink className="inline h-3 w-3" /> grey row is a paper we could not download:
          it is free to read, but its publisher refuses anything that is not a person at a browser,
          so it opens at their site instead. Everything else is a PDF held here.
        </p>
      </HelpNote>

      <PillTabs tabs={TABS} value={tab} onChange={setTab} />

      {/* Keyed by section so switching tabs starts on that shelf's fullest
          folder rather than keeping the last one, which is in another section. */}
      {tab === 'search' ? <SearchAll /> : <Shelf key={tab} section={tab} />}
    </div>
  )
}
