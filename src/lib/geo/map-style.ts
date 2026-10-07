import type { StyleSpecification } from 'maplibre-gl'

/** Esri World Imagery satellite basemap — free, no token (SPEC §3). */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  // Without this, every symbol layer in the app silently draws nothing:
  // MapLibre answers "use of text-field requires a style glyphs property" on
  // the map's error channel, which nobody was listening to. The bin labels,
  // the soil sample codes and the My Maps pin names have all been invisible.
  //
  // Served from our own origin rather than a font CDN. MapLibre's demo server
  // works but is a demo server, and openmaptiles' glyphs fail to decode in
  // this version ("Unimplemented type: 4"). Two Latin ranges of Noto Sans is
  // 200 KB, covers every label this farm writes, and keeps working when the
  // app is offline in a field — which is the point of the offline cache.
  glyphs: '/fonts/{fontstack}/{range}.pbf',
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      // 20, not 19. Every field on this farm is covered by county orthophoto
      // flown in 2024 at 0.25 m — Taber County over fifteen of them, Forty Mile
      // and Cypress over the rest — and Taber's is served to zoom 20. Capping
      // at 19 asked for a tile of half the detail that exists and let the
      // browser stretch it, which is most of why the imagery looked soft.
      //
      // Where a county stops at 18 or 19 the service upsamples its own tile
      // rather than returning a blank one, so this is never worse than 19 —
      // checked against all three counties over real fields.
      maxzoom: 20,
    },
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
}
