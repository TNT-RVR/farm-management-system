import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Camera, Check, Crosshair, Pencil, Plus, Trash2, X } from 'lucide-react'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { boundariesForYear, useAllBoundaries, useFields } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import { useHere } from '@/lib/useHere'
import { useAuth, hasManagerAccess } from '@/lib/auth'
import { RecordEditModal } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { SoilMoistureEntry } from '@/components/SoilMoistureEntry'
import {
  SCOUT_CATEGORIES,
  SCOUT_SUBJECTS,
  SEVERITY,
  useDeleteScoutNote,
  useSaveScoutNote,
  useFieldScoutNotes,
  useScoutNotes,
  useScoutPhotoUrls,
  useUpdateScoutNote,
  type ScoutCategory,
  type ScoutNote,
} from '@/lib/scouting'
import { EMPTY_SOIL_READING, readingProblem, readingToMm, useFieldCapacity, useSaveSoilReading } from '@/lib/soil-moisture'
import { useUnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { farmMapCenter } from '@/lib/farm-setup'

const colourOf = (c: ScoutCategory) => SCOUT_CATEGORIES.find((x) => x.value === c)?.colour ?? '#0284c7'
const when = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * Scouting: pins for weeds, insects and disease, with photos. Dropped from a
 * phone standing in the field (the location and field fill themselves in), or
 * from the office by picking a field. The map shows the year's pins by
 * category; open ones solid, cleared ones faded.
 */
export function ScoutingPage() {
  const { cropYear } = useCropYear()
  const { data: notes } = useScoutNotes(cropYear)
  const { data: fields } = useFields()
  // ?new=1 (the home-screen tile) opens straight on the form; ?field= pre-picks one.
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(params.get('new') === '1')
  const startField = params.get('field')
  const closeForm = () => {
    setAdding(false)
    if (params.has('new') || params.has('field')) setParams({}, { replace: true })
  }
  const [filter, setFilter] = useState<'all' | ScoutCategory>('all')
  const [showCleared, setShowCleared] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const shown = useMemo(
    () => (notes ?? []).filter((n) => (filter === 'all' || n.category === filter) && (showCleared || !n.resolved_at)),
    [notes, filter, showCleared],
  )
  const nameOf = (id: string | null) => fields?.find((f) => f.id === id)?.name ?? 'No field'
  const open = notes?.find((n) => n.id === openId) ?? null

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Scouting</h1>
          <p className="text-xs text-gray-500">Weeds, insects and disease, pinned where they were seen, {cropYear}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filter}
            ariaLabel="Category"
            className="w-36"
            onChange={(v) => setFilter(v as 'all' | ScoutCategory)}
            options={[{ value: 'all', label: 'All kinds' }, ...SCOUT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]}
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} />
            Show cleared
          </label>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" /> New pin
          </button>
        </div>
      </div>

      {adding && <ScoutForm cropYear={cropYear} initialField={startField} onClose={closeForm} />}

      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <ScoutMap notes={shown} cropYear={cropYear} onPick={setOpenId} />
        <ul className="max-h-[70vh] divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-200 bg-white text-sm">
          {shown.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => setOpenId(n.id)} className={cn('flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50', n.resolved_at && 'opacity-60')}>
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colourOf(n.category) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900">
                    {n.subject || SCOUT_CATEGORIES.find((c) => c.value === n.category)?.label}
                    <span className="ml-1 text-xs font-normal text-gray-500">{SEVERITY[n.severity]}</span>
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {nameOf(n.field_id)} · {when(n.observed_at)}
                    {n.photo_paths.length ? ` · ${n.photo_paths.length} photo${n.photo_paths.length === 1 ? '' : 's'}` : ''}
                    {n.resolved_at ? ' · cleared' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-8 text-center text-xs text-gray-500">No pins yet. Tap New pin in the field — it finds where you are.</li>}
        </ul>
      </div>

      {open && <ScoutDetail note={open} fieldName={nameOf(open.field_id)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function ScoutForm({ cropYear, initialField = null, onClose }: { cropYear: number; initialField?: string | null; onClose: () => void }) {
  const here = useHere(true)
  const { data: fields } = useFields()
  const save = useSaveScoutNote()
  const [category, setCategory] = useState<ScoutCategory>('weed')
  const [subject, setSubject] = useState('')
  const [severity, setSeverity] = useState(2)
  const [note, setNote] = useState('')
  // null until somebody picks: until then the field underfoot is the answer.
  const [fieldChoice, setFieldChoice] = useState<string | null>(initialField)
  const fieldId = fieldChoice ?? here.fieldId ?? ''
  const [usePosition, setUsePosition] = useState(true)
  const [photos, setPhotos] = useState<File[]>([])

  // Optional soil moisture, filed as today's AIMM reading for the field.
  const [soil, setSoil] = useState(EMPTY_SOIL_READING)
  const u = useUnitSystem()
  const fc = useFieldCapacity(fieldId || null)
  const saveSoil = useSaveSoilReading()
  const soilMm = fieldId ? readingToMm(soil, fc, u) : null
  const soilProblem = fieldId ? readingProblem(soil, fc, u) : null

  const lngLat = usePosition && here.lngLat ? here.lngLat : null
  const submit = async () => {
    if (soilProblem) return
    // The reading first: it replaces the day's reading, so if the pin then
    // fails to save, pressing Save again does no harm.
    if (soilMm != null) {
      try {
        await saveSoil.mutateAsync({
          fieldId,
          readOn: new Date().toLocaleDateString('en-CA'),
          mm: soilMm,
          fc,
          method: soil.method,
          note: soil.note.trim() || 'From a scouting pin',
        })
      } catch {
        return
      }
    }
    save.mutate(
      {
        crop_year: cropYear,
        field_id: fieldId || null,
        category,
        subject: subject.trim() || null,
        severity,
        note: note.trim() || null,
        lat: lngLat ? lngLat[1] : null,
        lng: lngLat ? lngLat[0] : null,
        photos,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">New scouting pin</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-wrap gap-1">
          {SCOUT_CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => {
                setCategory(c.value)
                setSubject('')
              }}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium', category === c.value ? 'border-transparent text-white' : 'border-gray-300 bg-white text-gray-700')}
              style={category === c.value ? { backgroundColor: c.colour } : undefined}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={cn('flex-1 rounded-md border px-2 py-1 text-xs', severity === s ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700')}
            >
              {SEVERITY[s]}
            </button>
          ))}
        </div>
        <div>
          <input
            list={`scout-subjects-${category}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What was it? (kochia, flea beetles…)"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <datalist id={`scout-subjects-${category}`}>
            {SCOUT_SUBJECTS[category].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <Select
          value={fieldId}
          ariaLabel="Field"
          placeholder="Field"
          onChange={setFieldChoice}
          options={[{ value: '', label: 'No field' }, ...(fields ?? []).map((f) => ({ value: f.id, label: f.name }))]}
        />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Notes — how many, how far in, stage…" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2" />
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={usePosition} onChange={(e) => setUsePosition(e.target.checked)} />
          <Crosshair className="h-3.5 w-3.5" />
          {here.status === 'locating'
            ? 'Finding where you are…'
            : here.lngLat
              ? `Pin where I'm standing${here.fieldName ? ` (${here.inside ? 'in' : 'near'} ${here.fieldName})` : ''}`
              : here.status === 'error'
                ? `No location: ${here.error}`
                : 'No location yet'}
          {!here.lngLat && (
            <button type="button" onClick={here.ask} className="text-brand-700 underline">
              try again
            </button>
          )}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-700">
          <Camera className="h-4 w-4" />
          <span>{photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Add photos'}</span>
          <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files ?? [])])} />
        </label>
        <div className="sm:col-span-2">
          <SoilMoistureEntry fieldId={fieldId || null} value={soil} onChange={setSoil} />
        </div>
      </div>
      {!lngLat && !fieldId && <p className="mt-2 text-xs text-amber-700">With no location and no field, the pin will be in the list but not on the map.</p>}
      {saveSoil.error && <p className="mt-2 text-xs text-red-700">Soil moisture not saved: {(saveSoil.error as Error).message}</p>}
      {save.error && <p className="mt-2 text-xs text-red-700">{(save.error as Error).message}</p>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={save.isPending || saveSoil.isPending || !!soilProblem}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {save.isPending || saveSoil.isPending ? 'Saving…' : 'Save pin'}
        </button>
      </div>
    </div>
  )
}

function ScoutDetail({ note, fieldName, onClose }: { note: ScoutNote; fieldName: string; onClose: () => void }) {
  const { profile, session } = useAuth()
  const { data: urls } = useScoutPhotoUrls(note.photo_paths)
  const update = useUpdateScoutNote()
  const del = useDeleteScoutNote()
  const { data: fields } = useFields()
  // Sam, 7 Oct 2026: a pin's note, category, severity and field can be
  // corrected, not just cleared or deleted. Same rule as the update policy:
  // a manager, or whoever dropped the pin.
  const [editing, setEditing] = useState(false)
  const canEdit = hasManagerAccess(profile?.role) || note.created_by === session?.user.id
  if (editing)
    return (
      <RecordEditModal
        title="Edit scouting pin"
        row={{ ...note, severity: String(note.severity), field_id: note.field_id ?? '' }}
        fields={[
          { key: 'category', label: 'Category', kind: 'select', required: true, options: SCOUT_CATEGORIES.map((c) => ({ value: c.value, label: c.label })) },
          { key: 'severity', label: 'How bad', kind: 'select', required: true, options: [1, 2, 3].map((s) => ({ value: String(s), label: SEVERITY[s] })) },
          { key: 'subject', label: 'What was it', kind: 'text', placeholder: 'Kochia, flea beetles…' },
          { key: 'field_id', label: 'Field', kind: 'select', options: [{ value: '', label: 'No field' }, ...(fields ?? []).map((f) => ({ value: f.id, label: f.name }))] },
          { key: 'note', label: 'Notes', kind: 'textarea' },
        ]}
        saving={update.isPending}
        error={update.error ? (update.error as Error).message : null}
        onClose={() => setEditing(false)}
        onSave={(p) =>
          update.mutateAsync({
            id: note.id,
            category: p.category as ScoutCategory,
            severity: Number(p.severity) || 2,
            subject: (p.subject as string | null) ?? null,
            field_id: (p.field_id as string | null) ?? null,
            note: (p.note as string | null) ?? null,
          })
        }
      />
    )
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label="Scouting pin" className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-4 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-900">
              {note.subject || SCOUT_CATEGORIES.find((c) => c.value === note.category)?.label} <span className="font-normal text-gray-500">· {SEVERITY[note.severity]}</span>
            </h2>
            <p className="text-xs text-gray-500">
              {fieldName} · {new Date(note.observed_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
              {note.lat != null && ` · ${note.lat.toFixed(4)}, ${note.lng?.toFixed(4)}`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {note.note && <p className="mt-2 whitespace-pre-wrap text-gray-800">{note.note}</p>}
        {!!urls?.length && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {urls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                <img src={u} alt="" className="h-40 w-full rounded object-cover" />
              </a>
            ))}
          </div>
        )}
        {canEdit && (
          <div className="mt-4 flex justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                if (confirm('Delete this pin and its photos?')) del.mutate(note, { onSuccess: onClose })
              }}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  update.reset()
                  setEditing(true)
                }}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                type="button"
                onClick={() => update.mutate({ id: note.id, resolved_at: note.resolved_at ? null : new Date().toISOString() })}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Check className="h-3.5 w-3.5" /> {note.resolved_at ? 'Reopen' : 'Mark cleared'}
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** The year's pins over the fields. A pin with no position sits at its field's centre. */
function ScoutMap({ notes, cropYear, onPick }: { notes: ScoutNote[]; cropYear: number; onPick: (id: string) => void }) {
  const { data: allBoundaries } = useAllBoundaries()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const pickRef = useRef(onPick)
  useEffect(() => {
    pickRef.current = onPick
  }, [onPick])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({ container: containerRef.current, style: SATELLITE_STYLE, center: farmMapCenter(), zoom: 10, attributionControl: { compact: true } })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.on('load', () => {
      map.addSource('scout-fields', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'scout-fields-line', type: 'line', source: 'scout-fields', paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.8 } })
      map.addSource('scout-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'scout-pins',
        type: 'circle',
        source: 'scout-pins',
        paint: {
          'circle-color': ['get', 'colour'],
          'circle-radius': ['+', 4, ['*', 2, ['get', 'severity']]],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': ['case', ['get', 'cleared'], 0.4, 0.95],
        },
      })
      map.on('click', 'scout-pins', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (id) pickRef.current(String(id))
      })
      map.on('mouseenter', 'scout-pins', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'scout-pins', () => (map.getCanvas().style.cursor = ''))
      setReady(true)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  const framed = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !allBoundaries) return
    const shapes = boundariesForYear(allBoundaries, cropYear).filter((b) => b.geometry)
    const centre = new Map<string, [number, number]>()
    const bounds = new maplibregl.LngLatBounds()
    for (const s of shapes) {
      const b = new maplibregl.LngLatBounds()
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === 'number') b.extend(c as [number, number])
        else if (Array.isArray(c)) c.forEach(walk)
      }
      walk((s.geometry as unknown as { coordinates: unknown }).coordinates)
      if (!b.isEmpty()) {
        centre.set(s.field_id, b.getCenter().toArray() as [number, number])
        bounds.extend(b)
      }
    }
    ;(map.getSource('scout-fields') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: shapes.map((s) => ({ type: 'Feature', geometry: s.geometry as never, properties: {} })),
    })
    const pins = notes
      .map((n) => {
        const at: [number, number] | undefined = n.lat != null && n.lng != null ? [n.lng, n.lat] : n.field_id ? centre.get(n.field_id) : undefined
        return at ? { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: at }, properties: { id: n.id, colour: colourOf(n.category), severity: n.severity, cleared: !!n.resolved_at } } : null
      })
      .filter((f): f is NonNullable<typeof f> => f != null)
    ;(map.getSource('scout-pins') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pins })
    if (!framed.current && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 30, duration: 0 })
      framed.current = true
    }
  }, [ready, allBoundaries, notes, cropYear])

  return (
    <div className="relative h-[55vh] overflow-hidden rounded-lg border border-gray-200 lg:h-[70vh]">
      {/* Full height, not absolute inset-0: maplibre-gl.css sets .maplibregl-map to position: relative, which cancels the inset and leaves the map 0 px tall. */}
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute bottom-2 left-2 flex gap-2 rounded bg-white/90 px-2 py-1 text-[11px] text-gray-700 shadow">
        {SCOUT_CATEGORIES.map((c) => (
          <span key={c.value} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.colour }} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * One field's scouting notes, every year, newest first — the Scouting tab on
 * a field. Photos open full size; the pin opens the farm-wide scouting map.
 */
export function FieldScouting({ fieldId }: { fieldId: string }) {
  const { data: notes, isLoading } = useFieldScoutNotes(fieldId)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = notes?.find((n) => n.id === openId) ?? null
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Scouting notes</h2>
        <Link
          to={`/scouting?new=1&field=${fieldId}`}
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> New scouting report
        </Link>
      </div>
      {isLoading && <p className="text-xs text-gray-500">Loading…</p>}
      {!isLoading && !notes?.length && (
        <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">Nothing scouted on this field yet.</p>
      )}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
        {(notes ?? []).map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => setOpenId(n.id)} className={cn('flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50', n.resolved_at && 'opacity-60')}>
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colourOf(n.category) }} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-gray-900">
                  {n.subject || SCOUT_CATEGORIES.find((c) => c.value === n.category)?.label}
                  <span className="ml-1 text-xs font-normal text-gray-500">{SEVERITY[n.severity]}</span>
                </span>
                {n.note && <span className="block text-xs text-gray-600">{n.note}</span>}
                <span className="block text-xs text-gray-400">
                  {new Date(n.observed_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
                  {n.photo_paths.length ? ` · ${n.photo_paths.length} photo${n.photo_paths.length === 1 ? '' : 's'}` : ''}
                  {n.resolved_at ? ' · cleared' : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <ScoutDetail note={open} fieldName="" onClose={() => setOpenId(null)} />}
    </div>
  )
}
