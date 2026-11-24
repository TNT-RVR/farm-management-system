import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react'
import { FileText, Image as ImageIcon, Paperclip, Search, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '@/components/Page'
import { Select } from '@/components/Select'
import { Dot, SummaryLine } from '@/components/RowCards'
import { RowList } from '@/components/RowList'
import { DocumentViewer } from '@/components/DocumentViewer'
import { DateField } from '@/components/DateField'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useCropYear } from '@/lib/crop-year'
import { useUsers } from '@/lib/queries'
import { farmTz } from '@/lib/farm-context'
import { useOpenParam } from '@/lib/useOpenParam'
import { readDocumentText, suggestFiling, type Suggestion } from '@/lib/document-suggest'
import {
  documentKind,
  useDocument,
  useDocumentAreas,
  useDocumentCounts,
  useDocumentFilterOptions,
  useDocuments,
  useUploadDocument,
  type DocumentListItem,
  type DocumentSort,
} from '@/lib/documents'

/** What put the row here, said the way the screen that owns it is named. */
const SOURCE_LABEL: Record<string, string> = {
  upload: 'Added here',
  report: 'Made report',
  field_files: 'Field',
  product_purchases: 'Invoice',
  product_documents: 'Product',
  power_bills: 'Power bill',
  scale_ticket_photos: 'Scale ticket',
  checklist_photos: 'Checklist',
  task_files: 'Task',
  contracts: 'Contract',
  hail_inspections: 'Hail',
  pivot_photos: 'Pivot',
  pump_photos: 'Pump',
  pasture_biomass_calibration: 'Pasture sample',
  research_papers: 'Research',
}

/** When a report was made, on the farm's clock: "2026-11-23 14:05". */
const madeAt = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: farmTz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')

const SORTS: { value: DocumentSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'area', label: 'By area' },
  { value: 'added', label: 'Recently added' },
]

function DocIcon({ doc }: { doc: DocumentListItem }) {
  const kind = documentKind(doc)
  if (kind === 'image') return <ImageIcon className="h-4 w-4 shrink-0 text-purple-500" />
  if (kind === 'pdf') return <FileText className="h-4 w-4 shrink-0 text-red-400" />
  return <Paperclip className="h-4 w-4 shrink-0 text-gray-400" />
}

