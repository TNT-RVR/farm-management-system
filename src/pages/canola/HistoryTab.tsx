import { useMemo, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { useCropYear } from '@/lib/crop-year'
import { useAllBoundaries, useFields } from '@/lib/queries'
import { isCanolaCrop, useFieldYears, useSetYearTrait, type FieldYear } from '@/lib/canola-isolation'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { asTrait } from '@/lib/canola-trait'
import { TRAIT_SYSTEM, lastSeedCanola } from '@/lib/seed-canola-year'
import { fieldHistoryReport, type HistoryField } from '@/lib/reports/canola-reports'
import { downloadBlob, tableReportToCsv, tableReportToPdf } from '@/lib/table-report'
import { cn } from '@/lib/utils'

/** A field as the screen shows it: the report's, plus what's needed to set a year's trait. */
type ShownField = Omit<HistoryField, 'years'> & { id: string; years: (HistoryField['years'][number] & { row: FieldYear | null })[] }

const fileSafe = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/**
 * Canola reports → Field history (Sam, 8 Oct 2026): the crops on the fields
 * picked, year by year, for a canola company to judge whether canola can go
 * on them. Crop history where there is one, else the crop plan.
 */
export function HistoryTab() {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: boundaries } = useAllBoundaries()
  const [picked, setPicked] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [span, setSpan] = useState('5')
  const [toYear, setToYear] = useState(cropYear)
  const [company, setCompany] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null)
  const years = useMemo(() => Array.from({ length: Number(span) }, (_, k) => toYear - k), [span, toYear])
  const { data: fy, isLoading } = useFieldYears(picked, years)
  // Each field's last seed canola from its whole record, not only the years shown.
  const recordYears = useMemo(() => Array.from({ length: toYear - 1999 + 1 }, (_, k) => toYear - k), [toYear])
  const { data: record } = useFieldYears(picked, recordYears)
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const setTrait = useSetYearTrait()

  const shown = (fields ?? []).filter((f) => !search.trim() || f.name.toLowerCase().includes(search.trim().toLowerCase()))
  const acres = (id: string) => {
    const b = (boundaries ?? []).find((x) => x.field_id === id && x.valid_to == null)
    return b?.acres == null ? null : Number(b.acres)
  }
  const history: ShownField[] = picked
    .map((id) => (fields ?? []).find((f) => f.id === id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .map((f) => {
      const last = lastSeedCanola([...(record?.values() ?? [])].filter((r) => r.fieldId === f.id))
      return {
        id: f.id,
        name: f.name,
        legal: f.legal_land_description ?? null,
        acres: acres(f.id),
        lastSeedCanola: last?.canola ? { year: last.year, label: last.canola.label } : null,
        years: years.map((y) => {
          const r = fy?.get(`${f.id}|${y}`)
          return { year: y, crop: r?.display ?? null, variety: r?.variety ?? null, yield: r?.yield ?? null, acres: r?.acres ?? null, from: r?.from ?? null, row: r ?? null }
        }),
      }
    })
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const exportAs = async (kind: 'pdf' | 'csv') => {
    setBusy(kind)
    try {
      const r = fieldHistoryReport({ company: company.trim() || null, notes: notes.trim() || null, fromYear: years[years.length - 1], toYear, fields: history })
      const name = `Field crop history ${history.length === 1 ? history[0].name : `${history.length} fields`} ${years[years.length - 1]}-${toYear}`
      if (kind === 'pdf') downloadBlob(await tableReportToPdf(r), `${fileSafe(name)}.pdf`)
      else downloadBlob(new Blob([tableReportToCsv(r)], { type: 'text/csv' }), `${fileSafe(name)}.csv`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Fields</h2>
          <span className="flex gap-2 text-xs">
            <button type="button" onClick={() => setPicked(shown.map((f) => f.id))} className="text-brand-700 underline">
              All
            </button>
            <button type="button" onClick={() => setPicked([])} className="text-gray-500 underline">
              None
            </button>
          </span>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a field" aria-label="Find a field" className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
        <ul className="mt-2 max-h-[55vh] overflow-auto">
          {shown.map((f) => (
            <li key={f.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={picked.includes(f.id)} onChange={() => toggle(f.id)} />
                <span className="min-w-0 flex-1 truncate text-gray-800">{f.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            Years
            <Select
              value={span}
              onChange={setSpan}
              options={['4', '5', '6', '8', '10'].map((n) => ({ value: n, label: `${n} years` }))}
              className="mt-1 w-28"
              ariaLabel="How many years"
            />
          </label>
          <label className="text-xs text-gray-600">
            Up to
            <Select value={String(toYear)} onChange={(v) => setToYear(Number(v))} options={[cropYear + 1, cropYear, cropYear - 1].map((y) => ({ value: String(y), label: String(y) }))} className="mt-1 w-24" ariaLabel="Last year" />
          </label>
          <label className="text-xs text-gray-600">
            For (canola company)
            <input value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1 block w-48 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
          </label>
          <label className="min-w-[180px] flex-1 text-xs text-gray-600">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
          </label>
          <span className="flex gap-2">
            <button type="button" onClick={() => exportAs('pdf')} disabled={!history.length || busy != null || isLoading} className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              <FileText className="h-3.5 w-3.5" /> {busy === 'pdf' ? 'Making…' : 'PDF'}
            </button>
            <button type="button" onClick={() => exportAs('csv')} disabled={!history.length || busy != null || isLoading} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </span>
        </div>
        <HelpNote summary="Tick the fields to send; each gets its crops year by year." className="mt-2">
          <p>
            Each year shows the crop history where the farm has one (what was grown, its variety and yield), else the crop plan for that year. A canola crop names its
            herbicide trait where the crop is set up with one. A year with nothing recorded says so, rather than being left out.
          </p>
        </HelpNote>

        {!history.length ? (
          <p className="mt-6 text-center text-sm text-gray-400">Tick one or more fields on the left.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1 font-medium">Field</th>
                  {years.map((y) => (
                    <th key={y} className="py-1 font-medium">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1.5 pr-2 font-medium text-gray-900">
                      {h.name}
                      {h.acres != null && <span className="block text-[11px] font-normal text-gray-500">{Math.round(h.acres)} ac</span>}
                      <span className="block text-[11px] font-normal text-amber-800">
                        Last seed canola: {h.lastSeedCanola ? `${h.lastSeedCanola.year}, ${h.lastSeedCanola.label}` : 'none on record'}
                      </span>
                    </td>
                    {h.years.map((y) => (
                      <td key={y.year} className={cn('py-1.5 pr-2 align-top', isCanolaCrop(y.crop) ? 'font-semibold text-amber-700' : y.crop ? 'text-gray-800' : 'text-gray-300')}>
                        {y.crop ?? '—'}
                        {y.from === 'plan' && <span className="block text-[10px] font-normal text-gray-400">planned</span>}
                        {canEdit && y.row && <TraitPicker row={y.row} onSet={(trait) => setTrait.mutate({ table: y.row!.record!.table, id: y.row!.record!.id, trait })} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * A canola year whose trait the crop can't tell (Corteva and Nutrien contract
 * both): pick LibertyLink or Roundup Ready for that year. Shown only where it
 * is needed, or where it was set by hand and can be changed back.
 */
function TraitPicker({ row, onSet }: { row: FieldYear; onSet: (trait: 'liberty' | 'roundup' | null) => void }) {
  if (!row.canola || !row.record) return null
  const own = asTrait(row.record.trait)
  if (row.canola.trait && !own) return null
  return (
    <select
      value={own ?? ''}
      onChange={(e) => onSet((e.target.value || null) as 'liberty' | 'roundup' | null)}
      aria-label={`${row.year} herbicide trait`}
      className="mt-0.5 block rounded border border-amber-300 bg-white px-1 py-0.5 text-[11px] font-normal text-gray-800"
    >
      <option value="">Trait?</option>
      <option value="liberty">{TRAIT_SYSTEM.liberty}</option>
      <option value="roundup">{TRAIT_SYSTEM.roundup}</option>
    </select>
  )
}
