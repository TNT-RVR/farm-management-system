/**
 * Pins on the farm's map that mark pumps (map_features.pump_ids, migration
 * 20261013160000). Pure, so the matching is tested; the hooks are in
 * farm-layers.ts.
 */

export type PumpPin = { id: string; layer_id: string; label: string | null; pump_ids: string[] }

/**
 * The notes a feature carries, as plain text. Google's export keeps a My Map
 * description as `{"@type":"html","value":"…"}`, not a string, so reading it
 * with String() gave "[object Object]". The My Map template's empty lines
 * ("GPM Max: ") are dropped: they say nothing.
 */
export function featureNotes(properties: Record<string, unknown> | null | undefined): string {
  const raw = properties?.['description']
  const html =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && typeof (raw as { value?: unknown }).value === 'string'
        ? (raw as { value: string }).value
        : ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^[^:]{1,40}:\s*$/.test(l))
    .join('\n')
}

/** Pump ids on each pin, by feature id. */
export const pumpsByFeature = (pins: PumpPin[] | undefined) => new Map((pins ?? []).map((p) => [p.id, p.pump_ids]))

/** The pin(s) that mark each pump, by pump id. */
export function pinsByPump(pins: PumpPin[] | undefined): Map<string, PumpPin[]> {
  const m = new Map<string, PumpPin[]>()
  for (const p of pins ?? []) for (const id of p.pump_ids) m.set(id, [...(m.get(id) ?? []), p])
  return m
}

/** The main map, opened on this pin (its layer switched on). */
export const mapLinkForPin = (pin: Pick<PumpPin, 'id' | 'layer_id'>) => `/map?pin=${pin.id}&pinLayer=${pin.layer_id}`

/** The pump's own section on Irrigation → Pump information. */
export const pumpInfoLink = (pumpId: string) => `/irrigation-info?tab=pump&pump=${pumpId}`

/**
 * The pumps a checklist place stands for: those on the map pin it follows,
 * or the one it was made from out of the pump list (source 'pump:<id>').
 */
export function placePumpIds(
  place: { feature_id?: string | null; source?: string | null } | undefined,
  byFeature: Map<string, string[]>,
): string[] {
  if (!place) return []
  const fromPin = place.feature_id ? (byFeature.get(place.feature_id) ?? []) : []
  const fromList = place.source?.startsWith('pump:') ? [place.source.slice(5)] : []
  return [...new Set([...fromPin, ...fromList])]
}
