import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera as CameraIcon, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  CAMERA_KINDS,
  playbackProblem,
  snapshotUrl,
  useCameras,
  useDeleteCamera,
  useSaveCamera,
  type Camera,
} from '@/lib/cameras'
import { useAllFields } from '@/lib/queries'
import { MAP_STATIONS } from '@/lib/river'
import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'

const input = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900'

function CameraForm({
  existing,
  onDone,
}: {
  existing?: Camera
  onDone: () => void
}) {
  const save = useSaveCamera()
  const { data: fields } = useAllFields()
  const [d, setD] = useState({
    name: existing?.name ?? '',
    location: existing?.location ?? '',
    field_id: existing?.field_id ?? '',
    river_station: existing?.river_station ?? '',
    kind: existing?.kind ?? 'snapshot',
    stream_url: existing?.stream_url ?? '',
    refresh_seconds: String(existing?.refresh_seconds ?? 10),
    brand: existing?.brand ?? '',
    model: existing?.model ?? '',
    notes: existing?.notes ?? '',
    active: existing?.active ?? true,
  })
  const kindHint = CAMERA_KINDS.find((k) => k.value === d.kind)?.hint

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-500">
          Name *
          <input
            className={input}
            placeholder="Shop yard"
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
        </label>
        <label className="text-xs text-gray-500">
          Where it points
          <input
            className={input}
            placeholder="Facing the fuel tank"
            value={d.location}
            onChange={(e) => setD({ ...d, location: e.target.value })}
          />
        </label>
        <label className="text-xs text-gray-500">
          Field it watches
          <select
            className={input}
            value={d.field_id}
            onChange={(e) => setD({ ...d, field_id: e.target.value })}
          >
            <option value="">— none —</option>
            {(fields ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          River gauge it watches
          <select
            className={input}
            value={d.river_station}
            onChange={(e) => setD({ ...d, river_station: e.target.value })}
          >
            <option value="">— none —</option>
            {MAP_STATIONS.map((s) => (
              <option key={s.station} value={s.station}>
                {s.short}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-gray-400">
            Puts this camera on the gauge map under Irrigation → River → Map.
          </span>
        </label>
        <label className="text-xs text-gray-500">
          How it streams
          <select
            className={input}
            value={d.kind}
            onChange={(e) => setD({ ...d, kind: e.target.value as Camera['kind'] })}
          >
            {CAMERA_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          {kindHint && <span className="mt-0.5 block text-[11px] text-gray-400">{kindHint}</span>}
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">
          Address
          <input
            className={input}
            placeholder="https://…"
            value={d.stream_url}
            onChange={(e) => setD({ ...d, stream_url: e.target.value })}
          />
        </label>
        {d.kind === 'snapshot' && (
          <label className="text-xs text-gray-500">
            Refresh every (seconds)
            <input
              type="number"
              min="1"
              max="3600"
              className={input}
              value={d.refresh_seconds}
              onChange={(e) => setD({ ...d, refresh_seconds: e.target.value })}
            />
          </label>
        )}
        <label className="text-xs text-gray-500">
          Brand
          <input
            className={input}
            value={d.brand}
            onChange={(e) => setD({ ...d, brand: e.target.value })}
          />
        </label>
        <label className="text-xs text-gray-500">
          Model
          <input
            className={input}
            value={d.model}
            onChange={(e) => setD({ ...d, model: e.target.value })}
          />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">
          Notes
          <input
            className={input}
            placeholder="Power source, where the cable runs, login…"
            value={d.notes}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={d.active}
            onChange={(e) => setD({ ...d, active: e.target.checked })}
          />
          In service
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          disabled={!d.name.trim() || save.isPending}
          onClick={() =>
            save.mutate(
              {
                id: existing?.id,
                name: d.name.trim(),
                location: d.location.trim() || null,
                field_id: d.field_id || null,
                river_station: d.river_station || null,
                kind: d.kind,
                stream_url: d.stream_url.trim() || null,
                refresh_seconds: Math.min(3600, Math.max(1, Number(d.refresh_seconds) || 10)),
                brand: d.brand.trim() || null,
                model: d.model.trim() || null,
                notes: d.notes.trim() || null,
                active: d.active,
              },
              { onSuccess: onDone },
            )
          }
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onDone}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600"
        >
          Cancel
        </button>
        {save.isError && (
          <span className="self-center text-xs text-red-600">{(save.error as Error).message}</span>
        )}
      </div>
    </div>
  )
}

/** The picture itself, or a plain statement of why there isn't one. */
function CameraPicture({ camera, tick }: { camera: Camera; tick: number }) {
  const [failed, setFailed] = useState(false)
  const problem = playbackProblem(camera)
  const url = camera.stream_url ?? ''
  // The failed flag is reset by remounting — the caller keys this component on
  // the address and kind, so correcting a URL clears the error without a reload.

  if (problem) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
        <AlertTriangle className="h-5 w-5 text-amber-400" />
        <p className="text-xs text-gray-300">{problem}</p>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
        <AlertTriangle className="h-5 w-5 text-red-400" />
        <p className="text-xs text-gray-300">
          No picture. The camera may be off, or unreachable from here.
        </p>
      </div>
    )
  }

  // Each kind is whatever the browser can do with that sort of address.
  if (camera.kind === 'embed') {
    return <iframe src={url} title={camera.name} className="h-full w-full border-0" />
  }
  if (camera.kind === 'hls') {
    return (
      <video
        src={url}
        muted
        autoPlay
        playsInline
        controls
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    )
  }
  // snapshot and mjpeg are both just an image; only the refreshing differs.
  const src =
    camera.kind === 'snapshot'
      ? snapshotUrl(url, Math.floor(tick / Math.max(1, camera.refresh_seconds)))
      : url
  return (
    <img
      src={src}
      alt={camera.name}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  )
}

function CameraTile({
  camera,
  tick,
  canEdit,
  onEdit,
}: {
  camera: Camera
  tick: number
  canEdit: boolean
  onEdit: () => void
}) {
  const del = useDeleteCamera()
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-gray-200 bg-white',
        !camera.active && 'opacity-60',
      )}
    >
      <div className="aspect-video bg-gray-900">
        <CameraPicture
          key={`${camera.stream_url ?? ''}|${camera.kind}`}
          camera={camera}
          tick={tick}
        />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2">
        <span className="font-medium text-gray-900">{camera.name}</span>
        {camera.location && <span className="text-xs text-gray-500">{camera.location}</span>}
        {!camera.active && (
          <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500">out of service</span>
        )}
        {canEdit && (
          <span className="ml-auto flex items-center gap-2">
            <button onClick={onEdit} className="text-gray-300 hover:text-brand-700">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {/* Deleting took one stray tap with no way back (Sam, 7 Oct 2026). */}
            <button
              onClick={() => {
                if (window.confirm(`Delete the camera "${camera.name}"? To keep it but stop showing it, edit it and mark it out of service instead.`)) del.mutate(camera.id)
              }}
              aria-label={`Delete ${camera.name}`}
              className="text-gray-300 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

/** Every camera on the farm, on one wall. */
export function CamerasPage() {
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const [showInactive, setShowInactive] = useState(false)
  const { data: cameras, isLoading } = useCameras(showInactive)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  // One clock for the whole wall. A timer per camera would drift apart and cost
  // a render each; every snapshot camera divides this down to its own rate.
  const [tick, setTick] = useState(0)
  const needsClock = (cameras ?? []).some((c) => c.kind === 'snapshot')
  useEffect(() => {
    if (!needsClock) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [needsClock])

  const list = useMemo(() => cameras ?? [], [cameras])
  const editingCamera = list.find((c) => c.id === editing)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
            <Video className="h-5 w-5 text-brand-700" /> Cameras
          </h1>
          <p className="text-xs text-gray-500">
            {list.length === 0 ? 'No cameras yet' : `${list.length} on the farm`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Include out of service
          </label>
          {canEdit && !adding && (
            <button
              onClick={() => {
                setAdding(true)
                setEditing(null)
              }}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
            >
              <Plus className="h-4 w-4" /> Add camera
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="mb-4">
          <CameraForm onDone={() => setAdding(false)} />
        </div>
      )}
      {editingCamera && (
        <div className="mb-4">
          <CameraForm existing={editingCamera} onDone={() => setEditing(null)} />
        </div>
      )}

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">Loading…</p>
      ) : list.length === 0 && !adding ? (
        // No cameras are installed yet, so this page's first job is to be useful
        // while choosing one — the deciding question is whether it can hand a
        // browser a picture without extra software in front of it.
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center">
          <CameraIcon className="mx-auto h-7 w-7 text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">Nothing here yet</p>
          <div className="mx-auto mt-1 flex max-w-lg items-center justify-center gap-1.5 text-sm text-gray-500">
            Buying one? Check it can show a picture in a browser on its own.
            <InfoPopover title="Choosing a camera for this page">
              <p>
                When you come to buy, the thing that matters for this page is whether the camera can
                give a browser a picture on its own. Any of these work:
              </p>
              <ul>
                {CAMERA_KINDS.map((k) => (
                  <li key={k.value} className="mt-1.5">
                    <span className="font-medium text-gray-800">{k.label}</span>{' '}
                    <span className="text-gray-500">— {k.hint}</span>
                  </li>
                ))}
              </ul>
              <p>
                Most farm cameras advertise <span className="font-medium">RTSP</span>, which no browser
                can play. Those still work, but need something in between republishing the stream — so
                it is worth asking the supplier before buying, not after.
              </p>
            </InfoPopover>
          </div>
          {canEdit && (
            <button
              onClick={() => setAdding(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" /> Add one anyway
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <CameraTile
              key={c.id}
              camera={c}
              tick={tick}
              canEdit={canEdit}
              onEdit={() => {
                setEditing(c.id)
                setAdding(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
