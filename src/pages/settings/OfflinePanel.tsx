import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CloudOff, Download, Loader2 } from 'lucide-react'
import { useCropYear } from '@/lib/crop-year'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { HelpNote } from '@/components/HelpNote'
import { useOnline } from '@/lib/useOnline'
import { mapAndFileTargets, warmOffline, type WarmProgress } from '@/lib/offline-warm'
import { clearOfflineCache } from '@/lib/offline'
import {
  cachedTileCount,
  clearTiles,
  downloadTiles,
  estimateBytes,
  tilesForBoxes,
  type Tile,
} from '@/lib/offline-tiles'
import { cachedFileCount, clearFiles, downloadFiles } from '@/lib/offline-files'

const LAST_KEY = 'rvr-offline-warmed-at'

/**
 * How close in to save the imagery.
 *
 * 16 is the whole farm at a few metres a pixel — enough to see the pivot track
 * and the field edges. 17 doubles the detail and triples the download; 18 is a
 * hundred megabytes and only worth it for looking at individual plants.
 */
const ZOOMS = [
  { max: 15, label: 'Fields', hint: 'shape and position' },
  { max: 16, label: 'Detailed', hint: 'edges, tracks, the pivot circle' },
  { max: 17, label: 'Close', hint: 'ground detail' },
]
const MIN_ZOOM = 10

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Save the farm to this device.
 *
 * The cache keeps whatever has been opened, which is the wrong half: you find
 * out which record you wanted once you are already standing in the field. This
 * is the button you press in the yard before driving out.
 */
