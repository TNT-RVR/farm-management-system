import maplibregl from 'maplibre-gl'
import { quarterGridGeoJson, type GridParcel } from './atsGrid'

/**
 * The quarter-section grid, drawn on a map.
 *
 * Pulled out of MapPage so the cattle map can show the same grid without a
 * second copy of the paint rules. Two maps drawing "the same" survey grid from
 * two copies of this code is how one of them quietly ends up claiming a
 * precision it does not have -- the estimated-parcel styling below is exactly
 * the sort of thing that gets fixed in one copy and not the other.
 *
 * The labels are HTML markers rather than a symbol layer because this style
 * ships no glyph server, the same reason the field names are markers.
 */

export const QUARTER_GRID_SOURCE = 'quarter-grid'
export const QUARTER_GRID_LINE = 'quarter-grid-line'

/**
 * Draw (or update) the grid and its labels. Returns the markers it created,
 * which the caller holds so the next call can take them down again.
 */
export function drawQuarterGrid(
  map: maplibregl.Map,
  parcels: GridParcel[],
  previousMarkers: maplibregl.Marker[],
): maplibregl.Marker[] {
  // The shared builder rather than an inline copy, so the properties the paint
  // expressions read cannot drift away from what the module emits.
  const fc = quarterGridGeoJson(parcels)

  const src = map.getSource(QUARTER_GRID_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(fc)
  } else {
    map.addSource(QUARTER_GRID_SOURCE, { type: 'geojson', data: fc })
    map.addLayer({
      id: QUARTER_GRID_LINE,
      type: 'line',
      source: QUARTER_GRID_SOURCE,
      paint: {
        'line-color': '#ffffff',
        'line-width': 1,
        // An estimated parcel is drawn fainter than a surveyed one, so the
        // grid never claims a precision it does not have outside Alberta.
        // MapLibre cannot vary line-dasharray per feature, so opacity does the
        // work and the label carries the word.
        'line-opacity': ['case', ['get', 'estimated'], 0.35, 0.75],
        'line-dasharray': [2, 2],
      },
    })
  }

  previousMarkers.forEach((m) => m.remove())
  return parcels.map((p) => {
    const el = document.createElement('div')
    el.className =
      'pointer-events-none select-none whitespace-nowrap text-[10px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.95)]' +
      (p.estimated ? ' italic opacity-70' : '')
    // Always the full description. "NW" on its own named the corner without
    // naming the parcel -- every section has one, so it answered nothing. A
    // leading "≈" marks a parcel placed by estimate rather than survey.
    el.textContent = p.estimated ? `≈ ${p.label}` : p.label
    return new maplibregl.Marker({ element: el })
      .setLngLat([p.box.center.lng, p.box.center.lat])
      .addTo(map)
  })
}

/**
 * Take the grid off the map entirely.
 *
 * Drawing an empty collection would leave the source and layer in place, which
 * is fine while the grid is merely out of zoom but wrong when it is switched
 * off: a later style reload would bring an empty grid layer back with it.
 */
export function removeQuarterGrid(map: maplibregl.Map, markers: maplibregl.Marker[]): void {
  markers.forEach((m) => m.remove())
  if (map.getLayer(QUARTER_GRID_LINE)) map.removeLayer(QUARTER_GRID_LINE)
  if (map.getSource(QUARTER_GRID_SOURCE)) map.removeSource(QUARTER_GRID_SOURCE)
}
