import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Mineral and salt tubs, as pins a person owns.
 *
 * The same machinery as the water pins — drop, drag, rename, delete — but a
 * separate table and a separate layer, because the two are placed for opposite
 * reasons. Water has to be somewhere the cattle can reach; mineral is put
 * where you would LIKE them to go, to pull a herd off a creek bottom and out
 * to a corner it has been ignoring. Putting a tub in cattle_water would also
 * have quietly enlarged the grazed ground around it, since the reach is built
 * from the drinkable pins.
 */
export type MineralKind = 'mineral' | 'salt' | 'protein' | 'other'

export const MINERAL_KINDS: { value: MineralKind; label: string }[] = [
  { value: 'mineral', label: 'Mineral' },
  { value: 'salt', label: 'Salt' },
  { value: 'protein', label: 'Protein tub' },
  { value: 'other', label: 'Other' },
]

export type MineralTub = {
  id: string
  name: string | null
  kind: MineralKind
  /** When it went out, so the map can say how long it has been sitting there. */
  placed_on: string | null
  notes: string | null
  lon: number
  lat: number
  pasture_id: string | null
  pasture_name: string | null
}

const KEY = ['cattle_mineral']

const ewkt = (lon: number, lat: number) => `SRID=4326;POINT(${lon} ${lat})`

/** Every tub on the farm, with the paddock it sits in. */
export function useCattleMineral() {
  return useQuery({
    queryKey: KEY,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MineralTub[]> => {
      const { data, error } = await supabase.from('cattle_mineral_points').select('*').order('placed_on', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as unknown as MineralTub),
        lon: Number((r as { lon: number | string }).lon),
        lat: Number((r as { lat: number | string }).lat),
      }))
    },
  })
}

/** How many days a tub has been out, or null when nobody said when it went. */
export function daysOut(t: Pick<MineralTub, 'placed_on'>, today = new Date()): number | null {
  if (!t.placed_on) return null
  const d = Math.floor((today.getTime() - Date.parse(`${t.placed_on}T12:00:00Z`)) / 86_400_000)
  return Number.isFinite(d) ? Math.max(0, d) : null
}

export function useMineralMutations() {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY })
  const add = useMutation({
    mutationFn: async (v: { lon: number; lat: number; name?: string | null; kind?: MineralKind; placed_on?: string | null }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('cattle_mineral')
        .insert({
          name: v.name ?? null,
          kind: v.kind ?? 'mineral',
          geom: ewkt(v.lon, v.lat),
          // A tub dropped on the map went out today unless told otherwise:
          // that is what dropping it means, and a blank date helps nobody.
          placed_on: v.placed_on ?? new Date().toLocaleDateString('en-CA'),
          created_by: user?.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: async (v: {
      id: string
      name?: string | null
      kind?: MineralKind
      placed_on?: string | null
      notes?: string | null
      lon?: number
      lat?: number
    }) => {
      const patch: {
        name?: string | null
        kind?: MineralKind
        placed_on?: string | null
        notes?: string | null
        geom?: string
        updated_at: string
      } = { updated_at: new Date().toISOString() }
      if ('name' in v) patch.name = v.name
      if (v.kind) patch.kind = v.kind
      if ('placed_on' in v) patch.placed_on = v.placed_on
      if ('notes' in v) patch.notes = v.notes
      if (v.lon != null && v.lat != null) patch.geom = ewkt(v.lon, v.lat)
      const { error } = await supabase.from('cattle_mineral').update(patch).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cattle_mineral').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { add, update, remove }
}
