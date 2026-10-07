import { useMemo, useState } from 'react'
import { CheckCircle2, Circle, CircleDot, List, Map as MapIcon, X } from 'lucide-react'
import { ChecklistPlacesMap, type MapPlace } from '@/components/ChecklistPlacesMap'
import { PillTabs } from '@/components/PillTabs'
import {
  PLAIN_COLOUR,
  STATUS_LABEL,
  categoriesOf,
  placeStatus,
  useNoteToTemplate,
  usePhotoToTemplate,
  usePhotos,
  useRunLocations,
  useSaveRunNote,
  type PlaceStatus,
  type RunLocation,
} from '@/lib/checklist-map'
import { useCheckRunItem, type RunItemRow, type RunRow } from '@/lib/checklists'
import { cn } from '@/lib/utils'
import { AddJob } from './AddJob'
import { PhotoStrip } from './PhotoStrip'

const StatusIcon = ({ s }: { s: PlaceStatus }) =>
  s === 'done' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : s === 'partial' ? <CircleDot className="h-4 w-4 text-amber-500" /> : <Circle className="h-4 w-4 text-red-500" />

/**
 * A map checklist's year: every place on the map in its status colour, the
 * same places as a list, and one place opened — its instructions and photos
 * from the template, its jobs to tick, and this year's note and photos.
 */
