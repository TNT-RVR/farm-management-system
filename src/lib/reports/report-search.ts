/**
 * The Reports page's own search box (Sam, 19 Oct 2026): every word typed
 * must appear in the report's name, what it holds, where its data comes from
 * or its section. Case and accents don't matter. Pure.
 */
export type Searchable = { name: string; what: string; from?: { label: string }; section: string }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function reportMatches(query: string, r: Searchable, sectionTitle = ''): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold([r.name, r.what, r.from?.label ?? '', sectionTitle].join(' '))
  return words.every((w) => hay.includes(w))
}
