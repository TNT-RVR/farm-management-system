import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, ExternalLink, FileText, Link2, Search } from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { CardList, RowCard } from '@/components/RowCards'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { TABLE_HEAD } from '@/lib/table-style'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { useTab } from '@/lib/useTab'
import { cn } from '@/lib/utils'
import {
  cropGaps,
  gapSection,
  openPaper,
  paperSize,
  REGION_COLOR,
  REGION_LABEL,
  sectionFolders,
  sprayGaps,
  thinShelves,
  useResearchFolders,
  useResearchGaps,
  useResearchSearch,
  useResearchShelf,
  useResearchTotals,
  useUnfiledCrops,
  type ResearchGap,
  type ResearchPaper,
  type Section,
} from '@/lib/research'

/** Manager-only, and the heaviest panel here, so it loads when it is opened. */
const ResearchNumbers = lazyWithRetry(() => import('./research/ResearchNumbers'))

const TABS = [
  { key: 'crops', label: 'Crops' },
  { key: 'chemicals', label: 'Chemicals' },
  { key: 'irrigation', label: 'Irrigation' },
  { key: 'cattle', label: 'Cattle' },
  { key: 'search', label: 'Search all' },
] as const
/**
 * What the library is missing is a question about buying and harvesting more,
 * and it reads the rotation plan and the spray records to answer it, so it is
 * shown to managers only.
 */
const GAPS_TAB = { key: 'gaps', label: 'Gaps' } as const
/**
 * The figures read out of the papers, waiting to be confirmed. Managers only:
 * confirming one is what lets the rest of the app use it.
 */
const NUMBERS_TAB = { key: 'numbers', label: 'Numbers' } as const
type Tab = (typeof TABS)[number]['key'] | typeof GAPS_TAB.key | typeof NUMBERS_TAB.key

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

/**
 * Why a paper is sitting this far down the shelf: it names the folder's
 * subject somewhere inside but was not written about it, or never names it at
 * all. The two are worth telling apart — the second one is a mis-filing.
 *
 * On the citation line rather than beside the title, because it is true of
 * more than half the papers on some shelves and a tag up there would squeeze
 * every title into a column two words wide. Nothing is shown on a search
 * result, which sits on no shelf and so has no subject to be about.
 */
