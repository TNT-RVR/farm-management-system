import type maplibregl from 'maplibre-gl'

/**
 * Pin icons for the points in the farm's Google My Maps — chosen by Sam
 * from three candidates each (26 Sep 2026). Small and simple: a coloured
 * solid, outlined or square badge with one white (or coloured) glyph.
 *
 * Each point is sorted into a type by its My Maps layer and the words in its
 * name and description; a point that fits no type keeps the plain dot.
 */

export type PinKey =
  | 'gate'
  | 'oil_well'
  | 'oil_well_active'
  | 'oil_well_reccertified'
  | 'abandoned_oil_well'
  | 'oil_battery'
  | 'gas_meter'
  | 'gas_shutoff'
  | 'power_meter'
  | 'power_shutoff'
  | 'transformer'
  | 'wind_turbine'
  | 'solar'
  | 'water_well'
  | 'abandoned_water_well'
  | 'dugout'
  | 'pivot'
  | 'pump'
  | 'hydrant'
  | 'trough'
  | 'water_meter'
  | 'stone_circle'
  | 'cairn'

const solid = (c: string, glyph: string) => `<circle cx="12" cy="12" r="11" fill="${c}"/>${glyph}`
const outline = (c: string, glyph: string) => `<circle cx="12" cy="12" r="10.2" fill="#fff" stroke="${c}" stroke-width="1.6"/>${glyph}`
const square = (c: string, glyph: string) => `<rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="${c}"/>${glyph}`
const strokes = (colour: string, d: string, w = 1.8) =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
const letter = (ch: string) => `<text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="600" fill="#fff" font-family="Arial, sans-serif">${ch}</text>`
const DROP = 'M12 5.5c3 3.8 4.3 6.2 4.3 8.4a4.3 4.3 0 0 1-8.6 0c0-2.2 1.3-4.6 4.3-8.4z'
const FLAME = 'M12 4.5c3.4 3.9 4.5 6.3 4.5 9a4.5 4.5 0 0 1-9 0c0-1.8.8-3 2-4.2.2 1.8 1 2.8 2 2.8-.3-2.8-.5-4.8.5-7.6z'
const BOLT = 'M13.2 4L7 13.2h4.6L10.6 20l6.2-9.3h-4.6z'
const slash = (bg: string) =>
  `<path d="M5.5 18.5L18.5 5.5" stroke="${bg}" stroke-width="3.2"/><path d="M5.5 18.5L18.5 5.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`

