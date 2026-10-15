import { useRef, useState, type ReactNode } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useQuery } from '@tanstack/react-query'
import { Download, MapPin, Plus, Route, Trash2, X } from 'lucide-react'
import { ChecklistPlacesMap, type DrawMode, type MapPlace } from '@/components/ChecklistPlacesMap'
import { Select } from '@/components/Select'
import {
  PLAIN_COLOUR,
  categoriesOf,
  useAddTemplateLocations,
  useDeleteTemplateItem,
  useDeleteTemplateLocation,
  usePhotos,
  useSaveLocationItem,
  useSaveTemplateLocation,
  useTemplateLocations,
  type PlaceGeometry,
  type TemplateLocation,
} from '@/lib/checklist-map'
import { useTemplateItems, type TemplateItemRow } from '@/lib/checklists'
import { useFarmFeatures, useFarmLayers } from '@/lib/farm-layers'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { PhotoStrip } from './PhotoStrip'

const btn = 'flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50'
const btnOn = 'border-brand-700 bg-brand-700 text-white hover:bg-brand-800'

/**
 * The template's places, edited on the map: drop pins, draw pipelines, or
 * bring them in from the farm's My Map or the pump list; give each place its
 * instructions, photos and jobs. Every new year's checklist is copied from
 * what is here on 1 January.
 */
