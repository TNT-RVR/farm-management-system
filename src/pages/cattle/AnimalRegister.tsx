import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDownUp, Check, Download, Loader2, Tags, Upload, X } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { Fold } from '@/components/Fold'
import { RecordEditModal, type EditField } from '@/components/RecordEditor'
import { askConfirm } from '@/components/askConfirm'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'
import { n0 } from '@/lib/format'
import { useCattle, useCattleMutations, type CattleRow } from '@/lib/cattle'
import {
  buildAnimalWorkbook,
  ranchForMob,
  toExportAnimal,
  useAnimalUploads,
  useBrandRanch,
  useBulkAssign,
  useFillFromCollars,
  useMobNames,
  useSetBrandRanch,
  useUndoUpload,
  useUploadAnimalSheet,
  type CollarFill,
  type UploadResult,
} from '@/lib/cattle-animals'
import { PREGNANCY_STATUSES, STOCK_CLASSES } from '@/lib/eshepherd-animals'
import { AnimalScanPanel } from '@/pages/cattle/AnimalScanPanel'

/**
 * The animal register: eShepherd's sheet in, the same sheet out.
 *
 * eShepherd has no export for its animal list — the one file it gives you is
 * the Bulk Create spreadsheet, and it comes back holding every animal. That
 * file is uploaded here, every column it carries is kept, and the register
 * writes the same shape back out so it can go straight back up.
 *
 * Mob is the one thing the file does not carry, so it is assigned here and
 * never guessed. Ranch follows the brand, but only for a brand somebody has
 * placed: an animal on the wrong ranch's paperwork is harder to spot than a
 * blank one.
 */
