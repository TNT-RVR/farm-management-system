/**
 * One entry point for every boundary upload format (SPEC §6): GeoJSON, KML,
 * zipped shapefile, or a bare .shp. Returns normalized MultiPolygons with
 * client-side acre estimates for the preview; PostGIS recomputes on commit.
 * Validation is loud: bad CRS, non-polygons, and out-of-range coordinates are
 * reported per feature, never silently dropped.
 */
import { kml as kmlToGeoJson } from '@tmcw/togeojson'
import type { Feature, Geometry, MultiPolygon } from 'geojson'
import { multiPolygonAcres } from './area'
import { assertWgs84Prj, parseShp, ringsToMultiPolygon } from './shp'
import { readZip } from './zip'

export type ParsedBoundary = {
  name: string | null
  geometry: MultiPolygon
  acres: number
  warnings: string[]
}

export type ParseResult = { boundaries: ParsedBoundary[]; errors: string[] }

function toMultiPolygon(geom: Geometry): MultiPolygon | null {
  if (geom.type === 'MultiPolygon') return geom
  if (geom.type === 'Polygon') return { type: 'MultiPolygon', coordinates: [geom.coordinates] }
  if (geom.type === 'GeometryCollection') {
    const polys = geom.geometries
      .map(toMultiPolygon)
      .filter((g): g is MultiPolygon => g !== null)
      .flatMap((g) => g.coordinates)
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
  }
  return null
}

function normalize(name: string | null, geom: MultiPolygon): ParsedBoundary {
  const warnings: string[] = []
  const coords = geom.coordinates
    .map((poly) =>
      poly
        .map((ring) => {
          const closed =
            ring.length >= 2 &&
            ring[0][0] === ring[ring.length - 1][0] &&
            ring[0][1] === ring[ring.length - 1][1]
          if (!closed) {
            warnings.push('unclosed ring auto-closed')
            return [...ring, ring[0]]
          }
          return ring
        })
        .filter((ring) => ring.length >= 4),
    )
    .filter((poly) => poly.length > 0)

  // Rebuild outer/hole structure + winding from the flat ring list — imports
  // (JD especially) routinely get both wrong.
  const rebuilt = ringsToMultiPolygon(coords.flat())
  const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: rebuilt }

  for (const poly of rebuilt)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (Math.abs(x) > 180 || Math.abs(y) > 90) {
          throw new Error(
            `coordinates out of lon/lat range (${x}, ${y}) — file appears to be projected, not WGS84`,
          )
        }
      }

  return { name, geometry, acres: multiPolygonAcres(geometry), warnings }
}

function featureName(f: Feature): string | null {
  const p = f.properties ?? {}
  const cand = p.name ?? p.Name ?? p.NAME ?? p.field ?? p.Field ?? p.title
  return typeof cand === 'string' && cand.trim() ? cand.trim() : null
}

function fromFeatures(features: Feature[], errors: string[]): ParsedBoundary[] {
  const out: ParsedBoundary[] = []
  for (const f of features) {
    if (!f.geometry) continue
    const mp = toMultiPolygon(f.geometry)
    if (!mp) {
      errors.push(
        `"${featureName(f) ?? 'unnamed feature'}": ${f.geometry.type} skipped — only polygons import as boundaries`,
      )
      continue
    }
    try {
      out.push(normalize(featureName(f), mp))
    } catch (e) {
      errors.push(`"${featureName(f) ?? 'unnamed feature'}": ${(e as Error).message}`)
    }
  }
  return out
}

function baseName(path: string): string {
  const n = path.split('/').pop() ?? path
  return n.replace(/\.[^.]+$/, '')
}

export async function parseBoundaryData(fileName: string, buf: ArrayBuffer): Promise<ParseResult> {
  const errors: string[] = []
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
    const parsed = JSON.parse(new TextDecoder().decode(buf)) as
      | Feature
      | Geometry
      | { type: 'FeatureCollection'; features: Feature[] }
    const features: Feature[] =
      parsed.type === 'FeatureCollection'
        ? parsed.features
        : parsed.type === 'Feature'
          ? [parsed]
          : [{ type: 'Feature', geometry: parsed as Geometry, properties: {} }]
    return { boundaries: fromFeatures(features, errors), errors }
  }

  if (lower.endsWith('.kml')) {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(buf), 'text/xml')
    if (doc.querySelector('parsererror')) {
      return { boundaries: [], errors: ['KML is not valid XML'] }
    }
    const fc = kmlToGeoJson(doc)
    return { boundaries: fromFeatures(fc.features as Feature[], errors), errors }
  }

  if (lower.endsWith('.zip')) {
    const entries = await readZip(buf)
    const prjByBase = new Map<string, string>()
    for (const e of entries) {
      if (e.name.toLowerCase().endsWith('.prj')) {
        prjByBase.set(baseName(e.name), new TextDecoder().decode(e.data))
      }
    }
    const boundaries: ParsedBoundary[] = []
    let sawShp = false
    for (const e of entries) {
      if (!e.name.toLowerCase().endsWith('.shp')) continue
      sawShp = true
      const base = baseName(e.name)
      try {
        const prj = prjByBase.get(base)
        if (prj) assertWgs84Prj(prj, base)
        const shpBuf = e.data.buffer.slice(
          e.data.byteOffset,
          e.data.byteOffset + e.data.byteLength,
        ) as ArrayBuffer
        boundaries.push(normalize(base, parseShp(shpBuf)))
      } catch (err) {
        errors.push(`${base}: ${(err as Error).message}`)
      }
    }
    if (!sawShp) errors.push('ZIP contains no .shp files')
    return { boundaries, errors }
  }

  if (lower.endsWith('.shp')) {
    try {
      return { boundaries: [normalize(baseName(fileName), parseShp(buf))], errors }
    } catch (e) {
      return { boundaries: [], errors: [(e as Error).message] }
    }
  }

  return {
    boundaries: [],
    errors: [`Unsupported file type: ${fileName} (use .geojson, .kml, .zip shapefile, or .shp)`],
  }
}

export async function parseBoundaryFile(file: File): Promise<ParseResult> {
  return parseBoundaryData(file.name, await file.arrayBuffer())
}
