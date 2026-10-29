/**
 * Savings tools that live on another page (Sam, 26 Oct 2026: one home per
 * fact). Each answered a question another tab already owns — the plan's need,
 * the soil's P and K, the tissue test, the prescription, the price book — so the
 * card moved to the foot of that tab, and Savings keeps a line pointing to it.
 *
 * `card: false` is a tool whose home already did the job (the 4R / NERP pack is
 * a report on Reports), so it is linked to, not rendered.
 *
 * Old `/fertilizer/savings?tool=<n>` links forward to the home with the same
 * `?tool=`, which opens the card there. Pure, so the map is tested without React.
 */
export type SavingsHome = { n: number; title: string; label: string; to: string; card: boolean }

export const SAVINGS_HOMES: readonly SavingsHome[] = [
  { n: 2, title: 'Cost per pound of nutrient', label: 'Fertilizer prices › Pricing', to: '/fertilizer/prices?tab=pricing', card: true },
  { n: 3, title: 'Blend premium check', label: 'Fertilizer prices › Retailer', to: '/fertilizer/prices?tab=retailer', card: true },
  { n: 4, title: 'Need versus booked', label: 'Fertility plan › Requirements', to: '/fertilizer/plan?tab=requirements', card: true },
  { n: 9, title: 'Manure credits in the prescription', label: 'Manure', to: '/fertilizer/manure', card: true },
  { n: 13, title: 'Removal-based P and K', label: 'Soil tests › Nutrient history', to: '/fertilizer/soil?tab=history', card: true },
  { n: 35, title: 'P and K running balance', label: 'Soil tests › Nutrient history', to: '/fertilizer/soil?tab=history', card: true },
  { n: 15, title: 'Tissue-test gate on top-ups', label: 'Soil tests › Tissue tests', to: '/fertilizer/soil?tab=tissue', card: true },
  { n: 17, title: 'Variable rate versus flat', label: 'Fertility plan › Prescriptions', to: '/fertilizer/plan?tab=rx', card: true },
  { n: 19, title: 'Fertilizer cost per bushel by field', label: 'Map › Profit / Loss', to: '/map?tab=profit', card: true },
  { n: 22, title: 'Grants that pay for the practice', label: 'Grants', to: '/grants', card: true },
  { n: 36, title: '4R / NERP record pack', label: 'Reports', to: '/reports?open=nerp', card: false },
]

/** Where tool `n` lives now, with `?tool=n` so the card there opens; null when it is still on Savings. */
export function savingsToolHref(n: number): string | null {
  const h = SAVINGS_HOMES.find((x) => x.n === n)
  if (!h) return null
  if (!h.card) return h.to
  return `${h.to}${h.to.includes('?') ? '&' : '?'}tool=${n}`
}
