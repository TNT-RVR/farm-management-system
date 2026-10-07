import { useEffect, useRef, useState } from 'react'
import { HelpNote } from '@/components/HelpNote'
import { Link } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowLeft, FileUp } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { ensureFarmId, useFields, type FieldRow } from '@/lib/queries'
import { parseBoundaryFile, type ParsedBoundary } from '@/lib/geo/parse-boundary-file'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { boundsOf } from '@/lib/geo/area'
import { farmMapCenter } from '@/lib/farm-setup'

/**
 * The "Create a new field" choice in a row's field picker. Not a uuid, so it
 * can never collide with a real field id.
 */
const NEW_FIELD = '__new__'

type RowState = ParsedBoundary & {
  key: number
  /** A field id, NEW_FIELD, or '' to skip the shape. */
  fieldId: string | ''
  /** Name for the field created when fieldId is NEW_FIELD. */
  newName: string
  status: 'ready' | 'importing' | 'done' | 'error'
  message?: string
}

/** A shape's own name, else a placeholder the person can overwrite. */
const defaultNewName = (b: ParsedBoundary, i: number) => b.name?.trim() || `Field ${i + 1}`

const norm = (s: string) => s.toLowerCase().replace(/[#\-_ .]+/g, '')

/** Guess the target field from the feature name: "#5 (SW 27-71-13)" → field "5/Creek Flat". */
function guessField(featureName: string | null, fields: FieldRow[]): string | '' {
  if (!featureName) return ''
  const numMatch = /^#?\s*(\d+)\b/.exec(featureName)
  if (numMatch) {
    const n = numMatch[1]
    const byNumber = fields.find((f) => f.name === n || f.name.startsWith(`${n}/`))
    if (byNumber) return byNumber.id
  }
  const paren = /\(([^)]+)\)/.exec(featureName)?.[1]
  if (paren) {
    const p = norm(paren)
    const byLegal = fields.find(
      (f) =>
        f.legal_land_description &&
        (norm(f.legal_land_description).includes(p) || p.includes(norm(f.legal_land_description).replace(/w4$/, ''))),
    )
    if (byLegal) return byLegal.id
  }
  const fn = norm(featureName)
  const byName = fields.find((f) => norm(f.name).length > 2 && fn.includes(norm(f.name)))
  return byName?.id ?? ''
}

function boundarySource(fileName: string): 'kml' | 'file_import' {
  return fileName.toLowerCase().endsWith('.kml') ? 'kml' : 'file_import'
}

export function ImportBoundariesPage() {
  const { profile } = useAuth()
  const { data: fields } = useFields()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  // State, not a ref: the container only renders once a file has rows, so the
  // map effect has to re-run when it appears. A `[]` effect with a plain ref ran
  // on first paint, found no container, and never made the preview at all.
  const [mapContainer, setMapContainer] = useState<HTMLDivElement | null>(null)
  // The farm id for new fields, looked up once per page rather than per shape.
  const farmIdRef = useRef<string | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [parsing, setParsing] = useState(false)

  const isManager = hasManagerAccess(profile?.role)

  async function handleFile(file: File) {
    setParsing(true)
    setFileName(file.name)
    setErrors([])
    setRows([])
    try {
      const result = await parseBoundaryFile(file)
      setErrors(result.errors)
      setRows(
        result.boundaries.map((b, i) => ({
          ...b,
          key: i,
          // guessField knows the original farm's naming. When it finds nothing on a
          // farm with no fields yet, the shape becomes a new field, so a new farm
          // can import its boundaries in one go. A farm that already has fields
          // keeps the old default — skip — so an import of updated boundaries
          // never quietly adds a field for a shape somebody meant to leave out;
          // "Create all unmatched" is there when they do want them.
          fieldId: (fields ? guessField(b.name, fields) : '') || (fields?.length ? '' : NEW_FIELD),
          newName: defaultNewName(b, i),
          status: 'ready',
        })),
      )
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setParsing(false)
    }
  }

  async function farmId(): Promise<string> {
    if (!farmIdRef.current) farmIdRef.current = fields?.[0]?.farm_id ?? (await ensureFarmId())
    return farmIdRef.current
  }

  /** Make the field a "Create a new field" row asks for; returns its id. */
  async function createField(row: RowState): Promise<string> {
    const name = row.newName.trim() || defaultNewName(row, row.key)
    const { data, error } = await supabase
      .from('fields')
      .insert({ farm_id: await farmId(), name, legal_land_description: null })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function importRow(row: RowState) {
    if (!row.fieldId) return
    setRows((rs) =>
      rs.map((r) => (r.key === row.key ? { ...r, status: 'importing', message: undefined } : r)),
    )
    let fieldId = row.fieldId
    let message: string | null = null
    try {
      if (fieldId === NEW_FIELD) {
        fieldId = await createField(row)
        // Point the row at the field it made, so a retry after a failed
        // boundary write reuses it rather than creating a duplicate.
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, fieldId } : r)))
        void queryClient.invalidateQueries({ queryKey: ['fields'] })
      }
      const { error } = await supabase.rpc('replace_boundary', {
        p_field_id: fieldId,
        p_geojson: JSON.parse(JSON.stringify(row.geometry)),
        p_source: boundarySource(fileName),
      })
      if (error) message = error.message
    } catch (e) {
      message = (e as Error).message
    }
    setRows((rs) =>
      rs.map((r) =>
        r.key === row.key
          ? message
            ? { ...r, status: 'error', message }
            : { ...r, status: 'done' }
          : r,
      ),
    )
    if (!message) void queryClient.invalidateQueries({ queryKey: ['boundaries'] })
  }

  async function importAll() {
    for (const row of rows) {
      if (row.status === 'ready' && row.fieldId) await importRow(row)
    }
  }

  /**
   * Every shape not going into an existing field becomes a new field, now.
   * Skipped rows are included — "unmatched" means no existing field, whatever
   * the picker was left on.
   */
  async function createAllUnmatched() {
    const targets = rows.filter(
      (r) => (r.status === 'ready' || r.status === 'error') && (r.fieldId === '' || r.fieldId === NEW_FIELD),
    )
    setRows((rs) => rs.map((r) => (targets.some((t) => t.key === r.key) ? { ...r, fieldId: NEW_FIELD } : r)))
    for (const row of targets) await importRow({ ...row, fieldId: NEW_FIELD })
  }

  // Preview map — created when its container mounts (see mapContainer above).
  useEffect(() => {
    if (!mapContainer || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainer,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 9,
      attributionControl: { compact: true },
    })
    map.on('load', () => setMapReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [mapContainer])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const fc = {
      type: 'FeatureCollection' as const,
      features: rows.map((r) => ({
        type: 'Feature' as const,
        geometry: r.geometry,
        properties: { name: r.name ?? '' },
      })),
    }
    const src = map.getSource('preview') as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(fc)
    } else {
      map.addSource('preview', { type: 'geojson', data: fc })
      map.addLayer({
        id: 'preview-fill',
        type: 'fill',
        source: 'preview',
        paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.3 },
      })
      map.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview',
        paint: { 'line-color': '#38bdf8', 'line-width': 2 },
      })
    }
    const bounds = new maplibregl.LngLatBounds()
    rows.forEach((r) => {
      const b = boundsOf(r.geometry)
      if (b) {
        bounds.extend(b[0])
        bounds.extend(b[1])
      }
    })
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, animate: false })
  }, [rows, mapReady])

  if (!isManager) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Only managers can import boundaries.
      </div>
    )
  }

  const readyCount = rows.filter((r) => r.status === 'ready' && r.fieldId).length
  const unmatchedCount = rows.filter(
    (r) => (r.status === 'ready' || r.status === 'error') && (r.fieldId === '' || r.fieldId === NEW_FIELD),
  ).length
  const busy = rows.some((r) => r.status === 'importing')

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <Link to="/fields" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Fields
      </Link>
      <h1 className="mt-2 text-xl font-bold text-gray-900">Import boundaries</h1>
      <HelpNote className="mt-1 text-sm" summary="GeoJSON, KML or shapefile, in lat/long." title="Boundary files">
        GeoJSON, KML, zipped shapefile, or .shp — WGS84 lat/long only. Existing boundaries are
        versioned, not overwritten: the old one keeps its history.
      </HelpNote>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={parsing}
          className="flex items-center gap-2 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          <FileUp className="h-4 w-4" />
          {parsing ? 'Parsing…' : 'Choose file'}
        </button>
        {fileName && <span className="text-sm text-gray-600">{fileName}</span>}
        <input
          ref={inputRef}
          type="file"
          accept=".geojson,.json,.kml,.zip,.shp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {errors.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Problems found:</p>
          <ul className="mt-1 list-inside list-disc">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div ref={setMapContainer} className="mt-4 h-64 w-full overflow-hidden rounded-lg border border-gray-200" />

          {unmatchedCount > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => void createAllUnmatched()}
                disabled={busy}
                className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              >
                Create all unmatched ({unmatchedCount})
              </button>
              <span className="text-xs text-gray-500">
                Makes a new field for each shape not going into an existing one, named as below.
              </span>
            </div>
          )}

          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-medium">Feature</th>
                  <th className="px-3 py-2 text-right font-medium">Est. acres</th>
                  <th className="px-3 py-2 font-medium">Import into field</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">{row.name ?? '(unnamed)'}</span>
                      {row.warnings.length > 0 && (
                        <p className="text-xs text-amber-600">{row.warnings.join('; ')}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.acres.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={row.fieldId}
                        disabled={row.status === 'done' || row.status === 'importing'}
                        size="sm"
                        ariaLabel="Field"
                        className="max-w-60"
                        onChange={(v) =>
                          setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, fieldId: v } : r)))
                        }
                        options={[
                          { value: '', label: '— skip —' },
                          { value: NEW_FIELD, label: 'Create a new field' },
                          ...(fields ?? []).map((f) => ({ value: f.id, label: f.name })),
                        ]}
                      />
                      {row.fieldId === NEW_FIELD && row.status !== 'done' && (
                        <input
                          value={row.newName}
                          disabled={row.status === 'importing'}
                          aria-label="New field name"
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((r) => (r.key === row.key ? { ...r, newName: e.target.value } : r)),
                            )
                          }
                          className="mt-1 block w-full max-w-60 rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === 'done' ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                          imported
                        </span>
                      ) : row.status === 'importing' ? (
                        <span className="text-xs text-gray-500">importing…</span>
                      ) : row.status === 'error' ? (
                        <span className="text-xs text-red-600">{row.message}</span>
                      ) : row.fieldId === NEW_FIELD ? (
                        <span className="text-xs text-gray-500">ready — new field</span>
                      ) : row.fieldId ? (
                        <span className="text-xs text-gray-500">ready</span>
                      ) : (
                        <span className="text-xs text-gray-400">no field selected</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => void importAll()}
            disabled={readyCount === 0 || busy}
            className="mt-4 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Import {readyCount} {readyCount === 1 ? 'boundary' : 'boundaries'}
          </button>
        </>
      )}
    </div>
  )
}
