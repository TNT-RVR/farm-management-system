/**
 * Which bins fill which contract, in the order the contracts come due.
 *
 * Earliest delivery window first. For each contract, the crop's bins are
 * drawn down carry-over first (last year's grain should go before this
 * year's), then the fullest bin first (fewer bins to open, fewer to clean
 * out). What is left short is shown as a shortfall, not quietly spread.
 */

export type PlanContract = {
  id: string
  label: string
  cropId: string | null
  remainingBu: number
  deliveryStart: string | null
  deliveryEnd: string | null
}

export type PlanBin = { binId: string; name: string; cropId: string | null; bu: number; carryOver: boolean }

export type ContractPlan = {
  contract: PlanContract
  draws: { binId: string; name: string; bu: number }[]
  shortfallBu: number
}

export function planDeliveries(contracts: PlanContract[], bins: PlanBin[]): ContractPlan[] {
  const left = new Map(bins.map((b) => [b.binId, b.bu]))
  const order = [...contracts].sort((a, b) => (a.deliveryEnd ?? '9999').localeCompare(b.deliveryEnd ?? '9999') || (a.deliveryStart ?? '9999').localeCompare(b.deliveryStart ?? '9999'))
  return order.map((c) => {
    let need = Math.max(0, c.remainingBu)
    const draws: ContractPlan['draws'] = []
    const candidates = bins
      .filter((b) => b.cropId === c.cropId && (left.get(b.binId) ?? 0) > 0)
      .sort((a, b) => Number(b.carryOver) - Number(a.carryOver) || (left.get(b.binId) ?? 0) - (left.get(a.binId) ?? 0))
    for (const b of candidates) {
      if (need <= 0) break
      const take = Math.min(need, left.get(b.binId) ?? 0)
      if (take <= 0) continue
      draws.push({ binId: b.binId, name: b.name, bu: take })
      left.set(b.binId, (left.get(b.binId) ?? 0) - take)
      need -= take
    }
    return { contract: c, draws, shortfallBu: need }
  })
}

/** Truckloads for a quantity: a Super B carries about 42 tonnes of grain. */
export function loadsFor(bu: number, lbPerBu: number | null | undefined, payloadKg = 42_000): number | null {
  if (!(bu > 0) || !lbPerBu) return null
  return Math.ceil((bu * lbPerBu) / 2.20462262 / payloadKg)
}
