import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MultiPolygon } from 'geojson'
import { supabase } from './supabase'
import type { Json } from './database.types'

/**
 * The ones worth having on a dropdown.
 *
 * Not the whole Alberta noxious list — that runs to seventy-odd species and a
 * list that long is a list nobody scrolls. These are the ones actually costing
 * this farm ground: the three the boss named, plus the three that do the most
 * damage on irrigated and dryland prairie around East Ranch and Taber.
 *
 * `status` is the Alberta Weed Control Act classification. Prohibited noxious
 * must be destroyed outright; noxious must be controlled. Two entries are
 * neither, and both earn their place anyway: crested wheatgrass was seeded
 * deliberately for decades and is now an invader of native range, and silver
 * sagebrush is native — it is not a weed at all in law, it simply takes grazing
 * out of production when it thickens, which is the thing worth mapping.
 */
export type Weed = {
  slug: string
  name: string
  latin: string
  status: 'Prohibited noxious' | 'Noxious' | 'Invasive' | 'Native increaser'
  /** Map colour. Chosen to stay apart on satellite imagery. */
  color: string
  /** What it looks like in the field, in one line you can check while standing there. */
  id: string
  /** Why it matters here. */
  why: string
  photo: string
  credit: string
  license: string
}

export const WEEDS: Weed[] = [
  {
    slug: 'canada-thistle',
    name: 'Canada thistle',
    latin: 'Cirsium arvense',
    status: 'Noxious',
    color: '#a855f7',
    id: 'Purple pom-pom flowers, spiny leaves, always in a dense patch — it spreads by root, so it comes up as a colony, never as one plant.',
    why: 'Creeping roots mean tillage cuts it into more plants. Patches expand a metre or two a year if left.',
    photo: '/weeds/canada-thistle.jpg',
    credit: 'Richard Bartz',
    license: 'CC BY-SA 2.5',
  },
  {
    slug: 'leafy-spurge',
    name: 'Leafy spurge',
    latin: 'Euphorbia esula',
    status: 'Noxious',
    color: '#eab308',
    id: 'Yellow-green flower bracts on top, narrow leaves, and milky white sap when you snap a stem — the sap is the giveaway.',
    why: 'Roots go down 5 m, so it survives almost anything. Cattle will not graze it, so it takes pasture out of production outright.',
    photo: '/weeds/leafy-spurge.jpg',
    credit: 'Ivar Leidus',
    license: 'CC BY-SA 3.0',
  },
  {
    slug: 'crested-wheatgrass',
    name: 'Crested wheatgrass',
    latin: 'Agropyron cristatum',
    status: 'Invasive',
    color: '#f97316',
    id: 'Flat, comb-like seed head — the spikelets sit in two neat rows like a herringbone. Greens up early and goes dormant by midsummer.',
    why: 'Seeded on purpose for years, now crowding out native range. Not illegal, but where it takes over, the native grass does not come back on its own.',
    photo: '/weeds/crested-wheatgrass.jpg',
    credit: 'Patrick Alexander',
    license: 'CC0',
  },
  {
    slug: 'kochia',
    name: 'Kochia',
    latin: 'Bassia scoparia',
    status: 'Noxious',
    color: '#dc2626',
    id: 'Bushy pyramid shape, soft hairy leaves, stems turning red as it matures. Breaks off at the base and tumbles.',
    why: 'Glyphosate- and Group 2-resistant populations are widespread in southern Alberta. One tumbling plant seeds a whole field edge.',
    photo: '/weeds/kochia.jpg',
    credit: 'Rameshng',
    license: 'CC BY-SA 3.0',
  },
  {
    slug: 'downy-brome',
    name: 'Downy brome (cheatgrass)',
    latin: 'Bromus tectorum',
    status: 'Prohibited noxious',
    color: '#0891b2',
    id: 'Soft, drooping, feathery seed head that nods to one side. Whole plant goes purple then straw-brown by early summer, well before anything else.',
    why: 'Prohibited noxious — it must be destroyed, not just controlled. Cures early and turns range into a fire load.',
    photo: '/weeds/downy-brome.jpg',
    credit: 'AnRo0002',
    license: 'CC0',
  },
  {
    slug: 'scentless-chamomile',
    name: 'Scentless chamomile',
    latin: 'Tripleurospermum inodorum',
    status: 'Noxious',
    color: '#ec4899',
    id: 'White daisy flower with a yellow centre and fine, feathery leaves — and crush it: unlike real chamomile it has no smell.',
    why: 'One plant sets up to a million seeds, and they last fifteen years in the soil. Loves the wet spots and headlands.',
    photo: '/weeds/scentless-chamomile.jpg',
    credit: 'Georg Slickers',
    license: 'CC BY-SA 4.0',
  },
  {
    slug: 'silver-sagebrush',
    name: 'Silver sagebrush',
    latin: 'Artemisia cana',
    status: 'Native increaser',
    color: '#64748b',
    id: 'Waist-high woody shrub with silver-grey, three-toothed leaves and a strong sage smell when you crush one. Woody stems tell it from pasture sage, which is low, soft and feathery.',
    why: 'Native, so not a weed in law — but a thick stand shades out grass and takes grazing out of production, and it thickens on heavier grazing and after wet years. Worth mapping to see whether a stand is spreading rather than arguing about it from memory.',
    photo: '/weeds/silver-sagebrush.jpg',
    credit: '',
    license: '',
  },
]

export const weedBySlug = (slug: string | null | undefined) =>
  WEEDS.find((w) => w.slug === slug) ?? null

export type WeedPatch = {
  id: string
  weed: string
  geojson: MultiPolygon
  acres: number | null
  field_id: string | null
  severity: 'light' | 'moderate' | 'heavy' | null
  notes: string | null
  observed_on: string
  treated_on: string | null
  /** 'sprayed' | 'mowed' | 'other'. Null on patches recorded before this. */
  treatment: string | null
  /** What was sprayed, as named at the time. */
  chemical: string | null
  chemical_id: string | null
  created_at: string
}

export function useWeedPatches() {
  return useQuery({
    queryKey: ['weed-patches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weed_patches')
        .select('*')
        .order('observed_on', { ascending: false })
      if (error) throw error
      // The column is jsonb; the app knows it only ever holds a MultiPolygon.
      return (data ?? []) as unknown as WeedPatch[]
    },
  })
}

export type WeedPatchInput = {
  id?: string
  weed: string
  geojson?: MultiPolygon
  acres?: number | null
  field_id?: string | null
  severity?: WeedPatch['severity']
  notes?: string | null
  observed_on?: string
  treated_on?: string | null
  treatment?: string | null
  chemical?: string | null
  chemical_id?: string | null
}

export function useSaveWeedPatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: WeedPatchInput) => {
      const { id, geojson, ...rest } = row
      const geo = geojson ? { geojson: geojson as unknown as Json } : {}
      const { error } = id
        ? await supabase
            .from('weed_patches')
            .update({ ...rest, ...geo, updated_at: new Date().toISOString() })
            .eq('id', id)
        : await supabase.from('weed_patches').insert({ ...rest, ...geo, geojson: geojson as unknown as Json })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['weed-patches'] }),
  })
}

export function useDeleteWeedPatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('weed_patches').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['weed-patches'] }),
  })
}