export function AnimalRegister({
  ranchId,
  ranches,
  isManager,
}: {
  ranchId: string
  ranches: { id: string; name: string }[]
  isManager: boolean
}) {
  const { data: all } = useCattle(null)
  const { data: brands } = useBrandRanch()
  const { data: mobNames } = useMobNames()
  const upload = useUploadAnimalSheet()
  const bulk = useBulkAssign()
  const { update } = useCattleMutations()

  const [search, setSearch] = useState('')
  const [mobFilter, setMobFilter] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'mob', dir: 1 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [showUnplaced, setShowUnplaced] = useState(false)
  const [editing, setEditing] = useState<CattleRow | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const everyAnimal = useMemo(() => (all ?? []) as unknown as CattleRow[], [all])

  /**
   * The ranch picker narrows the list — but an animal whose ranch nobody has
   * settled belongs to neither ranch, so it would be invisible on both and
   * the herd would look smaller than it is. They are offered here instead,
   * where they can be ticked and placed in one go.
   */
  const rows = useMemo(() => {
    if (!ranchId) return everyAnimal
    return everyAnimal.filter((a) => a.ranch_id === ranchId || (showUnplaced && !a.ranch_id))
  }, [everyAnimal, ranchId, showUnplaced])

  const ranchNames = useMemo(() => new Map(ranches.map((r) => [r.id, r.name])), [ranches])
  const ranchName = (id: string | null) => (id ? (ranchNames.get(id) ?? null) : null)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = rows.filter((a) => {
      const r = a as unknown as Record<string, unknown>
      if (mobFilter && (r.mob ?? '') !== mobFilter) return false
      if (!q) return true
      const hay = [r.vid, r.eid, r.neckband, r.mob, r.breed, r.brand, r.stock_class, a.tag, a.name, a.ranch_id ? ranchNames.get(a.ranch_id) : null]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    const val = (a: CattleRow, k: string) => {
      const v = (a as unknown as Record<string, unknown>)[k]
      if (k === 'ranch_id') return (a.ranch_id ? (ranchNames.get(a.ranch_id) ?? '') : '')
      return v == null ? '' : v
    }
    return [...out].sort((a, b) => {
      const x = val(a, sort.key)
      const y = val(b, sort.key)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir
      // Blanks last whichever way it is sorted: an empty mob is not "before A".
      const sx = String(x)
      const sy = String(y)
      if (!sx && sy) return 1
      if (sx && !sy) return -1
      return sx.localeCompare(sy, undefined, { numeric: true }) * sort.dir
    })
  }, [rows, search, mobFilter, sort, ranchNames])

  /** Brands in the herd that nobody has placed on a ranch yet. */
  const unplaced = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of everyAnimal) {
      const r = a as unknown as Record<string, unknown>
      const brand = (r.brand as string | null)?.trim()
      if (!brand || brand === '-') continue
      if (brands?.map.get(brand.toUpperCase())) continue
      m.set(brand, (m.get(brand) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [everyAnimal, brands])

  const noRanch = everyAnimal.filter((a) => !a.ranch_id).length
  const noMob = rows.filter((a) => !(a as unknown as Record<string, unknown>).mob).length

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setResult(null)
    setBusy(true)
    try {
      const out = await upload.mutateAsync({ file, brandMap: brands?.map ?? new Map() })
      setResult(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const download = async () => {
    setError(null)
    setBusy(true)
    try {
      const list = shown.map((a) => toExportAnimal(a as unknown as Record<string, unknown>))
      const blob = await buildAnimalWorkbook(list)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const where = ranchId ? ` ${ranchName(ranchId)}` : ''
      a.download = `eShepherd animals${where} ${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const assign = async (patch: { mob?: string | null; ranch_id?: string | null }) => {
    await bulk.mutateAsync({ ids: [...picked], patch })
    setPicked(new Set())
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="space-y-4">
      <AnimalScanPanel ranchId={ranchId} isManager={isManager} />

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className={cn('flex flex-wrap items-center justify-between gap-2', CARD_HEAD)}>
          <h2 className="font-medium">
            The register
            <InfoPopover title="Where these come from">
              <p>
                eShepherd has no export for its animal list. The one file it hands out is the Bulk Create spreadsheet —
                Animals → + → <strong>Bulk Create - Download File</strong> — and it comes back carrying every animal it knows.
              </p>
              <p>Upload it here. The same shape goes back out, so the file can go straight up to eShepherd again.</p>
              <p>
                Every sheet is kept, with the rows it replaced, so an upload that goes wrong can be put back from the archive
                below.
              </p>
            </InfoPopover>
          </h2>
          {isManager && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => void onFile(e.target.files?.[0])}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload sheet
              </button>
              <button
                onClick={() => void download()}
                disabled={busy || shown.length === 0}
                className="flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" /> Export {shown.length === rows.length ? 'all' : n0(shown.length)}
              </button>
            </div>
          )}
        </div>

        <div className="border-b border-gray-100 px-3 py-2">
          <HelpNote className="text-xs" summary="eShepherd's own sheet, in and out." title="What an upload does">
            Animals are matched on their EID, which is the only column in the file that is genuinely unique — the Animal ID
            repeats, because a re-tagged animal keeps its number. A blank column in the sheet means eShepherd does not know
            that value, so it never clears one already recorded here. Nothing is deleted from an upload: a row marked DELETE
            is left alone and reported, because that belongs in eShepherd.
          </HelpNote>
        </div>

        {isManager && <CollarLabels ranches={ranches} />}

        {error && <p className="m-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {result && <UploadSummary result={result} onClose={() => setResult(null)} />}

        {(unplaced.length > 0 || noRanch > 0) && (
          <div className="border-b border-gray-100 bg-amber-50 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {n0(noRanch)} {noRanch === 1 ? 'animal has' : 'animals have'} no ranch yet
                {ranchId ? ', so they show under no ranch at all' : ''}.
                {unplaced.length > 0 && ' Say which ranch these brands belong to and they will sort themselves:'}
              </span>
            </p>
            {ranchId !== '' && (
              <button
                onClick={() => setShowUnplaced((v) => !v)}
                className="mt-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                {showUnplaced ? 'Hide them again' : `Show the ${n0(noRanch)} with no ranch`}
              </button>
            )}
            {unplaced.length > 0 && isManager && (
              <div className="mt-2 flex flex-wrap gap-2">
                {unplaced.map(([brand, count]) => (
                  <BrandPlacer key={brand} brand={brand} count={count} ranches={ranches} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tag, EID, collar, mob, breed…"
            aria-label="Search the animals"
            className="min-w-0 flex-1 basis-56 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
          />
          <select
            value={mobFilter}
            onChange={(e) => setMobFilter(e.target.value)}
            aria-label="Filter by mob"
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Every mob</option>
            {(mobNames ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="text-xs tabular-nums text-gray-500">
            {n0(shown.length)} of {n0(rows.length)}
            {noMob > 0 && ` · ${n0(noMob)} with no mob`}
          </span>
        </div>

        {picked.size > 0 && isManager && (
          <BulkBar
            count={picked.size}
            mobNames={mobNames ?? []}
            ranches={ranches}
            onAssign={assign}
            onClear={() => setPicked(new Set())}
            busy={bulk.isPending}
          />
        )}

        {shown.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-gray-400">
            {rows.length === 0 ? 'No animals yet — upload the eShepherd sheet.' : 'Nothing matches that.'}
          </p>
        ) : (
          <AnimalTable
            rows={shown}
            picked={picked}
            onToggle={toggle}
            onOpen={setEditing}
            sort={sort}
            onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }))}
            ranchName={ranchName}
            selectable={isManager}
          />
        )}
      </section>

      <UploadArchive isManager={isManager} />

      {editing && (
        <AnimalEditor
          animal={editing}
          ranches={ranches}
          mobNames={mobNames ?? []}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await update.mutateAsync({ id: editing.id, patch: patch as never })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** What an upload did, and everything it could not do. */
function UploadSummary({ result, onClose }: { result: UploadResult; onClose: () => void }) {
  return (
    <div className="m-3 rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-green-900">
          <Check className="mr-1 inline h-3.5 w-3.5" />
          {n0(result.created)} added, {n0(result.updated)} updated
          {result.skipped > 0 && `, ${n0(result.skipped)} skipped`}.
        </p>
        <button onClick={onClose} aria-label="Hide this" className="-m-1 rounded p-1 text-green-700 hover:bg-green-100">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {result.unplacedBrands.length > 0 && (
        <p className="mt-1 text-xs text-green-900">
          Brands with no ranch yet: {result.unplacedBrands.map((b) => `${b.brand} (${b.count})`).join(', ')}.
        </p>
      )}
      {result.problems.length > 0 && (
        <Fold title={`${n0(result.problems.length)} rows eShepherd would argue with`} className="mt-2 border-green-200 bg-white">
          <ul className="space-y-1 px-3 py-2 text-xs text-gray-700">
            {result.problems.slice(0, 50).map((p, i) => (
              <li key={i}>
                <span className="font-medium">{p.row.vid ?? p.row.eid ?? p.row.neckband ?? 'a row'}</span>: {p.problems.join('; ')}
              </li>
            ))}
          </ul>
          <p className="px-3 pb-2 text-xs text-gray-600">
            These were kept exactly as the sheet had them — nothing was rewritten to fit eShepherd’s lists. Fix them here or in
            eShepherd before sending the file back.
          </p>
        </Fold>
      )}
      {result.unknownHeaders.length > 0 && (
        <p className="mt-1 text-xs text-green-900">
          Columns kept but not understood: {result.unknownHeaders.join(', ')}.
        </p>
      )}
    </div>
  )
}

/** Put a brand on a ranch, so the animals carrying it sort themselves. */
function BrandPlacer({ brand, count, ranches }: { brand: string; count: number; ranches: { id: string; name: string }[] }) {
  const set = useSetBrandRanch()
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs">
      <span className="font-semibold text-gray-900">{brand}</span>
      <span className="text-gray-500">{n0(count)}</span>
      <select
        defaultValue=""
        disabled={set.isPending}
        aria-label={`Which ranch brand ${brand} belongs to`}
        onChange={(e) => set.mutate({ brand, ranchId: e.target.value || null })}
        className="rounded border border-gray-300 px-1 py-0.5 text-xs"
      >
        <option value="">which ranch?</option>
        {ranches.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Set a mob or a ranch on everything ticked. */
function BulkBar({
  count,
  mobNames,
  ranches,
  onAssign,
  onClear,
  busy,
}: {
  count: number
  mobNames: string[]
  ranches: { id: string; name: string }[]
  onAssign: (patch: { mob?: string | null; ranch_id?: string | null }) => void | Promise<void>
  onClear: () => void
  busy: boolean
}) {
  const [mob, setMob] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-brand-200 bg-brand-50 px-3 py-2">
      <span className="text-xs font-semibold text-brand-900">{n0(count)} ticked</span>
      <select
        value={mob}
        onChange={(e) => setMob(e.target.value)}
        aria-label="Mob to put them in"
        className="rounded border border-gray-300 px-1.5 py-1 text-xs"
      >
        <option value="">pick a mob…</option>
        {mobNames.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <button
        disabled={!mob || busy}
        onClick={() => {
          // The mob name carries the ranch: "East Ranch Herd" is East Ranch.
          const ranch = ranchForMob(mob, ranches)
          void onAssign(ranch ? { mob, ranch_id: ranch } : { mob })
        }}
        className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
      >
        Put in this mob
      </button>
      <span className="text-[11px] text-brand-900">or</span>
      {ranches.map((r) => (
        <button
          key={r.id}
          disabled={busy}
          onClick={() => void onAssign({ ranch_id: r.id })}
          className="rounded-md border border-brand-300 bg-white px-2 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50"
        >
          Move to {r.name}
        </button>
      ))}
      <button onClick={onClear} className="ml-auto text-xs text-gray-500 hover:underline">
        Clear
      </button>
    </div>
  )
}

const COLUMNS: { key: string; label: string; cell: (a: Record<string, unknown>) => string }[] = [
  { key: 'vid', label: 'Tag', cell: (a) => (a.vid as string) ?? '' },
  { key: 'mob', label: 'Mob', cell: (a) => (a.mob as string) ?? '' },
  { key: 'stock_class', label: 'Class', cell: (a) => (a.stock_class as string) ?? '' },
  { key: 'breed', label: 'Breed', cell: (a) => (a.breed as string) ?? '' },
  { key: 'birth_date', label: 'Born', cell: (a) => (a.birth_date as string) ?? '' },
  { key: 'brand', label: 'Brand', cell: (a) => (a.brand as string) ?? '' },
  { key: 'neckband', label: 'Collar', cell: (a) => (a.neckband as string) ?? '' },
  { key: 'eid', label: 'EID', cell: (a) => (a.eid as string) ?? '' },
  { key: 'pregnancy_status', label: 'Pregnancy', cell: (a) => (a.pregnancy_status as string) ?? '' },
]

function AnimalTable({
  rows,
  picked,
  onToggle,
  onOpen,
  sort,
  onSort,
  ranchName,
  selectable,
}: {
  rows: CattleRow[]
  picked: Set<string>
  onToggle: (id: string) => void
  onOpen: (a: CattleRow) => void
  sort: { key: string; dir: 1 | -1 }
  onSort: (key: string) => void
  ranchName: (id: string | null) => string | null
  selectable: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={TABLE_HEAD}>
          <tr>
            {selectable && <th className={cn(TABLE_TH, 'w-8')} aria-label="Pick" />}
            {COLUMNS.map((c) => (
              <th key={c.key} className={cn(TABLE_TH, 'whitespace-nowrap')}>
                <button onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 hover:underline">
                  {c.label}
                  {sort.key === c.key && <ArrowDownUp className="h-3 w-3" />}
                </button>
              </th>
            ))}
            <th className={cn(TABLE_TH, 'whitespace-nowrap')}>
              <button onClick={() => onSort('ranch_id')} className="inline-flex items-center gap-1 hover:underline">
                Ranch
                {sort.key === 'ranch_id' && <ArrowDownUp className="h-3 w-3" />}
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((a) => {
            const r = a as unknown as Record<string, unknown>
            return (
              <tr
                key={a.id}
                onClick={() => onOpen(a)}
                className="cursor-pointer hover:bg-brand-50/50"
                title="Edit this animal"
              >
                {selectable && (
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={picked.has(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggle(a.id)}
                      aria-label={`Pick ${(r.vid as string) ?? a.id}`}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                )}
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'whitespace-nowrap px-3 py-1.5',
                      c.key === 'vid' && 'font-medium text-gray-900',
                      c.key === 'eid' && 'tabular-nums text-xs text-gray-500',
                      !c.cell(r) && 'text-gray-300',
                    )}
                  >
                    {/* The tag opens the animal's own page — its calvings,
                        treatments and weights. The rest of the row opens the
                        editor, which is the only way at the eShepherd
                        columns, so the two need separate targets. */}
                    {c.key === 'vid' && c.cell(r) ? (
                      <Link
                        to={`/cattle/${a.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-brand-700 hover:underline"
                        title="Open this animal's page"
                      >
                        {c.cell(r)}
                      </Link>
                    ) : (
                      c.cell(r) || '—'
                    )}
                  </td>
                ))}
                <td className={cn('whitespace-nowrap px-3 py-1.5', !a.ranch_id && 'text-amber-700')}>
                  {ranchName(a.ranch_id) ?? 'needs one'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One animal, every field editable. */
function AnimalEditor({
  animal,
  ranches,
  mobNames,
  onClose,
  onSave,
}: {
  animal: CattleRow
  ranches: { id: string; name: string }[]
  mobNames: string[]
  onClose: () => void
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const r = animal as unknown as Record<string, unknown>

  const fields: EditField[] = [
    { key: 'vid', label: 'Tag (VID)', kind: 'text', hint: 'The visual tag, as painted on the dangler.' },
    { key: 'eid', label: 'EID', kind: 'text', hint: 'The 15 digits in the ear tag. This is what a wand reads.' },
    { key: 'neckband', label: 'Collar', kind: 'text' },
    {
      key: 'mob',
      label: 'Mob',
      kind: 'select',
      options: [{ value: '', label: 'no mob' }, ...mobNames.map((m) => ({ value: m, label: m }))],
      hint: 'eShepherd keeps this in its Mobs panel and puts it in no file, so it is set here.',
    },
    {
      key: 'ranch_id',
      label: 'Ranch',
      kind: 'select',
      options: [{ value: '', label: 'none yet' }, ...ranches.map((x) => ({ value: x.id, label: x.name }))],
    },
    {
      key: 'stock_class',
      label: 'Stock class',
      kind: 'select',
      options: [{ value: '', label: 'not set' }, ...STOCK_CLASSES.map((s) => ({ value: s, label: s }))],
    },
    { key: 'breed', label: 'Breed', kind: 'text' },
    { key: 'birth_date', label: 'Born', kind: 'date' },
    { key: 'brand', label: 'Tattoo or brand', kind: 'text' },
    { key: 'weight_kg', label: 'Weight (kg)', kind: 'number', step: '0.1' },
    { key: 'weighed_on', label: 'Weighed on', kind: 'date' },
    { key: 'expected_gain_kg', label: 'Expected gain (kg)', kind: 'number', step: '0.1' },
    {
      key: 'pregnancy_status',
      label: 'Pregnancy',
      kind: 'select',
      options: [{ value: '', label: 'not set' }, ...PREGNANCY_STATUSES.map((p) => ({ value: p, label: p }))],
    },
    { key: 'eshepherd_note', label: 'eShepherd note', kind: 'textarea', hint: 'Goes back up in the sheet’s Note column.' },
    { key: 'notes_md', label: 'Our notes', kind: 'textarea', hint: 'Stays here. An upload never touches it.' },
  ]

  return (
    <RecordEditModal
      title={(r.vid as string) || (r.eid as string) || 'Animal'}
      fields={fields}
      row={r}
      saving={saving}
      error={error}
      onClose={onClose}
      onSave={async (patch) => {
        setSaving(true)
        setError(null)
        try {
          await onSave(patch)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setSaving(false)
        }
      }}
    />
  )
}

/** Every sheet ever uploaded, newest first, each one undoable. */
function UploadArchive({ isManager }: { isManager: boolean }) {
  const { data: uploads } = useAnimalUploads()
  const undo = useUndoUpload()
  const [error, setError] = useState<string | null>(null)
  const list = uploads ?? []

  return (
    <Fold
      title="Uploaded sheets"
      summary={list.length ? `${n0(list.length)} kept` : undefined}
      storageKey="cattle-upload-archive"
    >
      <HelpNote className="px-3 pt-2 text-xs" summary="Every sheet is kept, with the rows it replaced." title="Putting one back">
        An upload records the file exactly as it was read and what each row held before it was written. Putting one back
        restores those rows and removes the animals it added — but only the ones no later upload has touched, so undoing an
        old sheet cannot reach through a newer one.
      </HelpNote>
      {error && <p className="mx-3 mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {list.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-400">Nothing uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-auto">
                <p className="truncate text-sm font-medium text-gray-900">{u.filename}</p>
                <p className="text-xs text-gray-500">
                  {new Date(u.uploaded_at).toLocaleString('en-CA')} · {n0(u.row_count)} rows · {n0(u.created_count)} added ·{' '}
                  {n0(u.updated_count)} updated
                  {u.skipped_count > 0 && ` · ${n0(u.skipped_count)} skipped`}
                </p>
              </div>
              {u.undone_at ? (
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  Put back
                </span>
              ) : (
                isManager && (
                  <button
                    disabled={undo.isPending}
                    onClick={async () => {
                      if (!(await askConfirm(`Put back everything "${u.filename}" changed? The animals it added are removed.`)))
                        return
                      setError(null)
                      try {
                        await undo.mutateAsync(u.id)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e))
                      }
                    }}
                    className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Put this one back
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Fold>
  )
}

/**
 * Mob and ranch from the collars.
 *
 * The sheet eShepherd hands out carries no mob, so every animal here was
 * unlabelled while the Pregnancy tab knew the mob of all 420 collared ones —
 * the same animals, a different pull. This copies it across: mob always,
 * ranch only where none was set, so a brand nobody argues with stays put.
 *
 * A button rather than something that happens on upload. It is run after a
 * pregnancy pull, which is weekly, and a label that appears by itself after a
 * spreadsheet upload is a label nobody trusts.
 */
function CollarLabels({ ranches }: { ranches: { id: string; name: string }[] }) {
  const fill = useFillFromCollars(ranches)
  const [done, setDone] = useState<CollarFill | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const run = async () => {
    setFailed(null)
    setDone(null)
    try {
      setDone(await fill.mutateAsync())
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="border-b border-gray-100 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-gray-700">
          <Tags className="h-3.5 w-3.5 text-gray-400" /> Mob and ranch from the collars
          <InfoPopover title="Where the mob comes from">
            <p>
              The Bulk Create sheet has no mob column, so the register cannot learn it from an upload. The weekly pregnancy
              pull can: it lists every collared animal with the mob it is in.
            </p>
            <p>
              Animals are matched on their eShepherd Animal ID. Mob is overwritten, because the collars are the only source
              for it and the current mob is the point.
            </p>
            <p>
              Ranch is only filled in where it is blank. One already set came from the animal's brand — who owns it — while
              the mob says where it is standing. Where the two disagree the brand is kept and the animal is listed instead.
            </p>
          </InfoPopover>
        </span>
        <button
          onClick={() => void run()}
          disabled={fill.isPending}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {fill.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tags className="h-3.5 w-3.5" />}
          {fill.isPending ? 'Labelling…' : 'Fill them in'}
        </button>
      </div>

      {failed && <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{failed}</p>}

      {done && (
        <div className="mt-1.5 rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900">
          <p className="font-medium">
            {done.mobSet === 0 && done.ranchFilled === 0
              ? 'Already up to date — nothing to change.'
              : `${n0(done.mobSet)} ${done.mobSet === 1 ? 'animal' : 'animals'} given a mob, ${n0(done.ranchFilled)} placed on a ranch.`}
          </p>
          {done.noMatch > 0 && (
            <p className="mt-0.5 text-emerald-800">
              {n0(done.noMatch)} are not in the collar data, so still have no mob — no collar, or the pregnancy pull is
              older than they are.
            </p>
          )}
          {done.mobSaysNothing.length > 0 && (
            <p className="mt-0.5 text-emerald-800">
              Mobs naming no ranch of ours, left unplaced:{' '}
              {done.mobSaysNothing.map((m) => `${m.mob} (${n0(m.count)})`).join(', ')}.
            </p>
          )}
          {done.disagreed.length > 0 && (
            <div className="mt-1 rounded-md bg-amber-100 px-2 py-1.5 text-amber-900">
              <p className="font-medium">
                {n0(done.disagreed.length)} {done.disagreed.length === 1 ? 'animal is' : 'animals are'} branded for one
                ranch and running on the other. The brand was kept.
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {done.disagreed.slice(0, 8).map((d) => (
                  <li key={d.tag}>
                    {d.tag}: placed at {d.placedAt ?? 'nowhere'}, {d.mob} is at {d.mobSays ?? 'nowhere'}
                  </li>
                ))}
              </ul>
              {done.disagreed.length > 8 && <p className="mt-0.5">…and {n0(done.disagreed.length - 8)} more.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
