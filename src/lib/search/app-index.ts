import { NAV_ITEMS } from '@/lib/nav'
import { TILES } from '@/lib/tiles'
import type { ReportEntry } from '@/lib/reports/catalogue'
import type { TabEntry } from './tabs'

/**
 * The app's own places, for the search bar: every page (the sidebar and the
 * home-screen tiles, which between them deep-link every screen), every tab
 * inside a page, and every report. Searched in the browser as you type — no
 * round trip — and mixed in above the farm's records.
 */

export type AppHitKind = 'page' | 'tab' | 'report'

export type AppHit = {
  kind: AppHitKind
  label: string
  /** Second line: what it is for, or where it lives. */
  sub: string
  to: string
  /** The view this belongs to, for the farm's switched-off pages and a person's denied views. */
  gate: string
  /** Everything a search may match, lower-cased. */
  terms: string
}

const bare = (to: string) => to.split('?')[0]

function hit(kind: AppHitKind, label: string, sub: string, to: string, gate: string, extra = ''): AppHit {
  return { kind, label, sub, to, gate: bare(gate), terms: `${label} ${sub} ${extra}`.toLowerCase() }
}

export function buildAppIndex(tabs: TabEntry[], reports: ReportEntry[], role: { isAdmin: boolean; isManager: boolean } = { isAdmin: true, isManager: true }): AppHit[] {
  const out: AppHit[] = []
  for (const item of NAV_ITEMS) {
    // A section with children is a heading on the sidebar, not always a page.
    if (!item.children?.length) out.push(hit('page', item.label, 'Page', item.to, item.to))
    for (const c of item.children ?? []) out.push(hit('page', c.label, item.label, c.to, c.to, item.label))
  }
  for (const t of TILES) out.push(hit('page', t.label, t.hint, t.to, t.section, t.group))
  for (const t of tabs) {
    if ((t.adminOnly && !role.isAdmin) || (t.managerOnly && !role.isManager)) continue
    out.push(hit('tab', t.label, `${t.page} tab`, t.to, t.to, `${t.page} ${t.keywords ?? ''}`))
  }
  for (const r of reports) out.push(hit('report', r.name, r.what, `/reports?open=${encodeURIComponent(r.id)}`, r.from.to, `report download ${r.formats.join(' ')} ${r.from.label}`))
  return out
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9°%]+/).filter(Boolean)

/**
 * How well a place matches. Every word typed must start a word in it (so
 * "fert sav" finds Fertilizer Savings, "bale" finds the bale log); a match in
 * the name beats one in the description. Zero is no match.
 */
export function scoreHit(h: AppHit, q: string): number {
  const typed = words(q)
  if (!typed.length) return 0
  const all = words(h.terms)
  if (!typed.every((t) => all.some((w) => w.startsWith(t)))) return 0
  const label = h.label.toLowerCase()
  const inLabel = words(label)
  const query = typed.join(' ')
  let s = 10
  if (label === query) s = 100
  else if (label.startsWith(query)) s = 70
  else if (typed.every((t) => inLabel.some((w) => w.startsWith(t)))) s = 45
  else if (typed.some((t) => inLabel.some((w) => w.startsWith(t)))) s = 25
  // Pages before tabs before reports when otherwise equal; shorter names first.
  return s + (h.kind === 'page' ? 3 : h.kind === 'tab' ? 2 : 1) - Math.min(label.length, 40) / 100
}

/** The best matches, one per destination. */
export function searchApp(index: AppHit[], q: string, allowed: (h: AppHit) => boolean = () => true, limit = 12): AppHit[] {
  const best = new Map<string, { h: AppHit; s: number }>()
  for (const h of index) {
    const s = scoreHit(h, q)
    if (!s || !allowed(h)) continue
    const was = best.get(h.to)
    if (!was || s > was.s) best.set(h.to, { h, s })
  }
  return [...best.values()]
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.h)
}