export function TemplatePlaces({ templateId, readonly }: { templateId: string; readonly: boolean }) {
  const { data: places } = useTemplateLocations(templateId)
  const { data: items } = useTemplateItems(templateId)
  const save = useSaveTemplateLocation(templateId)
  const [draw, setDraw] = useState<DrawMode | 'move'>('none')
  const [selected, setSelected] = useState<string | null>(null)
  const [importing, setImporting] = useState<null | 'mymap' | 'pumps'>(null)

  const jobsAt = (id: string) => (items ?? []).filter((i) => i.location_id === id)
  const mapPlaces: MapPlace[] = (places ?? []).map((p) => ({ id: p.id, name: p.name, geojson: p.geojson, colour: p.colour ?? PLAIN_COLOUR }))
  const kinds = categoriesOf(places ?? [])
  const open = places?.find((p) => p.id === selected) ?? null
  const nextOrder = () => (places?.reduce((m, p) => Math.max(m, p.sort_order), 0) ?? 0) + 1

  const add = async (geojson: PlaceGeometry) => {
    const name = window.prompt(geojson.type === 'Point' ? 'Name this place (e.g. "#4 pump", "Shop yard hydrant")' : 'Name this pipeline (e.g. "#4 Mainline")')
    setDraw('none')
    if (!name?.trim()) return
    const id = await save.mutateAsync({ name: name.trim(), geojson, sort_order: nextOrder(), source: 'drawn' })
    setSelected(id)
  }

  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-gray-700">Places on the map · {places?.length ?? 0}</h3>
        {!readonly && (
          <>
            <button className={cn(btn, draw === 'pin' && btnOn)} onClick={() => setDraw(draw === 'pin' ? 'none' : 'pin')}>
              <MapPin className="h-3.5 w-3.5" /> Add pin
            </button>
            <button className={cn(btn, draw === 'line' && btnOn)} onClick={() => setDraw(draw === 'line' ? 'none' : 'line')}>
              <Route className="h-3.5 w-3.5" /> Draw pipeline
            </button>
            <button className={btn} onClick={() => setImporting('mymap')}>
              <Download className="h-3.5 w-3.5" /> From the farm map
            </button>
            <button className={btn} onClick={() => setImporting('pumps')}>
              <Download className="h-3.5 w-3.5" /> Pumps
            </button>
          </>
        )}
      </div>

      <div className={cn('mt-3 grid gap-3', open && 'lg:grid-cols-[1fr_380px]')}>
        <ChecklistPlacesMap
          places={mapPlaces}
          selected={selected}
          onSelect={setSelected}
          draw={draw === 'move' ? (open?.geojson.type === 'LineString' ? 'line' : 'pin') : draw}
          onAddPin={(at) => {
            if (draw === 'move' && open) {
              save.mutate({ ...open, geojson: { type: 'Point', coordinates: at } })
              setDraw('none')
            } else void add({ type: 'Point', coordinates: at })
          }}
          onFinishLine={(line) => {
            if (draw === 'move' && open) {
              save.mutate({ ...open, geojson: line })
              setDraw('none')
            } else void add(line)
          }}
        />
        {open && (
          <PlaceEditor
            key={open.id}
            templateId={templateId}
            place={open}
            kinds={kinds}
            jobs={jobsAt(open.id)}
            readonly={readonly}
            moving={draw === 'move'}
            onMove={() => setDraw(draw === 'move' ? 'none' : 'move')}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
      {kinds.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white">
          {kinds.map((k) => (
            <span key={k.category} className="flex items-center gap-1.5">
              {k.colours.map((c) => (
                <span key={c} className="h-1.5 w-5 rounded-full" style={{ background: c }} />
              ))}
              {k.category}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500">Colours are the kind of job; set a place&apos;s job type and colour when you open it. A place with no jobs shows one &ldquo;Done&rdquo; on the year&apos;s checklist.</p>

      {importing === 'mymap' && <FarmMapPick templateId={templateId} existing={places ?? []} nextOrder={nextOrder()} onClose={() => setImporting(null)} />}
      {importing === 'pumps' && <PumpImport templateId={templateId} existing={places ?? []} nextOrder={nextOrder()} onClose={() => setImporting(null)} />}
    </section>
  )
}

function PlaceEditor({
  templateId,
  place,
  kinds,
  jobs,
  readonly,
  moving,
  onMove,
  onClose,
}: {
  templateId: string
  place: TemplateLocation
  kinds: { category: string; colours: string[] }[]
  jobs: TemplateItemRow[]
  readonly: boolean
  moving: boolean
  onMove: () => void
  onClose: () => void
}) {
  const save = useSaveTemplateLocation(templateId)
  const del = useDeleteTemplateLocation(templateId)
  const saveJob = useSaveLocationItem(templateId)
  const delJob = useDeleteTemplateItem(templateId)
  const { data: photos } = usePhotos({ templateLocationIds: [place.id] })
  const [name, setName] = useState(place.name)
  const [instructions, setInstructions] = useState(place.instructions_md ?? '')
  const [newJob, setNewJob] = useState('')
  const [category, setCategory] = useState(place.category ?? '')
  const [colour, setColour] = useState(place.colour ?? PLAIN_COLOUR)
  // The picker reports every shade it passes through; save once it settles.
  const colourTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickColour = (c: string) => {
    setColour(c)
    if (colourTimer.current) clearTimeout(colourTimer.current)
    colourTimer.current = setTimeout(() => save.mutate({ ...place, colour: c }), 600)
  }
  const field = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900'
  // Picking a job type the template already uses takes its colour too, so
  // every "Blow out" stays the same colour on the map.
  const saveCategory = (c: string) => {
    const known = kinds.find((k) => k.category.toLowerCase() === c.trim().toLowerCase())
    save.mutate({ ...place, category: c.trim() || null, colour: known ? known.colours[0] : place.colour })
  }

  return (
    <aside className="rounded-lg border border-gray-200 bg-white p-3 text-sm lg:max-h-[60vh] lg:overflow-auto">
      <div className="flex items-center gap-2">
        <input
          className={cn(field, 'font-semibold')}
          disabled={readonly}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== place.name && save.mutate({ ...place, name: name.trim() })}
        />
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      {place.source && place.source !== 'drawn' && <p className="mt-1 text-[11px] text-gray-400">From {place.source.replace(/^mymap:/, 'My Map · ').replace(/^pump:.*/, 'the pump list')}</p>}

      <div className="mt-3 flex items-end gap-2">
        <label className="block flex-1 text-xs font-medium text-gray-600">
          Job type
          <input
            className={cn(field, 'mt-1')}
            disabled={readonly}
            list={`kinds-${place.id}`}
            value={category}
            placeholder="e.g. Blow out"
            onChange={(e) => setCategory(e.target.value)}
            onBlur={() => category.trim() !== (place.category ?? '') && saveCategory(category)}
          />
          <datalist id={`kinds-${place.id}`}>
            {kinds.map((k) => (
              <option key={k.category} value={k.category} />
            ))}
          </datalist>
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Colour
          <input
            type="color"
            disabled={readonly}
            className="mt-1 block h-[34px] w-12 cursor-pointer rounded-md border border-gray-300 bg-white p-0.5"
            value={colour}
            onChange={(e) => pickColour(e.target.value)}
          />
        </label>
      </div>

      <label className="mt-3 block text-xs font-medium text-gray-600">
        Instructions
        <textarea
          rows={4}
          disabled={readonly}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => instructions !== (place.instructions_md ?? '') && save.mutate({ ...place, instructions_md: instructions.trim() || null })}
          placeholder="How to winterize this one: where the drain is, which valve, what to watch for"
          className={cn(field, 'mt-1')}
        />
      </label>

      <p className="mt-3 text-xs font-medium text-gray-600">Photos</p>
      <PhotoStrip photos={photos ?? []} target={{ templateLocationId: place.id }} canAdd={!readonly} />

      <p className="mt-3 text-xs font-medium text-gray-600">Jobs here</p>
      <ul className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-100">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center gap-2 px-2 py-1.5">
            <input
              disabled={readonly}
              defaultValue={j.text}
              onBlur={(e) => e.target.value.trim() && e.target.value !== j.text && saveJob.mutate({ id: j.id, location_id: place.id, text: e.target.value.trim(), sort_order: j.sort_order, requires_note: j.requires_note })}
              className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 hover:border-gray-200 focus:border-brand-600 focus:outline-none"
            />
            {!readonly && (
              <button onClick={() => delJob.mutate(j.id)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${j.text}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
        {!jobs.length && <li className="px-2 py-1.5 text-gray-400">No jobs yet — the year&apos;s checklist will show one &ldquo;Done&rdquo;.</li>}
      </ul>
      {!readonly && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!newJob.trim()) return
            saveJob.mutate({ location_id: place.id, text: newJob.trim(), sort_order: (jobs.at(-1)?.sort_order ?? 0) + 1 })
            setNewJob('')
          }}
        >
          <input className={field} placeholder="Add a job (e.g. Open the low-point drain)" value={newJob} onChange={(e) => setNewJob(e.target.value)} />
          <button className="flex shrink-0 items-center gap-1 rounded-md bg-brand-700 px-2.5 text-xs font-semibold text-white disabled:opacity-50" disabled={!newJob.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </form>
      )}

      {!readonly && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {place.feature_id ? (
            <span className="self-center text-[11px] text-gray-500">Follows the farm map — move or reshape it on the main Map.</span>
          ) : (
            <button className={cn(btn, moving && btnOn)} onClick={onMove}>
              {place.geojson.type === 'Point' ? 'Move pin' : 'Redraw line'}
            </button>
          )}
          <button
            className="flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            onClick={() => {
              if (window.confirm(`Remove “${place.name}” and its jobs from the template? Past years keep their copy.`)) {
                del.mutate(place.id)
                onClose()
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        </div>
      )}
    </aside>
  )
}

/**
 * Pick places off the farm map — the app's own layers (the Water layer copied
 * from the My Map, and whatever has been added since). A place made this way
 * follows its map item: move or reshape it on the main map and the
 * winterizing pin moves too.
 */
function FarmMapPick({ templateId, existing, nextOrder, onClose }: { templateId: string; existing: TemplateLocation[]; nextOrder: number; onClose: () => void }) {
  const { data: layers, isLoading } = useFarmLayers()
  const [layer, setLayer] = useState<string>('')
  const current = layer || (layers ?? []).find((l) => /water/i.test(l.name))?.id || layers?.[0]?.id || ''
  const { data: features } = useFarmFeatures(current ? [current] : [])
  const addMany = useAddTemplateLocations(templateId)
  const taken = new Set(existing.map((e) => e.feature_id).filter(Boolean))
  const usable = (features ?? []).filter((f) => f.geojson.type === 'Point' || f.geojson.type === 'LineString').sort((a, b) => (a.label ?? '~').localeCompare(b.label ?? '~'))
  const [picked, setPicked] = useState<Set<string>>(new Set())

  return (
    <Dialog title="Add places from the farm map" onClose={onClose}>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {layers && !layers.length && (
        <p className="text-sm text-gray-600">
          No farm layers yet. On the main Map, open Layers → Farm layers → &ldquo;Copy a My Map folder into the app&rdquo;.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.farmMap()}>Open the map</SetupLink>
        </p>
      )}
      {!!layers?.length && (
        <>
          <Select value={current} ariaLabel="Layer" className="w-full" onChange={(v) => { setLayer(v); setPicked(new Set()) }} options={layers.map((l) => ({ value: l.id, label: l.name }))} />
          <ul className="mt-2 max-h-[50vh] divide-y divide-gray-100 overflow-auto rounded-md border border-gray-100">
            {usable.map((f) => {
              const already = taken.has(f.id)
              return (
                <li key={f.id}>
                  <label className={cn('flex items-center gap-2 px-2 py-1.5 text-sm', already && 'text-gray-400')}>
                    <input
                      type="checkbox"
                      disabled={already}
                      checked={already || picked.has(f.id)}
                      onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n })}
                    />
                    {f.geojson.type === 'LineString' ? <Route className="h-3.5 w-3.5 text-gray-400" /> : <MapPin className="h-3.5 w-3.5 text-gray-400" />}
                    <span className="flex-1 truncate">{f.label || '(no name — name it on the main map)'}</span>
                    {already && <span className="text-[11px]">added</span>}
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <button className={btn} onClick={() => setPicked(new Set(usable.filter((f) => !taken.has(f.id)).map((f) => f.id)))}>Select all</button>
            <button
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              disabled={!picked.size || addMany.isPending}
              onClick={async () => {
                const chosen = usable.filter((f) => picked.has(f.id))
                await addMany.mutateAsync(
                  chosen.map((f, n) => ({
                    name: f.label || 'Unnamed',
                    geojson: f.geojson as PlaceGeometry,
                    source: 'farm map',
                    feature_id: f.id,
                    sort_order: nextOrder + n,
                  })),
                )
                onClose()
              }}
            >
              Add {picked.size || ''}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/** Every pump with a position, as pins. */
function PumpImport({ templateId, existing, nextOrder, onClose }: { templateId: string; existing: TemplateLocation[]; nextOrder: number; onClose: () => void }) {
  const { data: pumps } = useQuery({
    queryKey: ['pumps-located'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pumps').select('id, name, lat, lon').not('lat', 'is', null).order('name')
      if (error) throw error
      return data as { id: string; name: string; lat: number; lon: number }[]
    },
  })
  const addMany = useAddTemplateLocations(templateId)
  const taken = new Set(existing.map((e) => e.source))
  const fresh = (pumps ?? []).filter((p) => !taken.has(`pump:${p.id}`))
  return (
    <Dialog title="Add the pumps" onClose={onClose}>
      <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-auto rounded-md border border-gray-100 text-sm">
        {(pumps ?? []).map((p) => (
          <li key={p.id} className={cn('px-2 py-1.5', taken.has(`pump:${p.id}`) && 'text-gray-400')}>
            {p.name} {taken.has(`pump:${p.id}`) && <span className="text-[11px]">· added</span>}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <button
          className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          disabled={!fresh.length || addMany.isPending}
          onClick={async () => {
            await addMany.mutateAsync(fresh.map((p, n) => ({ name: p.name, geojson: { type: 'Point', coordinates: [Number(p.lon), Number(p.lat)] }, source: `pump:${p.id}`, sort_order: nextOrder + n })))
            onClose()
          }}
        >
          Add {fresh.length} pump{fresh.length === 1 ? '' : 's'}
        </button>
      </div>
    </Dialog>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <h3 className="flex-1 text-sm font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
