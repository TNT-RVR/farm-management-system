import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database, Json } from './database.types'
import { emcKind, type Level } from './bin-monitor'
import type { ReportBin } from './bin-monitor-export'

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

/**
 * Every canola bin with readings in a crop year, as BASF's report wants them:
 * bin, lot and LLD (the latest one written down), and the readings in order.
 * The bin page's "All canola bins" button and the Reports page both use it.
 */
export async function fetchCanolaReportBins(cropYear: number): Promise<ReportBin[]> {
  const [rows, binRows, cropRows] = await Promise.all([
    fetchMonitorYear(cropYear),
    supabase.from('bins').select('id, name'),
    supabase.from('crops').select('id, name'),
  ])
  const nameOf = new Map((binRows.data ?? []).map((b) => [b.id, b.name as string]))
  const cropOf = new Map((cropRows.data ?? []).map((c) => [c.id, c.name as string]))
  const byBin = new Map<string, MonitorRow[]>()
  for (const r of rows) {
    if (emcKind(cropOf.get(r.crop_id ?? '')) !== 'canola') continue
    byBin.set(r.bin_id, [...(byBin.get(r.bin_id) ?? []), r])
  }
  return [...byBin.entries()]
    .map(([id, rs]) => ({
      name: nameOf.get(id) ?? 'Bin',
      lot: [...rs].reverse().find((r) => r.lot_number)?.lot_number ?? null,
      lld: [...rs].reverse().find((r) => r.lld)?.lld ?? null,
      crop: cropOf.get(rs[0].crop_id ?? '') ?? 'Canola',
      readings: rs,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
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
  levels: { temp_c: number | null; pct: number | null; no_data: boolean }[]
  confidence: 'high' | 'medium' | 'low'
  note: string
}

/**
 * A phone screenshot is 1–3 MB of PNG; the function takes 6 MB and the model
 * reads a 1600-pixel image as well as a full-size one. Shrunk to a JPEG first.
 */
async function shrink(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
    return out ?? file
  } catch {
    return file
  }
}

/** Send a screenshot of the Bin-Sense cable to be read. Nothing is saved. */
export async function readCableScreenshot(file: Blob): Promise<CableRead> {
  const img = await shrink(file)
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
