import type { EditField } from '@/components/RecordEditor'

/**
 * A record's edit fields as read-only label / value lines, for whoever may
 * look but not change it (Sam, 7 Oct 2026: every row opens to its detail).
 * A select shows its option's label, a yes/no field Yes or No, a scaled
 * number its displayed figure; blanks are left out.
 */
export function detailRowsOf(fields: EditField[], row: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = []
  for (const f of fields) {
    const raw = row[f.key]
    if (raw == null || raw === '') continue
    let v: string
    if (f.kind === 'bool') v = raw === true || raw === 'true' ? 'Yes' : 'No'
    else if (f.kind === 'select') v = f.options?.find((o) => o.value === String(raw))?.label ?? String(raw)
    else if (f.kind === 'number') {
      const n = Number(raw) * (f.scale ?? 1)
      v = Number.isFinite(n) ? n.toLocaleString('en-CA', { maximumFractionDigits: 4 }) : String(raw)
    } else v = String(raw)
    out.push([f.label, v])
  }
  return out
}

/** The options for a select, with the record's own value kept when it is not among them. */
export function withCurrent(options: { value: string; label: string }[], current: string | null | undefined): { value: string; label: string }[] {
  if (!current || options.some((o) => o.value === current)) return options
  return [...options, { value: current, label: current }]
}
