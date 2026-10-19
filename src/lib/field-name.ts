/**
 * Field names safe for files and the combine displays (Sam, 17 Oct 2026).
 *
 * A field's name becomes a file name in every export (the combine boundary
 * shapefiles first), and a file name cannot hold / \ : * ? " < > |. So the
 * app keeps those characters out of field names: "6/Kellers" is "6-Kellers",
 * and a fraction is written as a word ("W 1/2" → "W Half").
 *
 * The database does the same on every insert and rename (fn_field_name_safe),
 * so a name from the Deere sync or an import is cleaned too. This module is
 * the screens' copy of that rule: forms block the save and offer the fix.
 */

const FORBIDDEN = /[/\\:*?"<>|]/
const FRACTIONS: [RegExp, string][] = [
  [/(^|[^0-9])3\/4(?![0-9])/g, '$13 Quarter'],
  [/(^|[^0-9])1\/2(?![0-9])/g, '$1Half'],
  [/(^|[^0-9])1\/4(?![0-9])/g, '$1Quarter'],
  [/½/g, 'Half'],
  [/¼/g, 'Quarter'],
  [/¾/g, '3 Quarter'],
]

/** The name with fractions as words and forbidden characters turned into "-". */
export function cleanFieldName(name: string): string {
  let s = name
  for (const [re, to] of FRACTIONS) s = s.replace(re, to)
  s = s.replace(/\s*[/\\:*?"<>|]+\s*/g, '-')
  return s.replace(/\s{2,}/g, ' ').trim()
}

/** Why a typed name can't be saved, with the fix — or null when it's fine. */
export function fieldNameProblem(name: string): string | null {
  if (!FORBIDDEN.test(name) && !/[½¼¾]/.test(name)) return null
  return `Field names can't use / \\ : * ? " < > | (they go into file names). Use "${cleanFieldName(name)}".`
}