export function OfflinePanel() {
  const qc = useQueryClient()
  const { cropYear } = useCropYear()
  const online = useOnline()
  const [progress, setProgress] = useState<WarmProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<string | null>(() => localStorage.getItem(LAST_KEY))

  const [zoom, setZoom] = useState(ZOOMS[1])
  const [mapProgress, setMapProgress] = useState<{ done: number; total: number } | null>(null)
  const [mapRunning, setMapRunning] = useState(false)

  // Both of these are questions about this device rather than about the farm,
  // and both are asked through the query cache so they invalidate the same way
  // everything else does. Their keys are in the never-persist set: a tile count
  // restored from a week ago describes a phone, not a record.
  const { data: saved } = useQuery({
    queryKey: ['offline_cache', 'counts'],
    queryFn: async () => ({ tiles: await cachedTileCount(), files: await cachedFileCount() }),
  })

  const { data: plan } = useQuery({
    queryKey: ['offline_cache', 'plan', zoom.max, running],
    queryFn: async (): Promise<{ tiles: Tile[]; files: string[] } | null> => {
      const { boxes, files } = await mapAndFileTargets(qc)
      if (!boxes.length) return null
      return {
        tiles: tilesForBoxes(boxes, MIN_ZOOM, zoom.max),
        files: files.map((f) => f.storage_path),
      }
    },
  })

  const refreshSaved = () => qc.invalidateQueries({ queryKey: ['offline_cache', 'counts'] })

  const runMap = async () => {
    if (!plan) return
    setMapRunning(true)
    setMapProgress({ done: 0, total: plan.tiles.length + plan.files.length })
    const tiles = await downloadTiles(plan.tiles, (p) =>
      setMapProgress({ done: p.done, total: plan.tiles.length + plan.files.length }),
    )
    await downloadFiles(plan.files, (p) =>
      setMapProgress({
        done: tiles.done + p.done,
        total: plan.tiles.length + plan.files.length,
      }),
    )
    await refreshSaved()
    setMapRunning(false)
  }

  const wipeMap = async () => {
    await clearTiles()
    await clearFiles()
    await refreshSaved()
  }

  const run = async () => {
    setRunning(true)
    setProgress(null)
    const result = await warmOffline(qc, cropYear, setProgress)
    // Only claim it if the whole set landed. "Saved" next to a list of things
    // that failed is the sort of reassurance that gets somebody to the far end
    // of the farm without the label they went for.
    if (!result.failed.length) {
      const now = new Date()
      localStorage.setItem(LAST_KEY, now.toISOString())
      // The background pass reads this one to decide whether it is due. Writing
      // only the ISO string would leave a manual save invisible to it, and the
      // automatic top-up would run again minutes later for nothing.
      localStorage.setItem(LAST_KEY + '-ms', String(now.getTime()))
      setLast(now.toISOString())
    }
    setRunning(false)
  }

  const wipe = async () => {
    await clearOfflineCache()
    qc.clear()
    localStorage.removeItem(LAST_KEY)
    localStorage.removeItem(LAST_KEY + '-ms')
    setLast(null)
    setProgress(null)
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <CloudOff className="h-4 w-4 text-gray-400" /> Offline access
      </h3>
      <div className="mt-1 flex items-start gap-1 text-xs text-gray-500">
        <span>Records save themselves twice a day; this saves them now.</span>
        <InfoPopover title="Offline access">
          <p>
            This mostly looks after itself. Everything the app loads is kept on the device for a
            week, and the main records — fields and boundaries, the crop plan, chemical labels,
            contacts, equipment, people, pivots, tasks, cattle — are topped up in the background
            twice a day, so they are there whether or not you happened to open that screen. The
            button is for when you would rather not wait for the next top-up.
          </p>
        </InfoPopover>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={running || !online}
          className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {running ? 'Saving…' : 'Save records now'}
        </button>
        <button
          onClick={() => void wipe()}
          disabled={running}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Clear saved data
        </button>
        {!online && <span className="text-xs text-amber-800">Needs a connection.</span>}
      </div>

      {running && progress && (
        <div className="mt-2">
          <div className="h-1 w-full overflow-hidden rounded bg-gray-100">
            <div
              className="h-full bg-brand-700 transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            {progress.done} of {progress.total}
            {progress.label && ` · ${progress.label}`}
          </p>
        </div>
      )}

      {!running && progress?.failed.length ? (
        <p className="mt-2 text-[11px] text-red-700">
          Saved {progress.total - progress.failed.length} of {progress.total}. Could not get:{' '}
          {progress.failed.join(', ')}. Try again on better signal.
        </p>
      ) : null}

      {!running && last && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          Last saved {new Date(last).toLocaleString('en-CA')}
        </p>
      )}

      {/* Imagery and files — the heavy half, kept separate because it is the
          half worth deciding about rather than just pressing. */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <h4 className="text-xs font-semibold text-gray-800">Map imagery and files</h4>
        <HelpNote
          className="mt-0.5"
          title="Map imagery and files"
          summary="Satellite imagery around your fields, plus field photos and documents."
        >
          <p>
            This half does need asking, because it is megabytes rather than kilobytes and that is a
            decision on a rural phone plan rather than a default. Field shapes already draw with no
            signal, but on grey; this saves the satellite imagery under them, and the photos and
            documents attached to your fields — which are the one thing that is never saved just by
            looking at it. Only ground within about 450 m of a field: the farm's bounding box is
            mostly other people's land and would be fifteen times the size.
          </p>
          <p>
            Imagery is Esri's World Imagery, the same basemap the map already draws. Panning around
            a field while you have signal saves those tiles too, so this button is a head start
            rather than the only way to fill it.
          </p>
        </HelpNote>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {ZOOMS.map((z) => (
            <button
              key={z.max}
              onClick={() => setZoom(z)}
              disabled={mapRunning}
              className={cn(
                'rounded-md border px-2 py-1 text-left text-[11px] disabled:opacity-40',
                zoom.max === z.max
                  ? 'border-brand-700 bg-brand-50 text-brand-900'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              )}
            >
              <span className="font-semibold">{z.label}</span>
              <span className="block text-gray-400">{z.hint}</span>
            </button>
          ))}
        </div>

        {plan && (
          <p className="mt-1.5 text-[11px] text-gray-500">
            {plan.tiles.length.toLocaleString('en-CA')} tiles, about{' '}
            <b>{mb(estimateBytes(plan.tiles.length))}</b>, plus {plan.files.length} file
            {plan.files.length === 1 ? '' : 's'}.
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void runMap()}
            disabled={mapRunning || !online || !plan}
            className="flex items-center gap-1.5 rounded-md border border-brand-700 px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-40"
          >
            {mapRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {mapRunning ? 'Downloading…' : 'Download imagery and files'}
          </button>
          <button
            onClick={() => void wipeMap()}
            disabled={mapRunning}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        {mapRunning && mapProgress && (
          <div className="mt-2">
            <div className="h-1 w-full overflow-hidden rounded bg-gray-100">
              <div
                className="h-full bg-brand-700 transition-all"
                style={{ width: `${(mapProgress.done / Math.max(1, mapProgress.total)) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              {mapProgress.done.toLocaleString('en-CA')} of{' '}
              {mapProgress.total.toLocaleString('en-CA')} — this one takes a few minutes and can be
              left running.
            </p>
          </div>
        )}

        {!mapRunning && saved && (saved.tiles > 0 || saved.files > 0) && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            {saved.tiles.toLocaleString('en-CA')} tiles and {saved.files} file
            {saved.files === 1 ? '' : 's'} on this device
          </p>
        )}
      </div>

      <HelpNote
        className="mt-3 border-t border-gray-100 pt-2"
        title="What is not saved offline"
        summary="Live readings and edits need a connection."
      >
        <p>
          Live readings are deliberately left out — pivot positions, the turbine panel, the river.
          With no connection those screens say so rather than showing you the last number they saw,
          because a Tuesday pivot angle on a Thursday screen looks exactly like a Thursday one.
          Nothing can be edited or sent while offline either; changes are refused at the time rather
          than held and replayed hours later against records that have moved.
        </p>
      </HelpNote>
    </section>
  )
}