export function RunMap({
  run,
  items,
  userName,
}: {
  run: RunRow
  items: RunItemRow[]
  userName: (id: string | null) => string
}) {
  const { data: places } = useRunLocations(run.id)
  const [view, setView] = useState<'map' | 'list'>('map')
  const [selected, setSelected] = useState<string | null>(null)

  const byPlace = useMemo(() => {
    const m = new Map<string, RunItemRow[]>()
    for (const i of items) if (i.run_location_id) m.set(i.run_location_id, [...(m.get(i.run_location_id) ?? []), i])
    return m
  }, [items])
  const general = items.filter((i) => !i.run_location_id)
  const status = (id: string) => placeStatus(byPlace.get(id) ?? [])
  const mapPlaces: MapPlace[] = (places ?? []).map((p) => ({ id: p.id, name: p.name, geojson: p.geojson, colour: p.colour ?? PLAIN_COLOUR, status: status(p.id) }))
  const kinds = categoriesOf(places ?? [])
  const counts = (places ?? []).reduce((c, p) => ({ ...c, [status(p.id)]: c[status(p.id)] + 1 }), { done: 0, partial: 0, todo: 0 } as Record<PlaceStatus, number>)
  const open = places?.find((p) => p.id === selected) ?? null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs
          tabs={[
            { key: 'map', label: <span className="flex items-center gap-1"><MapIcon className="h-4 w-4" /> Map</span> },
            { key: 'list', label: <span className="flex items-center gap-1"><List className="h-4 w-4" /> List</span> },
          ]}
          value={view}
          onChange={setView}
        />
        <span className="flex items-center gap-3 text-xs text-gray-600">
          {(['todo', 'partial', 'done'] as PlaceStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <StatusIcon s={s} /> {STATUS_LABEL[s]} {counts[s]}
            </span>
          ))}
        </span>
      </div>
      {kinds.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white">
          {kinds.map((k) => (
            <span key={k.category} className="flex items-center gap-1.5">
              {k.colours.map((c) => (
                <span key={c} className="h-1.5 w-5 rounded-full" style={{ background: c }} />
              ))}
              {k.category}
            </span>
          ))}
          <span className="ml-auto text-gray-300">Outline: dark = not started · amber = started · faded white = done</span>
        </div>
      )}

      <div className={cn('grid gap-3', open && 'lg:grid-cols-[1fr_380px]')}>
        {view === 'map' ? (
          <ChecklistPlacesMap places={mapPlaces} selected={selected} onSelect={setSelected} className="relative h-[65vh] min-h-[380px] w-full overflow-hidden rounded-lg border border-gray-200" />
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {(places ?? []).map((p) => {
              const its = byPlace.get(p.id) ?? []
              return (
                <li key={p.id}>
                  <button onClick={() => setSelected(p.id)} className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-50', selected === p.id && 'bg-brand-50')}>
                    <StatusIcon s={status(p.id)} />
                    <span className="h-2 w-4 shrink-0 rounded-full ring-1 ring-gray-300" style={{ background: p.colour ?? PLAIN_COLOUR }} title={p.category ?? undefined} />
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{p.name}</span>
                    {p.category && <span className="hidden text-xs text-gray-500 sm:inline">{p.category}</span>}
                    <span className="text-xs text-gray-500">
                      {its.filter((i) => i.checked).length}/{its.length}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {open && <PlacePanel key={open.id} run={run} place={open} items={byPlace.get(open.id) ?? []} userName={userName} onClose={() => setSelected(null)} />}
      </div>

      {general.length > 0 && <GeneralItems run={run} items={general} />}
    </div>
  )
}

function PlacePanel({ run, place, items, userName, onClose }: { run: RunRow; place: RunLocation; items: RunItemRow[]; userName: (id: string | null) => string; onClose: () => void }) {
  const check = useCheckRunItem(run.id)
  const saveNote = useSaveRunNote(run.id)
  const toTemplate = useNoteToTemplate(run.template_id)
  // Remounted per place (keyed by the parent), so this starts from that place's note.
  const [note, setNote] = useState(place.note ?? '')
  const { data: photos } = usePhotos({
    templateLocationIds: place.template_location_id ? [place.template_location_id] : [],
    runLocationIds: [place.id],
  })
  const howTo = (photos ?? []).filter((p) => p.template_location_id)
  const found = (photos ?? []).filter((p) => p.run_location_id)
  const keep = usePhotoToTemplate()
  const keptPaths = new Set(howTo.map((p) => p.storage_path))
  const unkept = found.filter((p) => !keptPaths.has(p.storage_path))
  const s = placeStatus(items)

  return (
    <aside className="rounded-lg border border-gray-200 bg-white p-3 text-sm lg:max-h-[65vh] lg:overflow-auto">
      <div className="flex items-start gap-2">
        <StatusIcon s={s} />
        <h2 className="min-w-0 flex-1 font-semibold text-gray-900">
          {place.name}
          {place.category && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 align-middle text-[11px] font-medium text-gray-700">
              <span className="h-2 w-2 rounded-full ring-1 ring-gray-300" style={{ background: place.colour ?? PLAIN_COLOUR }} />
              {place.category}
            </span>
          )}
        </h2>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {place.instructions_md && <p className="mt-2 whitespace-pre-wrap text-gray-700">{place.instructions_md}</p>}
      {howTo.length > 0 && (
        <div className="mt-2">
          <PhotoStrip photos={howTo} target={{}} canAdd={false} />
        </div>
      )}

      <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-100">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-2 px-2 py-2">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={i.checked} onChange={(e) => check.mutate({ itemId: i.id, checked: e.target.checked })} />
            <span className={cn('flex-1', i.checked && 'text-gray-400 line-through')}>
              {i.item_text_snapshot}
              {i.checked && i.checked_by && (
                <span className="ml-1 text-xs text-gray-400 no-underline">
                  {userName(i.checked_by)}
                  {i.checked_at ? ` · ${new Date(i.checked_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {s !== 'done' && items.length > 1 && (
        <button
          onClick={() => items.filter((i) => !i.checked).forEach((i) => check.mutate({ itemId: i.id, checked: true }))}
          className="mt-2 w-full rounded-md bg-brand-700 py-2 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Mark this place done
        </button>
      )}
      {check.isError && <p className="mt-1 text-xs text-red-600">{(check.error as Error).message}</p>}
      <AddJob runId={run.id} templateId={run.template_id} runLocationId={place.id} keeps={Boolean(run.template_id && place.template_location_id)} />

      <label className="mt-3 block text-xs font-medium text-gray-600">
        Notes for {run.crop_year}
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (place.note ?? '') && saveNote.mutate({ id: place.id, note: note.trim() || null })}
          placeholder="Anything found or done differently this year"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
      </label>
      {place.note_by && place.note_at && (
        <p className="text-[11px] text-gray-400">
          {userName(place.note_by)} · {new Date(place.note_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
        </p>
      )}
      {place.note && place.template_location_id && (
        <button
          onClick={() => toTemplate.mutate(place.id)}
          disabled={toTemplate.isPending || toTemplate.isSuccess}
          className="mt-1 text-xs font-medium text-brand-700 underline disabled:text-gray-400 disabled:no-underline"
        >
          {toTemplate.isSuccess ? 'Added to next year’s instructions' : 'Add this note to next year’s instructions'}
        </button>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-gray-600">Photos from {run.crop_year}</p>
        <PhotoStrip
          photos={found}
          target={{ runLocationId: place.id }}
          canAdd
          kept={keptPaths}
          onKeep={place.template_location_id ? (p) => keep.mutate([p.id]) : undefined}
        />
        {place.template_location_id && unkept.length > 0 && (
          <button
            onClick={() => keep.mutate(unkept.map((p) => p.id))}
            disabled={keep.isPending}
            className="mt-1 text-xs font-medium text-brand-700 underline disabled:text-gray-400"
          >
            Keep {unkept.length === 1 ? 'this photo' : `all ${unkept.length} photos`} for next year
          </button>
        )}
        {(keep.error || toTemplate.error) && <p className="mt-1 text-xs text-red-600">{((keep.error ?? toTemplate.error) as Error).message}</p>}
      </div>
    </aside>
  )
}

/** Jobs not tied to a place (the template's older, general list). */
function GeneralItems({ run, items }: { run: RunRow; items: RunItemRow[] }) {
  const check = useCheckRunItem(run.id)
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">General</h2>
      <ul className="mt-1 divide-y divide-gray-100">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-2 py-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={i.checked} onChange={(e) => check.mutate({ itemId: i.id, checked: e.target.checked })} />
            <span className={cn(i.checked && 'text-gray-400 line-through')}>{i.item_text_snapshot}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
