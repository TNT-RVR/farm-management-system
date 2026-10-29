import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { shrinkForReading } from './shrink-image'
import type { Database, Json } from './database.types'
import type { Level } from './bin-monitor'

export type MonitorRow = Omit<Database['public']['Tables']['bin_monitor_readings']['Row'], 'levels'> & { levels: Level[] }

const asRow = (r: Database['public']['Tables']['bin_monitor_readings']['Row']): MonitorRow => ({
  ...r,
  levels: (Array.isArray(r.levels) ? r.levels : []) as unknown as Level[],
})

/** One bin's readings, newest first. */
export function useBinMonitorReadings(binId: string | null | undefined) {
  return useQuery({
    queryKey: ['bin_monitor', 'bin', binId],
    enabled: !!binId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bin_monitor_readings')
        .select('*')
        .eq('bin_id', binId!)
        .order('read_on', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map(asRow)
    },
    staleTime: 30_000,
  })
}

/** Every reading in a crop year, for the all-bins report. */
export async function fetchMonitorYear(cropYear: number): Promise<MonitorRow[]> {
  const { data, error } = await supabase
    .from('bin_monitor_readings')
    .select('*')
    .eq('crop_year', cropYear)
    .order('read_on')
  if (error) throw error
  return (data ?? []).map(asRow)
}


export type MonitorInput = {
  id?: string
  bin_id: string
  crop_year: number
  crop_id: string | null
  read_on: string
  lot_number: string | null
  lld: string | null
  initials: string | null
  levels: Level[]
  source: 'manual' | 'screenshot'
  notes: string | null
  /** The seed company's record: aeration turned on since the last reading. */
  aeration_on?: boolean | null
}

export function useSaveBinMonitor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: MonitorInput) => {
      const { id, ...row } = v
      const body = { ...row, levels: row.levels as unknown as Json, updated_at: new Date().toISOString() }
      const { error } = id
        ? await supabase.from('bin_monitor_readings').update(body).eq('id', id)
        : await supabase.from('bin_monitor_readings').insert(body)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bin_monitor'] }),
  })
}

export function useDeleteBinMonitor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bin_monitor_readings').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bin_monitor'] }),
  })
}

export type CableRead = {
  bin_name: string | null
  crop: string | null
  ambient_temp_c: number | null
  bushels: number | null
  percent_kind: 'rh' | 'moisture' | 'unknown'
  /** `above_grain`: in the headspace, not buried — its moisture means nothing. */
  levels: { temp_c: number | null; pct: number | null; no_data: boolean; above_grain?: boolean }[]
  confidence: 'high' | 'medium' | 'low'
  note: string
}

/** Send a screenshot of the Bin-Sense cable to be read. Nothing is saved. */
export async function readCableScreenshot(file: Blob): Promise<CableRead> {
  const img = await shrinkForReading(file)
  const type = img.type || 'image/jpeg'
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/read-bin-cable', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': type, 'x-media-type': type },
    body: img,
  })
  const body = (await res.json().catch(() => ({}))) as CableRead & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `Could not read the screenshot (${res.status})`)
  return body
}
