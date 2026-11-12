import { lazy, Suspense, useMemo, useState } from 'react'
import { FileUp, MapPin } from 'lucide-react'
import { useActivations, mobsForRanch, mobsNow } from '@/lib/eshepherd'
import { usePastures } from '@/lib/pastures'
import { Modal } from '@/components/Modal'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'

const WaterDemand = lazy(() => import('@/pages/cattle/WaterDemand').then((m) => ({ default: m.WaterDemand })))
const HerdLocation = lazy(() => import('@/pages/cattle/HerdLocation').then((m) => ({ default: m.HerdLocation })))

/**
 * The column beside the map (Sam, 11 Nov 2026).
 *
 * The map was the full width of the page with a lot of empty sky in it, and
 * the two things you most want while looking at it — where the cattle are and
 * whether the water can carry them — were cards you had to scroll past it to
 * read. They sit beside it now.
 *
 * This is the short version of "where the cattle are": the mobs, where they
 * are and how long they have been there, which is what the collar import
 * section under the map used to say at length (Sam, 11 Nov 2026: the page
 * says it on the map now). Reading the file is still a thing somebody has to
 * do every week or so, so Import opens it in a pop-up — including a CSV
 * shared to the app from the phone, which lands here with ?shared=collars.
 *
 * The top offset. PastureMap puts its "Pastures · N paddocks" row above the
 * map itself, so this column's first card started level with that row and the
 * map began 33 px lower — the two tops were visibly out (Sam, 11 Nov 2026).
 * MAP_HEAD_H is the height of that row: a text-sm line (20 px), the space-y-3
 * gap under it (12 px) and the map frame's own border (1 px). It belongs to
 * PastureMap's heading, so change it when that row changes.
 */
const MAP_HEAD_H = 'lg:mt-[33px]'

export function MapSidebar({
  ranchId,
  ranchName,
  ranchNames,
  collars = false,
  openCollars = false,
}: {
  ranchId: string
  /** The ranch the page is scoped to, or null under All. */
  ranchName: string | null
  ranchNames: string[]
  /** The collar feature is on: the import is offered. */
  collars?: boolean
  /** A CSV was shared to the app: open the import straight away. */
  openCollars?: boolean
}) {
  return (
    <aside className={cn('flex min-h-0 flex-col gap-4 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1', MAP_HEAD_H)}>
      <WhereTheCattleAre ranchName={ranchName} ranchNames={ranchNames} collars={collars} openCollars={openCollars} />
      <Suspense fallback={<p className="text-xs text-gray-400">Working out the water…</p>}>
        <WaterDemand ranchId={ranchId} />
      </Suspense>
    </aside>
  )
}

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/** Each mob, its paddock and how long it has been on it. */
function WhereTheCattleAre({
  ranchName,
  ranchNames,
  collars,
  openCollars,
}: {
  ranchName: string | null
  ranchNames: string[]
  collars: boolean
  openCollars: boolean
}) {
  const { data: rows } = useActivations()
  const { data: pastures } = usePastures()
  const [importing, setImporting] = useState(openCollars)

  const mobs = useMemo(
    // A mob of nobody — the export keeps one after its last animal is moved
    // out — is not somewhere to look for cattle.
    () => mobsForRanch(mobsNow(rows ?? []), ranchName, ranchNames).filter((m) => m.head_count !== 0),
    [rows, ranchName, ranchNames],
  )
  const pastureName = (id: string | null) => pastures?.find((p) => p.id === id)?.name ?? null
  const head = mobs.reduce((a, m) => a + (m.head_count ?? 0), 0)

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className={cn('flex flex-wrap items-center justify-between gap-2', CARD_HEAD)}>
        <h2 className="font-medium">Where the cattle are</h2>
        <span className="flex items-center gap-2">
          {head > 0 && <span className="tabular-nums">{head.toLocaleString('en-CA')} head</span>}
          {collars && (
            <button
              onClick={() => setImporting(true)}
              className="flex items-center gap-1 rounded border border-white/40 px-1.5 py-0.5 text-[11px] font-medium hover:bg-white/10"
            >
              <FileUp className="h-3 w-3" /> Import
            </button>
          )}
        </span>
      </div>
      {importing && (
        <Modal title="Collar import" onClose={() => setImporting(false)} wide="xl">
          <Suspense fallback={<p className="text-xs text-gray-400">Opening the reader…</p>}>
            <HerdLocation ranchName={ranchName} ranchNames={ranchNames} />
          </Suspense>
        </Modal>
      )}
      {mobs.length === 0 ? (
        <p className="px-3 py-4 text-sm text-gray-400">
          {rows?.length ? 'No mobs on this ranch in the collar history.' : 'No collar history imported yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {mobs.map((m) => (
            <li key={m.mob} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold text-gray-900">{m.mob}</span>
                {m.head_count != null && (
                  <span className="shrink-0 text-xs tabular-nums text-gray-500">{m.head_count} head</span>
                )}
              </div>
              <p className={cn('mt-0.5 flex items-start gap-1 text-sm', m.no_fence ? 'text-amber-800' : 'text-gray-800')}>
                <MapPin className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', m.no_fence ? 'text-amber-600' : 'text-brand-700')} />
                <span className="min-w-0">
                  {pastureName(m.pasture_id) ?? m.paddock_name}
                  <span className="block text-xs text-gray-500">
                    since {fmtDay(m.since)}
                    {m.days > 0 && ` · ${m.days} day${m.days === 1 ? '' : 's'}`}
                  </span>
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