function MentionsOnly({ paper }: { paper: ResearchPaper }) {
  if (paper.about == null || paper.about > 1) return null
  return (
    <span className="text-gray-400">
      {paper.about === 0 ? ' · does not name it' : ' · mentions it only'}
    </span>
  )
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
              {
                label: 'Paper',
                node: (
                  <>
                    {cite(p) || '—'}
                    <MentionsOnly paper={p} />
                  </>
                ),
              },
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
                <div className="pl-5 text-xs text-gray-500">
                  {cite(p)}
                  <MentionsOnly paper={p} />
                </div>
                {/* What the paper actually says, where the words were found. */}
                {p.passage && (
                  <p className="mt-1 border-l-2 border-gray-200 py-0.5 pl-2 text-xs italic text-gray-600">
                    …{p.passage}…
                    {p.passage_pages && <span className="not-italic text-gray-400"> {p.passage_pages}</span>}
                    {/* We do not hold this paper, only its abstract. Saying so
                        is the difference between a quote and a summary. */}
                    {p.passage_kind === 'abstract' && (
                      <span className="not-italic text-gray-400"> from the abstract only</span>
                    )}
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
  // Which folder is open lives in ?folder=, so the Gaps tab can send someone
  // straight to a thin shelf and so a link says what it opens. A slug left
  // over from another section is ignored rather than showing an empty shelf.
  const [params, setParams] = useSearchParams()
  const asked = params.get('folder')
  // Opens on the fullest folder rather than on nothing, so the page says
  // something the moment it loads. Derived rather than set in an effect, so
  // there is one render and no flash of an empty shelf.
  const fullest = useMemo(
    () => [...list].sort((a, b) => Number(b.papers_below) - Number(a.papers_below))[0]?.slug ?? null,
    [list],
  )
  const slug = asked && list.some((f) => f.slug === asked) ? asked : fullest
  const setSlug = (next: string) => {
    const p = new URLSearchParams(params)
    p.set('folder', next)
    setParams(p, { replace: true })
  }

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

/** One figure column of a gaps table. */
type GapCol = {
  label: string
  node: (r: ResearchGap) => React.ReactNode
  /** Right-aligned, as figures should be. */
  figure?: boolean
}

/**
 * How many papers on this shelf were written somewhere whose numbers carry —
 * Canada or the northern states. None is the thing worth seeing.
 */
function NearCount({ n }: { n: number }) {
  return (
    <span
      className={cn(
        'tabular-nums',
        n === 0 ? 'font-semibold text-red-600' : n < 5 ? 'text-amber-700' : 'text-gray-700',
      )}
    >
      {n}
    </span>
  )
}

function GapRows({
  rows,
  head,
  cols,
  empty,
  open,
}: {
  rows: ResearchGap[]
  head: string
  cols: GapCol[]
  empty: string
  open: (r: ResearchGap) => void
}) {
  if (!rows.length) return <p className="px-1 py-4 text-sm text-gray-400">{empty}</p>
  return (
    <>
      <CardList>
        {rows.map((r) => (
          <RowCard
            key={r.slug}
            heading={r.name}
            onClick={() => open(r)}
            facts={cols.map((c) => ({ label: c.label, node: c.node(r) }))}
          />
        ))}
      </CardList>

      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className={TABLE_HEAD}>
            <th className="px-3 py-2 text-left font-medium">{head}</th>
            {cols.map((c) => (
              <th
                key={c.label}
                className={cn('px-3 py-2 font-medium', c.figure ? 'text-right' : 'text-left')}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.slug} onClick={() => open(r)} className="cursor-pointer hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
              {cols.map((c) => (
                <td
                  key={c.label}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-gray-700',
                    c.figure && 'text-right tabular-nums',
                  )}
                >
                  {c.node(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/**
 * What the library is short of, set against what we actually grow and spray.
 *
 * Three questions, in the order they are worth asking: what do we spray most
 * and hold least on, which crops carry the acres, and which shelves are too
 * thin to answer anything. Clicking a row opens that shelf.
 */
function Gaps() {
  const [params, setParams] = useSearchParams()
  const { data: rows, isLoading } = useResearchGaps()
  const { data: unfiled } = useUnfiledCrops()
  const { data: totals } = useResearchTotals()

  const sprays = useMemo(() => sprayGaps(rows), [rows])
  const crops = useMemo(() => cropGaps(rows), [rows])
  const thin = useMemo(() => thinShelves(rows), [rows])

  const open = (r: ResearchGap) => {
    const next = new URLSearchParams(params)
    next.set('tab', gapSection(r))
    next.set('folder', r.slug)
    next.delete('q')
    setParams(next)
  }

  const papers: GapCol = { label: 'Papers', node: (r) => r.papers, figure: true }
  const near: GapCol = { label: 'Near here', node: (r) => <NearCount n={r.near} />, figure: true }
  const newest: GapCol = { label: 'Newest', node: (r) => r.newest ?? '—', figure: true }
  // The years the rotation plan covers, so the acres column says which years
  // it is adding up rather than making the reader guess.
  const planned = (rows ?? []).filter((r) => r.plan_from != null)
  const span = planned.length
    ? {
        from: Math.min(...planned.map((r) => r.plan_from!)),
        to: Math.max(...planned.map((r) => r.plan_to!)),
      }
    : null

  if (isLoading) return <p className="px-1 py-6 text-sm text-gray-400">Looking…</p>

  return (
    <div className="mt-3 space-y-4">
      <HelpNote summary="What to harvest next, not what we have." className="mb-1">
        <p>
          A paper count means nothing on its own. These three tables put each shelf beside what we
          do with it — the passes we sprayed, the acres in the rotation plan — so the thin ones
          show up.
        </p>
        <p className="mt-1.5">
          <strong>Near here</strong> counts the papers written in Canada or the northern states,
          whose rates and timings carry to our fields. Red means none do. Click any row to open
          that shelf.
        </p>
      </HelpNote>

      <section>
        <h2 className="px-1 pb-1 text-sm font-semibold text-gray-900">
          What we spray, and what we hold on it
        </h2>
        <GapRows
          rows={sprays}
          head="Active ingredient"
          empty="No spray records to match against the shelves."
          open={open}
          cols={[
            { label: 'Passes', node: (r) => r.passes ?? '—', figure: true },
            {
              label: 'Last used',
              node: (r) => r.last_applied?.slice(0, 4) ?? '—',
              figure: true,
            },
            papers,
            near,
            newest,
          ]}
        />
      </section>

      <section>
        <h2 className="px-1 pb-1 text-sm font-semibold text-gray-900">
          What we grow, and what we hold on it
        </h2>
        <GapRows
          rows={crops}
          head="Crop"
          empty="No crops yet."
          open={open}
          cols={[
            {
              label: span ? `Acres ${span.from}–${String(span.to).slice(2)}` : 'Acres planned',
              // Not in the plan is not the same as not grown: spinach seed and
              // grass seed are recorded as custom crops and carry no acres.
              node: (r) => (r.acres == null ? 'Not in the plan' : r.acres.toLocaleString('en-CA')),
              figure: true,
            },
            papers,
            { label: 'S. Alberta', node: (r) => r.southern, figure: true },
            near,
            newest,
          ]}
        />
      </section>

      <section>
        <h2 className="px-1 pb-1 text-sm font-semibold text-gray-900">
          Shelves too thin to answer anything
        </h2>
        <GapRows
          rows={thin}
          head="Shelf"
          empty="Every shelf has something on it."
          open={open}
          cols={[
            papers,
            near,
            { label: 'Under', node: (r) => r.parent_name ?? '—' },
            newest,
          ]}
        />
      </section>

      {unfiled && unfiled.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-900">
            In the plan with no folder behind it
          </h2>
          <ul className="mt-1 text-sm text-amber-900">
            {unfiled.map((c) => (
              <li key={c.crop_id}>
                {c.name} — {c.acres?.toLocaleString('en-CA')} acres, to {c.plan_to}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Fold
        title="What the library cannot answer from"
        summary={totals ? `${totals.abstractOnly ?? 0} in part, ${totals.noTextAtAll ?? 0} not at all` : undefined}
        storageKey="research-gaps-holes"
      >
        <p className="text-sm text-gray-700">
          {totals?.abstractOnly ?? 0} papers are here as an abstract and no more — their publisher
          would not serve us the file, or the PDF is a scan with no text layer. A search quotes the
          abstract and says so. Only {totals?.noTextAtAll ?? 0} have no text at all, and those are
          found by their title alone.
        </p>
      </Fold>
    </div>
  )
}

export function ResearchPage() {
  const { profile } = useAuth()
  const tabs = useMemo(
    () => (hasManagerAccess(profile?.role) ? [...TABS, GAPS_TAB, NUMBERS_TAB] : [...TABS]),
    [profile?.role],
  )
  const [tab, setTab] = useTab<Tab>(
    'research',
    tabs.map((t) => t.key),
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
            ? `${totals.stored.toLocaleString('en-CA')} papers on our crops, chemicals, water and cattle. ${totals.alberta} from Alberta.`
            : 'Papers on our crops, chemicals, water and cattle.'}
        </p>
      </div>

      <HelpNote summary="What a folder is about first, then nearest work." className="mb-2">
        <p>
          Every folder asks one thing first: is the paper about that subject, or does it only
          mention it in passing? The ones that only mention it are marked and sit below the rest,
          wherever they were written.
        </p>
        <p className="mt-1.5">
          Within that, a folder is ordered by where the work was done — Lethbridge and Vauxhall,
          then Alberta, then the prairies, then Canada and the northern states, then everywhere
          else. The badge in the Where column says which.
        </p>
        <p className="mt-1.5">
          A <ExternalLink className="inline h-3 w-3" /> grey row is a paper we could not download:
          it is free to read, but its publisher refuses anything that is not a person at a browser,
          so it opens at their site instead. Everything else is a PDF held here.
        </p>
      </HelpNote>

      <PillTabs tabs={tabs} value={tab} onChange={setTab} />

      {/* Keyed by section so switching tabs starts on that shelf's fullest
          folder rather than keeping the last one, which is in another section. */}
      {tab === 'numbers' ? (
        <Suspense fallback={<p className="py-10 text-center text-sm text-gray-400">Loading…</p>}>
          <ResearchNumbers />
        </Suspense>
      ) : tab === 'gaps' ? (
        <Gaps />
      ) : tab === 'search' ? (
        <SearchAll />
      ) : (
        <Shelf key={tab} section={tab} />
      )}
    </div>
  )
}