export const PINS: Record<PinKey, { label: string; svg: string }> = {
  gate: { label: 'Gate', svg: solid('#78716c', strokes('#fff', 'M6 8h12v8H6z M6 16L18 8')) },
  oil_well: { label: 'Oil well', svg: outline('#1f2937', `<path d="${DROP}" fill="#1f2937"/>`) },
  // Reclamation-certified: the outline well, white circle and black drop.
  oil_well_reccertified: { label: 'Oil well — RecCertified', svg: outline('#1f2937', `<path d="${DROP}" fill="#1f2937"/>`) },
  // Producing: the inverse, a black circle with a white drop, so the live
  // ones stand out from the reclaimed ones at a glance.
  oil_well_active: { label: 'Oil well — Active', svg: solid('#111827', `<path d="${DROP}" fill="#fff"/>`) },
  abandoned_oil_well: { label: 'Abandoned oil well', svg: solid('#9ca3af', `<path d="${DROP}" fill="#fff"/>${slash('#9ca3af')}`) },
  oil_battery: {
    label: 'Oil battery',
    svg: square('#44403c', strokes('#fff', 'M7 7c0-1.2 2.2-2 5-2s5 .8 5 2v10c0 1.2-2.2 2-5 2s-5-.8-5-2z M7 7c0 1.2 2.2 2 5 2s5-.8 5-2')),
  },
  gas_meter: { label: 'Gas meter', svg: solid('#ea580c', `<path d="${FLAME}" fill="#fff"/>`) },
  gas_shutoff: { label: 'Gas shut-off', svg: solid('#ea580c', strokes('#fff', 'M5.5 10l13 6v-6l-13 6z M12 13V7 M9 7h6')) },
  power_meter: { label: 'Power meter', svg: square('#d97706', strokes('#fff', BOLT, 1.6)) },
  power_shutoff: { label: 'Power shut-off', svg: square('#d97706', `<path d="${BOLT}" fill="#fff"/>${slash('#d97706').replace(/5\.5 18\.5L18\.5 5\.5/g, '5 19L19 5')}`) },
  transformer: { label: 'Transformer', svg: square('#d97706', letter('T')) },
  wind_turbine: { label: 'Wind turbine', svg: solid('#0d9488', strokes('#fff', 'M12 11v8.5 M12 11V4.5 M12 11l5.6 3.2 M12 11l-5.6 3.2')) },
  solar: {
    label: 'Solar',
    svg: solid(
      '#ca8a04',
      `<circle cx="12" cy="12" r="3.2" fill="#fff"/>` +
        strokes('#fff', 'M12 4.5v2 M12 17.5v2 M4.5 12h2 M17.5 12h2 M6.7 6.7l1.4 1.4 M15.9 15.9l1.4 1.4 M6.7 17.3l1.4-1.4 M15.9 8.1l1.4-1.4'),
    ),
  },
  water_well: { label: 'Water well', svg: outline('#2563eb', strokes('#2563eb', 'M6 10l6-4.5 6 4.5 M8 10v8h8v-8 M8 13.5h8')) },
  abandoned_water_well: { label: 'Abandoned water well', svg: outline('#64748b', strokes('#64748b', 'M8 8l8 8 M16 8l-8 8', 2)) },
  dugout: {
    label: 'Dugout',
    svg: solid('#0284c7', strokes('#fff', 'M5 10c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0 M5 14.5c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0')),
  },
  pivot: {
    label: 'Pivot',
    svg: solid(
      '#16a34a',
      `<circle cx="12" cy="12" r="6.2" fill="none" stroke="#fff" stroke-width="1.6"/>` + strokes('#fff', 'M12 12l5.4-3') + `<circle cx="12" cy="12" r="1.5" fill="#fff"/>`,
    ),
  },
  pump: { label: 'Pump / pump house', svg: solid('#1d4ed8', strokes('#fff', 'M5.5 11.5L12 6l6.5 5.5 M7.5 10.5v8h9v-8 M10.5 18.5v-4h3v4')) },
  hydrant: {
    label: 'Hydrant',
    svg: solid('#dc2626', strokes('#fff', 'M8.5 19h7 M10 19v-8h4v8 M9 11h6 M10 11a2 2 0 0 1 4 0 M7.8 14.5h2.2 M14 14.5h2.2')),
  },
  trough: {
    label: 'Trough',
    svg: outline('#0891b2', strokes('#0891b2', 'M5 9h14l-2 7H7z') + `<path d="M6.3 12h11.4l-1 4H7.3z" fill="#0891b2"/>`),
  },
  water_meter: {
    label: 'Water meter',
    svg: outline(
      '#2563eb',
      `<circle cx="12" cy="12" r="6" fill="none" stroke="#2563eb" stroke-width="1.6"/><path d="M12 8.3c1.7 2.1 2.4 3.4 2.4 4.6a2.4 2.4 0 0 1-4.8 0c0-1.2.7-2.5 2.4-4.6z" fill="#2563eb"/>`,
    ),
  },
  stone_circle: {
    label: 'Stone circle',
    svg: outline('#7c3aed', `<circle cx="12" cy="12" r="5.8" fill="none" stroke="#7c3aed" stroke-width="2.2" stroke-dasharray="2.2 2"/>`),
  },
  cairn: {
    label: 'Cairn',
    svg: solid(
      '#7c3aed',
      `<g fill="#fff"><ellipse cx="12" cy="16.6" rx="5.2" ry="2.1"/><ellipse cx="12" cy="12.6" rx="3.7" ry="1.8"/><ellipse cx="12" cy="9" rx="2.4" ry="1.5"/></g>`,
    ),
  },
}

/** Style bookkeeping from the KML, not words anyone wrote about the point. */
const NOT_WORDS = new Set(['styleUrl', 'icon', 'icon-color', 'icon-opacity', 'icon-scale', 'label-scale', 'stroke', 'fill', '_layer', '_pin', '_colour', '_lease'])

/**
 * Every word a point carries — name, description and the My Maps data
 * columns (a historical site's name is blank; what it is lives in "Type").
 * KML markup and CDATA stripped.
 */
function words(props: Record<string, unknown>): string {
  return Object.entries(props)
    .filter(([k, v]) => !NOT_WORDS.has(k) && (typeof v === 'string' || typeof v === 'number'))
    .map(([, v]) => String(v))
    .join(' ')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
}

