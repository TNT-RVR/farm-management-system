import { FN_STATUS_COLOR } from '@/lib/fieldnet'

/**
 * What each map layer is and how to read it, shown when you hover the layer's
 * name on the Map and on Compare (Sam, 29 Oct 2026). One list, so the two
 * pages describe a layer the same way.
 */
export const LAYER_INFO = {
  photo: {
    title: 'Satellite photo',
    text: 'The latest clear picture from the Sentinel-2 satellite, in true colour. 10 m pixels: the field’s colour, not fine detail.',
  },
  ndvi: {
    title: 'NDVI',
    text: 'How green and thick the crop is, from the satellite. Dark green is dense, healthy growth; brown and orange are thin crop, bare ground or stress.',
  },
  ndre: {
    title: 'NDRE',
    text: 'Like NDVI, but read from the red-edge light, so it still tells parts apart in a tall, thick crop where NDVI tops out. A guide to nitrogen.',
  },
  aimm: {
    title: 'Irrigation (AIMM)',
    text: 'Alberta’s irrigation model: the soil water left, from weather and crop stage. Green is fine, amber irrigate soon, red irrigate now.',
  },
  fieldnet: {
    title: 'Pivots (FieldNET)',
    text: 'The pivot as FieldNET reports it: running, off, in fault or disconnected, with the arm drawn where it stands.',
  },
  yield: {
    title: 'Productivity zones',
    text: 'The agronomist’s zones: each part of a field as a % of that field’s own average yield, so 110 is good ground for that field.',
  },
  soil: {
    title: 'Soil survey',
    text: 'The provincial soil survey (AGRASID), coloured by the water a crop can reach in the top metre. Tap an area for its soils.',
  },
  salinity: {
    title: 'Salinity (soil tests)',
    text: 'Salt in our own soil tests (EC, dS/m), worst sample per field. Green has no effect; orange and red only tolerant crops will grow.',
  },
  topography: {
    title: 'Topography',
    text: 'Height across the field against its low ground nearby: blue sits lower and holds water, red sits higher and dries first.',
  },
  profit: {
    title: 'Profit / Loss',
    text: 'The field’s net per acre at target prices, coloured on the farm’s own range: red loses money, pale breaks even, green makes it.',
  },
  mymap: {
    title: 'Google My Map',
    text: 'The farm’s own Google My Maps layers, such as oil and gas lines and leases, drawn over the fields.',
  },
  boundaries: {
    title: 'Field boundaries',
    text: 'Each field’s outline for the crop year picked at the top.',
  },
  labels: {
    title: 'Field labels',
    text: 'Each field’s name, on the field.',
  },
} as const

export type LayerInfoKey = keyof typeof LAYER_INFO

/** Irrigation status by AIMM's key: what it says and its colour on every map. */
export const IRRIGATION_STATUS: Record<string, [string, string]> = {
  ok: ['OK', '#22c55e'],
  soon: ['Irrigate soon', '#f59e0b'],
  now: ['Irrigate now', '#ef4444'],
  stress: ['Water stress', '#b91c1c'],
}
export const NOT_SCHEDULED_COLOUR = '#94a3b8'

export const IRRIGATION_LEGEND = [...Object.values(IRRIGATION_STATUS), ['Not scheduled', NOT_SCHEDULED_COLOUR]] as const

export const FIELDNET_LEGEND = [
  ['Fault / alert', FN_STATUS_COLOR.fault],
  ['Pivot on', FN_STATUS_COLOR.on],
  ['Pivot off', FN_STATUS_COLOR.off],
  ['Disconnected', FN_STATUS_COLOR.disconnected],
] as const
