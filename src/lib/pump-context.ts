import { useMemo } from 'react'
import { useFields } from './queries'
import { useFieldPivots, usePumps, type PumpRow } from './irrigation'

/**
 * What a pump's details need beyond its own row: the pivots it feeds (with
 * each pivot's flow) and which pumps share its power meter. Shared by the
 * Pump information table and the map pins that mark pumps.
 */
export function usePumpContext() {
  const { data: pumps } = usePumps()
  const { data: pivots } = useFieldPivots()
  const { data: fields } = useFields()
  const pivotsByPump = useMemo(() => {
    const names = new Map((fields ?? []).map((f) => [f.id, f.name]))
    const m = new Map<string, { name: string; gpm: number | null }[]>()
    for (const p of pivots ?? []) {
      if (!p.pump_id || !p.field_id) continue
      const name = names.get(p.field_id)
      if (name) m.set(p.pump_id, [...(m.get(p.pump_id) ?? []), { name, gpm: p.gpm == null ? null : Number(p.gpm) }])
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return m
  }, [pivots, fields])
  const meterShares = (p: PumpRow) => ({
    sharesWith: (pumps ?? []).find((x) => x.id === p.power_meter_shared_with)?.name ?? null,
    alsoOnIt: (pumps ?? []).filter((x) => x.power_meter_shared_with === p.id).map((x) => x.name),
  })
  return { pumps, pivotsByPump, meterShares }
}
