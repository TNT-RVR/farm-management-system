import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Beef, Check, FileUp, MapPin, Upload } from 'lucide-react'
import { usePastures } from '@/lib/pastures'
import {
  isNoFence,
  matchPasture,
  mobsForRanch,
  mobsNow,
  parseActivations,
  type ColumnGuess,
  type ParsedActivation,
  useActivations,
  useImportActivations,
} from '@/lib/eshepherd'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

/**
 * Where each mob is, and for how long.
 *
 * Gallagher's collars know; Gallagher's app does not share, except as a CSV
 * off the web app's Status page. So the file is dropped here, and from it:
 * every mob's paddock, since when, and where it was before — and the rotation
 * planner underneath gets real "cattle on now" and "days rested" instead of
 * blanks.
 *
 * The reader guesses the file's columns by name and says what it took for
 * what BEFORE anything is saved. The real export (September 2026) is
 * VP Name, Start Time, End Time, VP Area, Head Count, Mob Name, Animals.
 */
const LABEL: Record<keyof ColumnGuess, string> = {
  mob: 'mob',
  paddock: 'paddock',
  status: 'status',
  start: 'from',
  end: 'until',
  head: 'head count',
}

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * Where the service worker parks a CSV shared to the installed app from the
 * phone's share sheet (see sw.ts). Same path on both sides.
 */
const SHARED_COLLARS_URL = '/__offline-file/shared-collars.csv'
const FILE_CACHE = 'rvr-files'

/** The shared file, if one is waiting — taken out of the cache as it is read. */
async function takeSharedFile(): Promise<File | null> {
  try {
    const res = await fetch(SHARED_COLLARS_URL)
    if (!res.ok) return null
    const name = decodeURIComponent(res.headers.get('X-File-Name') ?? '') || 'shared.csv'
    const text = await res.text()
    const cache = await caches.open(FILE_CACHE)
    await cache.delete(SHARED_COLLARS_URL)
    return new File([text], name, { type: 'text/csv' })
  } catch {
    return null
  }
}