/**
 * Which pin a My Maps point gets. The layer says what family it is; the
 * words say which kind within it. Order matters inside a family: a water
 * point's description mentions its meter whatever it is, so the specific
 * kinds are tested first and "meter" last.
 */
export function classifyPin(layer: unknown, props: Record<string, unknown>): PinKey | null {
  const l = String(layer ?? '').toLowerCase()
  const t = words(props)
  if (/gate/.test(l)) return 'gate'
  if (/^oil|\boil\b/.test(l)) {
    // The well's status column first: RecCertified and Active are the two
    // Sam wants told apart. "inactive" does not match \bactive\b.
    if (/rec\s*-?\s*certified|reccert/.test(t)) return 'oil_well_reccertified'
    if (/\bactive\b/.test(t)) return 'oil_well_active'
    if (/abandon/.test(t)) return 'abandoned_oil_well'
    if (/battery/.test(t)) return 'oil_battery'
    return 'oil_well'
  }
  if (/gas/.test(l)) return /shut|valve/.test(t) ? 'gas_shutoff' : 'gas_meter'
  if (/electric|power/.test(l)) {
    if (/turbine/.test(t)) return 'wind_turbine'
    if (/solar/.test(t)) return 'solar'
    if (/transformer/.test(t)) return 'transformer'
    if (/shut|disconnect/.test(t)) return 'power_shutoff'
    return 'power_meter'
  }
  if (/water/.test(l)) {
    if (/abandon/.test(t)) return 'abandoned_water_well'
    if (/hydrant/.test(t)) return 'hydrant'
    if (/trough/.test(t)) return 'trough'
    if (/pivot/.test(t)) return 'pivot'
    if (/dugout/.test(t)) return 'dugout'
    // On a water point "turbine" is a turbine pump, not a wind turbine.
    if (/pump|turbine/.test(t)) return 'pump'
    if (/solar/.test(t)) return 'solar'
    if (/well/.test(t)) return 'water_well'
    return 'water_meter'
  }
  if (/historic/.test(l)) {
    if (/cairn/.test(t)) return 'cairn'
    // A stone arc is a partial circle; it shares the icon.
    if (/circle|ring|\barc\b/.test(t)) return 'stone_circle'
    return null
  }
  return null
}

/** MapLibre image id for a pin. */
export const pinImageId = (k: PinKey) => `pin-${k}`

/** 22 px on screen, drawn at twice that for sharp edges. */
const PX = 44

/**
 * Put every pin image on the map. SVG is rasterised through a canvas because
 * MapLibre takes pixels, not vectors. Safe to call again: images already on
 * the map are skipped, and a style reload (which drops them) re-adds them.
 */
export async function addPinImages(map: maplibregl.Map): Promise<void> {
  await Promise.all(
    (Object.keys(PINS) as PinKey[]).map(async (k) => {
      const id = pinImageId(k)
      if (map.hasImage(id)) return
      const img = new Image(PX, PX)
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="0 0 24 24">${PINS[k].svg}</svg>`,
      )}`
      try {
        await img.decode()
      } catch {
        return
      }
      const c = document.createElement('canvas')
      c.width = PX
      c.height = PX
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, PX, PX)
      if (!map.hasImage(id)) map.addImage(id, ctx.getImageData(0, 0, PX, PX), { pixelRatio: 2 })
    }),
  )
}

/**
 * The collection with each point's pin type worked out, at draw time.
 *
 * Not at download time: the app keeps its last My Maps download for offline
 * use, and a copy parsed before a rule existed (or before pins existed at all)
 * would otherwise draw without icons until the next refresh — which is what
 * happened the day pins shipped. Worked out here, any copy of any age gets
 * today's icons.
 */
export function withPins<T extends { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: { type: string } | null; properties: Record<string, unknown> | null }[] }>(fc: T): T {
  return {
    ...fc,
    features: fc.features.map((f) => {
      if (f.geometry?.type !== 'Point') return f
      const props = { ...(f.properties ?? {}) }
      const pin = classifyPin(props._layer, props)
      if (pin) props._pin = pin
      else delete props._pin
      return { ...f, properties: props }
    }),
  }
}

/** The icon-image expression: the point's pin, or nothing. */
export const PIN_ICON_EXPR = ['concat', 'pin-', ['get', '_pin']] as const
