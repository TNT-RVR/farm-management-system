/**
 * The type filter on Equipment service (Sam, 24 Oct 2026: "have a way to
 * filter to see the trucks"). Deere's equipment types are many and wordy
 * ("Two-wheel Drive Tractors - 140 Hp And Above"), so they are gathered into a
 * few kinds a person would ask for. Only kinds the fleet actually has are
 * offered. Pure, so it is tested without a database.
 */

export type EquipmentKind = {
  key: string
  label: string
  /** Does a Deere / hand-entered equipment_type belong to this kind? */
  match: (type: string) => boolean
}

/** In the order they are offered; the first match wins. */
export const EQUIPMENT_KINDS: EquipmentKind[] = [
  { key: 'trucks', label: 'Trucks', match: (t) => /\btrucks?\b/i.test(t) },
  // "Trailed Sprayers" is a sprayer, not a trailer.
  { key: 'trailers', label: 'Trailers', match: (t) => /^trailers?$/i.test(t.trim()) },
  { key: 'tractors', label: 'Tractors', match: (t) => /tractor/i.test(t) },
  { key: 'combines', label: 'Combines & headers', match: (t) => /combine|header|harvester/i.test(t) },
  { key: 'sprayers', label: 'Sprayers', match: (t) => /sprayer/i.test(t) },
  { key: 'hay', label: 'Hay & forage', match: (t) => /baler|rake|mower|windrower|hay|forage|chopper/i.test(t) },
  { key: 'seeding', label: 'Seeding & tillage', match: (t) => /seeder|planter|cultivator|disk|plow|ripper|harrow|spreader/i.test(t) },
]

/** The kind for a type, or 'other' (no type, or one no kind claims). */
export function equipmentKind(type: string | null | undefined): string {
  if (!type?.trim()) return 'other'
  return EQUIPMENT_KINDS.find((k) => k.match(type))?.key ?? 'other'
}

/** The filter's options: All, then each kind present, with how many; Other last. */
export function kindOptions(types: (string | null | undefined)[]): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of types) {
    const k = equipmentKind(t)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [
    { key: 'all', label: 'All', count: types.length },
    ...EQUIPMENT_KINDS.filter((k) => counts.has(k.key)).map((k) => ({ key: k.key, label: k.label, count: counts.get(k.key)! })),
    ...(counts.has('other') ? [{ key: 'other', label: 'Other', count: counts.get('other')! }] : []),
  ]
}

/**
 * The machines with a yearly inspection: the semis (type 'Truck'; pickups are
 * 'Pickup Truck') and the trailers they pull. The January reminder still asks
 * only about the semis (fn_truck_inspection_reminders).
 */
export const INSPECTED_TYPES = ['Truck', 'Trailers'] as const
export const isInspected = (type: string | null | undefined) => (INSPECTED_TYPES as readonly string[]).includes(type ?? '')