export function HerdLocation({
  ranchName = null,
  ranchNames = [],
}: {
  /** The ranch the page is scoped to, or null for all. */
  ranchName?: string | null
  ranchNames?: string[]
}) {
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const { data: rows } = useActivations()
  const { data: pastures } = usePastures()
  const importer = useImportActivations()
  const [pending, setPending] = useState<{
    rows: ParsedActivation[]
    guess: ColumnGuess
    skipped: number
    name: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [params, setParams] = useSearchParams()
  const shared = params.get('shared') === 'collars'

  const mobs = useMemo(
    // A mob of nobody (the export keeps a mob after its last animal is moved
    // out) is not somewhere to look for cattle.
    () => mobsForRanch(mobsNow(rows ?? []), ranchName, ranchNames).filter((m) => m.head_count !== 0),
    [rows, ranchName, ranchNames],
  )
  const pastureName = (id: string | null) => pastures?.find((p) => p.id === id)?.name ?? null
  const simplePastures = useMemo(() => (pastures ?? []).map((p) => ({ id: p.id, name: p.name })), [pastures])
  const lastImport = useMemo(() => {
    let latest: string | null = null
    for (const r of rows ?? []) if (!latest || r.imported_at > latest) latest = r.imported_at
    return latest
  }, [rows])

  const readFile = async (file: File) => {
    setError(null)
    setDone(null)
    const text = await file.text()
    const parsed = parseActivations(text)
    if (!parsed.rows.length) {
      setError(
        `Could not find mob, paddock and start columns in that file (saw: ${
          (Object.keys(LABEL) as (keyof ColumnGuess)[])
            .filter((k) => parsed.guess[k])
            .map((k) => `${LABEL[k]} = ${parsed.guess[k]}`)
            .join(', ') || 'nothing recognisable'
        }).`,
      )
      return
    }
    setPending({ ...parsed, name: file.name })
  }

  // Arrived here from the share sheet: pick up the parked file and open the
  // preview, then drop the marker from the URL so a refresh does not look
  // for it again.
  useEffect(() => {
    if (!shared) return
    void (async () => {
      const file = await takeSharedFile()
      if (file) await readFile(file)
      else setError('No shared file was found — try sharing the CSV again, or use Import.')
      setParams(
        (p) => {
          p.delete('shared')
          return p
        },
        { replace: true },
      )
    })()
    // readFile is stable enough for a one-shot on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared])

  // The same matching the import will do, so the preview is a promise rather
  // than an estimate. Fence-off rows are not paddocks and are left out.
  const preview = useMemo(() => {
    if (!pending) return null
    const names = [...new Set(pending.rows.map((r) => r.paddock_name))].filter((n) => !isNoFence(n))
    const matched = names.filter((n) => matchPasture(n, simplePastures))
    const unmatched = names.filter((n) => !matchPasture(n, simplePastures))
    return { matched, unmatched }
  }, [pending, simplePastures])

  return (
    <section
      className={cn(
        'rounded-lg border bg-white p-4 transition-colors',
        dragging ? 'border-brand-500 bg-brand-50/60' : 'border-gray-200',
      )}
      // The whole card is a drop zone: from the browser's download bar or a
      // folder straight on, no hunting for the button.
      onDragOver={(e) => {
        if (!canEdit) return
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!canEdit) return
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files?.[0]
        if (f) void readFile(f)
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Beef className="h-4 w-4 text-red-700" /> Where the cattle are
        </h2>
        {canEdit && !pending && (
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <FileUp className="h-3.5 w-3.5" /> Import eShepherd history
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readFile(f)
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>
      <HelpNote
        className="mt-0.5 text-xs"
        summary={lastImport ? <>From the collars · last import {fmtDay(lastImport)}</> : 'From the collars · not imported yet'}
        title="How to import from eShepherd"
      >
        <p>
          From the collars. In the eShepherd web app: Status → download CSV → drop it here, or on the
          phone share the download to this app. Re-importing the same file changes nothing; a newer
          one updates.
        </p>
      </HelpNote>

      {pending && preview && (
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50/40 p-3 text-sm">
          <p className="font-medium text-gray-900">
            {pending.name}: {pending.rows.length} activation{pending.rows.length === 1 ? '' : 's'} across{' '}
            {new Set(pending.rows.map((r) => r.mob)).size} mobs
            {pending.skipped ? `, ${pending.skipped} row${pending.skipped === 1 ? '' : 's'} without a mob skipped` : ''}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Read as:{' '}
            {(Object.keys(LABEL) as (keyof ColumnGuess)[]).map((k) => (
              <span key={k} className="mr-2">
                <span className="text-gray-400">{LABEL[k]}</span> ={' '}
                <span className={cn(pending.guess[k] ? 'font-medium' : 'text-red-600')}>
                  {pending.guess[k] ?? 'not found'}
                </span>
              </span>
            ))}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            {preview.matched.length} of {preview.matched.length + preview.unmatched.length} paddock names land on
            this map
            {preview.unmatched.length > 0 && (
              <>
                {' '}
                — not placed: <span className="text-gray-800">{preview.unmatched.join(', ')}</span>
              </>
            )}
            . Unplaced ones are still kept and shown by name.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() =>
                importer.mutate(
                  { rows: pending.rows, pastures: simplePastures },
                  {
                    onSuccess: (r) => {
                      setPending(null)
                      setDone(`${r.imported} imported, ${r.placed} placed on the map, ${r.unmatched} unplaced.`)
                    },
                    onError: (e) => setError((e as Error).message),
                  },
                )
              }
              disabled={importer.isPending}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" /> {importer.isPending ? 'Importing…' : 'Import'}
            </button>
            <button
              onClick={() => setPending(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {done && (
        <p className="mt-2 flex items-center gap-1 text-xs text-green-800">
          <Check className="h-3.5 w-3.5" /> {done}
        </p>
      )}

      {mobs.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">
          {rows?.length ? 'No mobs on this ranch in the collar history.' : 'No collar history imported yet.'}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {mobs.map((m) => (
            <li key={m.mob} className="rounded-md border border-gray-200 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900">{m.mob}</span>
                {m.head_count != null && (
                  <span className="text-xs tabular-nums text-gray-500">{m.head_count} head</span>
                )}
              </div>
              <p className={cn('mt-0.5 flex items-center gap-1 text-sm', m.no_fence ? 'text-amber-800' : 'text-gray-800')}>
                <MapPin className={cn('h-3.5 w-3.5', m.no_fence ? 'text-amber-600' : 'text-brand-700')} />
                {pastureName(m.pasture_id) ?? m.paddock_name}
                <span className="text-xs text-gray-500">
                  · since {fmtDay(m.since)}
                  {m.days > 0 && ` (${m.days} day${m.days === 1 ? '' : 's'})`}
                </span>
              </p>
              {m.previous && (
                <p className="mt-0.5 text-xs text-gray-400">
                  {m.no_fence ? 'last fenced in' : 'before that'}: {m.previous}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