export function DocumentsPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const canAdd = hasManagerAccess(profile?.role)

  // ?area=reports, from the Reports page: that folder, already chosen.
  const [params] = useSearchParams()
  const [area, setArea] = useState(() => params.get('area') ?? '')
  const { data: people } = useUsers()
  const who = (id: string | null) => (id && people?.find((u) => u.id === id)?.full_name) || null
  const [kind, setKind] = useState('')
  const [year, setYear] = useState('')
  const [sort, setSort] = useState<DocumentSort>('newest')
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<DocumentListItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [dropped, setDropped] = useState<{ file: File; text: string; suggestion: Suggestion } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  // On a phone the four menus took three rows and pushed the first document a
  // third of the way down the screen, so there they fold behind one button.
  // The button carries a count, because a filter you cannot see quietly
  // narrowing the list is worse than the clutter was.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersOn = [area, kind, year].filter(Boolean).length

  // A link from the app search names a document that is very often not in the
  // list on screen, so it is fetched by id rather than looked up in it.
  const [openId, setOpenId] = useState<string | null>(null)
  useOpenParam(setOpenId)
  const { data: linked } = useDocument(openId)

  const { data: areas } = useDocumentAreas()
  const { data: counts } = useDocumentCounts()
  const { data: options } = useDocumentFilterOptions()
  const { data: docs, isLoading, error } = useDocuments({
    area: area || null,
    docType: kind || null,
    cropYear: year ? Number(year) : null,
    q,
    sort,
  })

  const countFor = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of counts ?? []) m.set(c.area, Number(c.n))
    return m
  }, [counts])
  const total = useMemo(() => (counts ?? []).reduce((s, c) => s + Number(c.n), 0), [counts])

  // Dropping a file anywhere on the page opens the form with it in hand.
  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (!canAdd) return
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      // Read it before the form opens, so the form can be seeded with the
      // answer rather than filling itself in from an effect afterwards.
      setReading(true)
      try {
        const text = await readDocumentText(file)
        setDropped({ file, text, suggestion: suggestFiling(file.name, text) })
        setAdding(true)
      } finally {
        setReading(false)
      }
    },
    [canAdd],
  )

  return (
    <div
      onDragOver={(e) => {
        if (!canAdd) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        // Only when the pointer has left the page, not on its way across a
        // child element.
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => void onDrop(e)}
      className="relative"
    >
      <Page
        title="Documents"
        info={
          `Every file on the farm in one place: ${total.toLocaleString('en-CA')} of them. A document added on any ` +
          `screen — a soil test on a field, an invoice, a scale ticket, a paper — is filed here by itself. ` +
          `Drag a file onto this page to add one: it is read and an area suggested before you file it. ` +
          `Search looks inside the documents as well as at their names, photographs included: ` +
          `what is written in a nameplate or a ticket is read off it, and a line says what the picture shows.`
        }
        actions={
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setQ(typed)
              }}
              className="flex items-center gap-1.5"
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="Search documents"
                  aria-label="Search documents"
                  className="w-40 rounded-md border border-gray-300 py-1.5 pl-7 pr-7 text-sm focus:border-gray-400 focus:outline-none sm:w-52"
                />
                {q && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setTyped('')
                      setQ('')
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </form>
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 sm:hidden"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {filtersOn > 0 && (
                <span className="rounded-full bg-green-700 px-1.5 text-xs font-semibold text-white">{filtersOn}</span>
              )}
            </button>
            <div
              className={cn(
                'w-full flex-wrap items-center gap-2 sm:contents',
                filtersOpen ? 'flex' : 'hidden',
              )}
            >
              <Select
                value={area}
                ariaLabel="Area"
                className="w-40"
                onChange={setArea}
                options={[
                  { value: '', label: `All areas (${total.toLocaleString('en-CA')})` },
                  ...(areas ?? []).map((a) => ({
                    value: a.key,
                    label: `${a.label}${countFor.get(a.key) ? ` (${countFor.get(a.key)})` : ''}`,
                  })),
                ]}
              />
              <Select
                value={kind}
                ariaLabel="Kind"
                className="w-36"
                onChange={setKind}
                options={[
                  { value: '', label: 'Any kind' },
                  ...(options?.kinds ?? []).map((k) => ({ value: k.kind, label: `${k.kind} (${k.n})` })),
                ]}
              />
              {(options?.years.length ?? 0) > 0 && (
                <Select
                  value={year}
                  ariaLabel="Crop year"
                  className="w-28"
                  onChange={setYear}
                  options={[
                    { value: '', label: 'Any year' },
                    ...(options?.years ?? []).map((y) => ({ value: String(y.year), label: `${y.year} (${y.n})` })),
                  ]}
                />
              )}
              <Select
                value={sort}
                ariaLabel="Sort"
                className="w-36"
                onChange={(v) => setSort(v as DocumentSort)}
                options={SORTS}
              />
            </div>
            {canAdd && (
              <button
                onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
              >
                <Upload className="h-3.5 w-3.5" />
                Add
              </button>
            )}
          </>
        }
      >
        {adding && canAdd && (
          <AddDocument
            // Remounts when a different file is dropped, so the fields are
            // seeded from the new one rather than kept from the last.
            key={dropped ? `${dropped.file.name}:${dropped.file.size}` : 'empty'}
            areas={areas ?? []}
            cropYear={cropYear}
            initialFile={dropped?.file ?? null}
            initialText={dropped?.text ?? ''}
            initialSuggestion={dropped?.suggestion ?? null}
            onDone={() => {
              setAdding(false)
              setDropped(null)
            }}
          />
        )}

        {error ? (
          <p className="text-sm text-red-700">{(error as Error).message}</p>
        ) : isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : !docs?.length ? (
          <p className="text-sm text-gray-500">
            {q ? `Nothing matches “${q}”.` : 'No documents filed here yet.'}
          </p>
        ) : (
          <RowList className="rounded-lg border border-gray-200 bg-white">
            {docs.map((d) => {
              const source = SOURCE_LABEL[d.source] ?? d.source
              // The screen a document came from and the kind of thing it is
              // are often the same word — an invoice, from Invoices. Once.
              const showSource = source.toLowerCase() !== (d.doc_type ?? '').toLowerCase()
              return (
                <li key={d.id}>
                  <button
                    onClick={() => setOpen(d)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <DocIcon doc={d} />
                    <div className="min-w-0 flex-auto">
                      <div className="truncate text-sm font-semibold text-gray-900">{d.title}</div>
                      {d.source === 'report' ? (
                        // A made report: who made it, when, and what was chosen.
                        <SummaryLine>
                          <span>{who(d.added_by) ?? 'Someone'}</span>
                          <Dot />
                          <span className="tabular-nums">{madeAt(d.created_at)}</span>
                          {d.summary && (
                            <>
                              <Dot />
                              <span className="truncate">{d.summary}</span>
                            </>
                          )}
                        </SummaryLine>
                      ) : (
                      <SummaryLine>
                        {d.doc_type && <span>{d.doc_type}</span>}
                        {showSource && (
                          <>
                            {d.doc_type && <Dot />}
                            <span>{source}</span>
                          </>
                        )}
                        {d.party && (
                          <>
                            <Dot />
                            <span className="truncate">{d.party}</span>
                          </>
                        )}
                        {d.doc_date && (
                          <>
                            <Dot />
                            <span className="tabular-nums">{d.doc_date}</span>
                          </>
                        )}
                        {d.crop_year && (
                          <>
                            <Dot />
                            <span className="tabular-nums">{d.crop_year} crop</span>
                          </>
                        )}
                      </SummaryLine>
                      )}
                      {/* A paper's abstract, or the line read off a photograph.
                          Shown rather than left to work on the search quietly,
                          so nobody wonders why a picture came back. */}
                      {d.source !== 'report' && d.summary && (
                        <div className="truncate text-xs text-gray-500">{d.summary}</div>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </RowList>
        )}

        {docs && docs.length >= 200 && (
          <p className="mt-2 text-xs text-gray-500">The first 200. Search, or narrow it with the menus above.</p>
        )}

        {(open ?? linked) && (
          <DocumentViewer
            doc={(open ?? linked)!}
            onClose={() => {
              setOpen(null)
              setOpenId(null)
            }}
          />
        )}
      </Page>

      {reading && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-green-900/10">
          <div className="rounded-lg border border-gray-300 bg-white px-6 py-4 text-sm font-medium text-gray-700 shadow">
            Reading the file…
          </div>
        </div>
      )}

      {dragging && canAdd && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-green-900/10">
          <div className="rounded-lg border-2 border-dashed border-green-600 bg-white/95 px-6 py-4 text-sm font-medium text-green-800 shadow">
            Drop it anywhere to file it
          </div>
        </div>
      )}
    </div>
  )
}

function AddDocument({
  areas,
  cropYear,
  initialFile,
  initialText,
  initialSuggestion,
  onDone,
}: {
  areas: { key: string; label: string }[]
  cropYear: number
  initialFile: File | null
  initialText: string
  initialSuggestion: Suggestion | null
  onDone: () => void
}) {
  const upload = useUploadDocument()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(initialFile)
  const [area, setArea] = useState(initialSuggestion?.area ?? 'other')
  const [title, setTitle] = useState(initialFile ? initialFile.name.replace(/\.[^.]+$/, '') : '')
  const [docType, setDocType] = useState(initialSuggestion?.docType ?? '')
  const [party, setParty] = useState(initialSuggestion?.party ?? '')
  const [docDate, setDocDate] = useState(initialSuggestion?.docDate ?? '')
  const [year, setYear] = useState<string>(String(initialSuggestion?.cropYear ?? cropYear))
  const [reading, setReading] = useState(false)
  const [why, setWhy] = useState<string[]>(initialSuggestion?.why ?? [])
  // Read once, kept: it is stored with the document so the words inside it
  // can be searched, not only used to guess the area and thrown away.
  const [text, setText] = useState(initialText)

  // Read the file and fill the form in. Everything it writes is a suggestion
  // that can be typed over, and `why` names the words that decided the area so
  // the guess can be checked rather than taken on trust.
  const take = useCallback(async (f: File) => {
    setFile(f)
    setTitle(f.name.replace(/\.[^.]+$/, ''))
    setReading(true)
    setWhy([])
    try {
      const read = await readDocumentText(f)
      setText(read)
      const s = suggestFiling(f.name, read)
      setArea(s.area)
      setWhy(s.why)
      if (s.docType) setDocType(s.docType)
      if (s.party) setParty(s.party)
      if (s.docDate) setDocDate(s.docDate)
      if (s.cropYear) setYear(String(s.cropYear))
    } finally {
      setReading(false)
    }
  }, [])

  const areaLabel = areas.find((a) => a.key === area)?.label ?? area

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">File</span>
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void take(f)
            }}
            className="w-full text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">…or drop one anywhere on this page.</p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Area</span>
          <Select
            value={area}
            ariaLabel="Area"
            onChange={setArea}
            options={areas.map((a) => ({ value: a.key, label: a.label }))}
          />
          {reading ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
              <Sparkles className="h-3 w-3" /> Reading the file…
            </p>
          ) : why.length > 0 ? (
            <p className="mt-1 flex items-start gap-1 text-xs text-green-800">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Looks like {areaLabel.toLowerCase()} — it says “{why.join('”, “')}”.
              </span>
            </p>
          ) : null}
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Kind</span>
          <input
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            placeholder="Statement of loss, soil test…"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">From</span>
          <input
            value={party}
            onChange={(e) => setParty(e.target.value)}
            placeholder="AFSC, the lab, a supplier…"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {/* Not wrapped in a <label>: DateField is a button, and a label
              around a button sends the click to it a second time, so the
              calendar opened and shut again on a single press. */}
          <div className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">Dated</span>
            <DateField value={docDate} onChange={setDocDate} ariaLabel="Document date" />
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">Crop year</span>
            <input
              value={year}
              inputMode="numeric"
              onChange={(e) => setYear(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>
      </div>

      {upload.error && <p className="mt-2 text-sm text-red-700">{(upload.error as Error).message}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={!file || upload.isPending}
          onClick={() => {
            if (!file) return
            upload.mutate(
              {
                file,
                area,
                title,
                docType: docType || null,
                party: party || null,
                docDate: docDate || null,
                cropYear: year ? Number(year) : null,
                text,
              },
              { onSuccess: onDone },
            )
          }}
          className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60"
        >
          {upload.isPending ? 'Filing…' : 'File it'}
        </button>
        <button onClick={onDone} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-white">
          Cancel
        </button>
      </div>
    </div>
  )
}
