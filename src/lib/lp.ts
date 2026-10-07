/**
 * A small linear-program solver: minimise c·x subject to rows of
 * a·x ≤ b or a·x ≥ b, with x ≥ 0. Two-phase simplex on a dense tableau,
 * Bland's rule so it can't cycle. Sized for tens of variables and
 * constraints — the feed allocation — not for anything big.
 */
export type Constraint = { a: number[]; op: '<=' | '>='; b: number }

export function lpMinimize(c: number[], cons: Constraint[], maxIter = 20_000): { x: number[]; value: number } | null {
  const n = c.length
  const m = cons.length
  const EPS = 1e-9
  // Right-hand sides must be ≥ 0: flip a row (and its sense) when not.
  const rows = cons.map((r) => (r.b < 0 ? { a: r.a.map((v) => -v), op: r.op === '<=' ? ('>=' as const) : ('<=' as const), b: -r.b } : r))
  const artRows = rows.map((r, i) => (r.op === '>=' ? i : -1)).filter((i) => i >= 0)
  const k = artRows.length
  const cols = n + m + k // x, slack/surplus per row, artificial per ≥ row
  const T: number[][] = rows.map((r, i) => {
    const row = new Array(cols + 1).fill(0)
    for (let j = 0; j < n; j++) row[j] = r.a[j] ?? 0
    row[n + i] = r.op === '<=' ? 1 : -1
    const ai = artRows.indexOf(i)
    if (ai >= 0) row[n + m + ai] = 1
    row[cols] = r.b
    return row
  })
  const basis = rows.map((r, i) => (r.op === '<=' ? n + i : n + m + artRows.indexOf(i)))
  const isArt = (j: number) => j >= n + m

  const run = (cost: number[], allowArt: boolean): boolean => {
    for (let it = 0; it < maxIter; it++) {
      // Entering: the first column with a negative reduced cost (Bland).
      let enter = -1
      for (let j = 0; j < cols; j++) {
        if (!allowArt && isArt(j)) continue
        if (basis.includes(j)) continue
        let rc = cost[j]
        for (let i = 0; i < m; i++) rc -= cost[basis[i]] * T[i][j]
        if (rc < -EPS) {
          enter = j
          break
        }
      }
      if (enter < 0) return true
      // Leaving: the smallest ratio, ties to the smallest basis index.
      let leave = -1
      let best = Infinity
      for (let i = 0; i < m; i++) {
        const v = T[i][enter]
        if (v > EPS) {
          const ratio = T[i][cols] / v
          if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && leave >= 0 && basis[i] < basis[leave])) {
            best = ratio
            leave = i
          }
        }
      }
      if (leave < 0) return false // unbounded
      pivot(leave, enter)
    }
    return false
  }
  const pivot = (r: number, j: number) => {
    const p = T[r][j]
    for (let c2 = 0; c2 <= cols; c2++) T[r][c2] /= p
    for (let i = 0; i < m; i++) {
      if (i === r) continue
      const f = T[i][j]
      if (Math.abs(f) < 1e-15) continue
      for (let c2 = 0; c2 <= cols; c2++) T[i][c2] -= f * T[r][c2]
    }
    basis[r] = j
  }

  // Phase 1: drive the artificials to zero.
  if (k > 0) {
    const cost1 = new Array(cols).fill(0).map((_, j) => (isArt(j) ? 1 : 0))
    if (!run(cost1, true)) return null
    const infeas = basis.reduce((s, b, i) => s + (isArt(b) ? T[i][cols] : 0), 0)
    if (infeas > 1e-6) return null
    // Any artificial still basic (at zero): pivot it out on a real column.
    for (let i = 0; i < m; i++) {
      if (!isArt(basis[i])) continue
      const j = T[i].findIndex((v, jj) => jj < n + m && Math.abs(v) > EPS)
      if (j >= 0) pivot(i, j)
    }
  }
  // Phase 2.
  const cost2 = new Array(cols).fill(0).map((_, j) => (j < n ? c[j] : 0))
  if (!run(cost2, false)) return null
  const x = new Array(n).fill(0)
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = T[i][cols]
  return { x, value: x.reduce((s, v, j) => s + v * c[j], 0) }
}
