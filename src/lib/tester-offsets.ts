/**
 * Which meter read a moisture sample, and how far each one sits from the
 * bench tester. The bench (Model 919, read off its chart with the grain
 * temperature) is the reference; the hand-held and the bean plant's reading
 * of a sample we take in are put onto its scale by what the farm's own
 * side-by-side tests show.
 */
export type Tester = 'bench' | 'handheld' | 'bean_plant'

export const TESTERS: { value: Tester; label: string }[] = [
  { value: 'bench', label: 'Bench' },
  { value: 'handheld', label: 'Hand held' },
  { value: 'bean_plant', label: 'Bean plant' },
]

export const testerLabel = (t: string | null | undefined) => TESTERS.find((x) => x.value === t)?.label ?? null

/** How near in time two tests of a field must be to count as the same sample: 2 hours. */
const SAME_SAMPLE_MS = 2 * 3_600_000

/** Comparisons needed before a tester's readings teach the model. */
export const OFFSET_MIN = 2

/** A tester's reading less this is its bench equivalent. `n` is how many side-by-side tests it comes from. */
export type Offset = { offset: number; n: number }
export type Offsets = Partial<Record<Tester, Offset>>

type Row = { field_id: string | null; tested_at: string; moisture_pct: number; tester: Tester | null }

/**
 * Each hand-held or bean plant test against the nearest bench test of the
 * same field within two hours. The average gap is pulled toward nothing by
 * one imaginary zero, so a single comparison moves it half way: one odd
 * sample does not set the scale.
 */
export function offsetsFrom(rows: Row[]): Offsets {
  const bench = new Map<string, number[]>()
  for (const r of rows) {
    if (r.tester !== 'bench' || !r.field_id) continue
    const list = bench.get(r.field_id) ?? []
    list.push(Date.parse(r.tested_at))
    bench.set(r.field_id, list)
  }
  const pctAt = new Map(rows.filter((r) => r.tester === 'bench').map((r) => [`${r.field_id}@${Date.parse(r.tested_at)}`, r.moisture_pct]))
  const gaps: Partial<Record<Tester, number[]>> = {}
  for (const r of rows) {
    if (!r.field_id || !r.tester || r.tester === 'bench') continue
    const t = Date.parse(r.tested_at)
    let best: number | null = null
    for (const b of bench.get(r.field_id) ?? []) if (Math.abs(b - t) <= SAME_SAMPLE_MS && (best == null || Math.abs(b - t) < Math.abs(best - t))) best = b
    if (best == null) continue
    ;(gaps[r.tester] ??= []).push(r.moisture_pct - pctAt.get(`${r.field_id}@${best}`)!)
  }
  const out: Offsets = {}
  for (const [k, g] of Object.entries(gaps) as [Tester, number[]][]) {
    out[k] = { offset: Math.round((g.reduce((a, b) => a + b, 0) / (g.length + 1)) * 100) / 100, n: g.length }
  }
  return out
}

/** A reading on the bench's scale. Bench, unknown and not-yet-compared testers pass through. */
export function toBench(pct: number, tester: Tester | null, offsets: Offsets | undefined) {
  if (!tester || tester === 'bench') return pct
  return pct - (offsets?.[tester]?.offset ?? 0)
}
