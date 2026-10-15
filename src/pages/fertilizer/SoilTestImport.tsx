import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, Upload } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select, type SelectOption } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { supabase } from '@/lib/supabase'
import { useAllFields } from '@/lib/queries'
import { downloadBlob } from '@/lib/table-report'
import {
  autoMap,
  groupRows,
  matchField,
  parseCsv,
  ROLES,
  skipReason,
  SOIL_VALUE_COLUMNS,
  templateCsv,
  type ExistingReport,
  type ImportGroup,
  type Target,
} from '@/lib/soil-import'
import { SOIL_QUERY_ROOTS } from '@/lib/soilTests'

const SKIP = '__skip'

const TARGET_OPTIONS: SelectOption[] = [
  { value: 'ignore', label: '— ignore —' },
  ...ROLES.map((r) => ({ value: r.key, label: r.label })),
  ...SOIL_VALUE_COLUMNS.map((c) => ({ value: c.key, label: c.label })),
]

type Result = {
  written: { label: string; field: string; samples: number }[]
  skipped: { label: string; why: string }[]
  unmatched: number
  failed: { label: string; why: string }[]
}


/**
 * Load a lab's results CSV into the soil test tables, from the browser.
 *
 * One screen: pick the file, check what each column is, check which field each
 * sampling belongs to, import. A sampling that matches no field is skipped
 * unless someone picks one — it may well be a neighbour's quarter sampled the
 * same day.
 */
export function SoilTestImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: fields } = useAllFields()
  const [fileName, setFileName] = useState<string | null>(null)
  const [table, setTable] = useState<string[][] | null>(null)
  const [mapping, setMapping] = useState<Target[]>([])
  const [labName, setLabName] = useState('')
  const [fieldChoice, setFieldChoice] = useState<Record<string, string>>({})
  const [yearChoice, setYearChoice] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const header = table?.[0] ?? []
  const rows = useMemo(() => table?.slice(1) ?? [], [table])

  const pick = async (list: FileList | null) => {
    const f = list?.[0]
    setError(null)
    setResult(null)
    setFieldChoice({})
    setYearChoice({})
    if (!f) return
    try {
      const parsed = parseCsv(await f.text())
      if (parsed.length < 2) throw new Error('That file has no rows under its header.')
      setTable(parsed)
      setMapping(autoMap(parsed[0]))
      setFileName(f.name)
    } catch (e) {
      setTable(null)
      setFileName(null)
      setError((e as Error).message)
    }
  }

  const depthIdx = mapping.indexOf('depth')
  const depthUnit = depthIdx >= 0 && /cm/i.test(header[depthIdx] ?? '') ? 'cm' : undefined
  const grouped = useMemo(
    () => (table ? groupRows(rows, mapping, { depthUnit }) : null),
    [table, rows, mapping, depthUnit],
  )

  const fieldList = useMemo(
    () =>
      (fields ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        legal_land_description: f.legal_land_description,
        active: f.active,
      })),
    [fields],
  )
  const fieldName = (id: string) => {
    const f = fieldList.find((x) => x.id === id)
    return f ? (f.active ? f.name : `${f.name} (archived)`) : id
  }
  const fieldOptions: SelectOption[] = useMemo(
    () => [
      { value: SKIP, label: 'Skip — not one of ours' },
      ...fieldList
        .filter((f) => f.active)
        .map((f) => ({ value: f.id, label: f.name })),
      ...fieldList
        .filter((f) => !f.active)
        .map((f) => ({ value: f.id, label: `${f.name} (archived)` })),
    ],
    [fieldList],
  )

  const auto = useMemo(() => {
    const m = new Map<string, ReturnType<typeof matchField>>()
    for (const g of grouped?.groups ?? []) m.set(g.key, matchField(g.label, fieldList))
    return m
  }, [grouped, fieldList])

  const chosenField = (g: ImportGroup) => fieldChoice[g.key] ?? auto.get(g.key)?.fieldId ?? SKIP
  const chosenYear = (g: ImportGroup) => {
    const v = yearChoice[g.key]
    return v != null ? Number(v) : g.cropYear
  }
  const toImport = (grouped?.groups ?? []).filter((g) => {
    const y = chosenYear(g)
    return chosenField(g) !== SKIP && y != null && Number.isInteger(y) && y > 1900
  })

  const missingRoles = (['label', 'date'] as const).filter((r) => !mapping.includes(r))
  const mappedValues = mapping.filter((t) => SOIL_VALUE_COLUMNS.some((c) => c.key === t)).length

  const setTarget = (i: number, t: Target) =>
    setMapping((m) =>
      m.map((cur, j) => {
        if (j === i) return t
        // One column per role or value: choosing it here frees it elsewhere.
        return t !== 'ignore' && cur === t ? 'ignore' : cur
      }),
    )

  const run = async () => {
    if (!grouped || !fileName) return
    setBusy(true)
    setError(null)
    const res: Result = {
      written: [],
      skipped: [],
      unmatched: grouped.groups.length - toImport.length,
      failed: [],
    }
    try {
      const ids = [...new Set(toImport.map(chosenField))]
      const { data: existingRows, error: exErr } = await supabase
        .from('soil_test_reports')
        .select('field_id, crop_year, part_label, report_date, source_file')
        .in('field_id', ids)
      if (exErr) throw exErr
      const existing: ExistingReport[] = [...(existingRows ?? [])]

      for (const g of toImport) {
        const fieldId = chosenField(g)
        const cropYear = chosenYear(g)!
        const why = skipReason(
          { fieldId, cropYear, label: g.label, date: g.date, sourceFile: fileName },
          existing,
        )
        if (why) {
          res.skipped.push({
            label: `${g.label} (${g.date})`,
            why:
              why === 'imported'
                ? 'already imported from this file'
                : `${fieldName(fieldId)} already has a ${cropYear} report under this label`,
          })
          continue
        }
        const { data: rep, error: repErr } = await supabase
          .from('soil_test_reports')
          .insert({
            field_id: fieldId,
            crop_year: cropYear,
            part_label: g.label,
            crop_label: g.crop,
            lab: g.lab || labName.trim() || null,
            report_ref: g.reportRef,
            report_date: g.date,
            source_file: fileName,
          })
          .select('id')
          .single()
        if (repErr || !rep) {
          res.failed.push({ label: `${g.label} (${g.date})`, why: repErr?.message ?? 'no id returned' })
          continue
        }
        const { error: sErr } = await supabase.from('soil_test_samples').insert(
          g.samples.map((s) => ({
            report_id: rep.id,
            sample_code: s.sample_code,
            depth_label: s.depth_label,
            depth_top_in: s.depth_top_in,
            depth_bottom_in: s.depth_bottom_in,
            ...s.values,
          })),
        )
        if (sErr) {
          // Take the empty report back out so a retry is not blocked by it.
          await supabase.from('soil_test_reports').delete().eq('id', rep.id)
          res.failed.push({ label: `${g.label} (${g.date})`, why: sErr.message })
          continue
        }
        existing.push({
          field_id: fieldId,
          crop_year: cropYear,
          part_label: g.label,
          report_date: g.date,
          source_file: fileName,
        })
        res.written.push({ label: g.label, field: fieldName(fieldId), samples: g.samples.length })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResult(res)
      setBusy(false)
      void qc.invalidateQueries({
        predicate: (q) => SOIL_QUERY_ROOTS.has(String(q.queryKey[0])),
      })
    }
  }

  const template = () =>
    downloadBlob(new Blob([templateCsv()], { type: 'text/csv' }), 'soil-test-template.csv')

  return (
    <Modal title="Upload lab results" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm">
        {/* 1. File */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
            <Upload className="h-4 w-4" />
            {fileName ? 'Choose another file' : 'Choose CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          <button
            onClick={template}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" /> Download a blank template
          </button>
          <HelpNote title="What file works">
            A CSV with one row per sample: a column naming the field (its legal land description
            or its name), the sampling date, the depth, and one column per nutrient. Most labs can
            export this from their results portal. If yours can&apos;t, download the blank
            template, type the numbers from the report into it in any spreadsheet, and save it
            as CSV. Rows marked as plant tissue are left out — they use different units.
          </HelpNote>
        </div>
        {fileName && (
          <p className="text-xs text-gray-500">
            <b className="text-gray-800">{fileName}</b> — {rows.length} row{rows.length === 1 ? '' : 's'}
          </p>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        {table && grouped && !result && (
          <>
            {/* 2. Columns */}
            <Fold
              title="Columns"
              summary={`${mappedValues} soil value${mappedValues === 1 ? '' : 's'} read`}
              defaultOpen={missingRoles.length > 0}
            >
              <div className="mb-2">
                <HelpNote summary="Each column in the file and what it is read as." title="Columns">
                  Matched by name, so the usual lab spellings are picked up on their own. Change any
                  that are wrong; set a column to ignore to leave it out. A plain &quot;P&quot; is
                  read as Olsen (bicarbonate) phosphorus — pick Mehlich-3 if that is what your lab
                  ran. Numbers below detection (&quot;&lt;0.1&quot;) are left empty.
                </HelpNote>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border border-gray-200">
                <table className="w-full text-xs">
                  <tbody>
                    {header.map((h, i) => {
                      const example = rows.find((r) => (r[i] ?? '').trim())?.[i] ?? ''
                      return (
                        <tr key={i} className="border-b border-gray-100 last:border-0">
                          <td className="px-2 py-1 font-medium text-gray-800">{h || <i>(blank)</i>}</td>
                          <td className="max-w-[10rem] truncate px-2 py-1 text-gray-400" title={example}>
                            {example}
                          </td>
                          <td className="w-56 px-2 py-1">
                            <Select
                              size="sm"
                              value={mapping[i] ?? 'ignore'}
                              onChange={(v) => setTarget(i, v as Target)}
                              options={TARGET_OPTIONS}
                              ariaLabel={`What ${h} holds`}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Fold>
            {missingRoles.length > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Pick the column that holds the{' '}
                {missingRoles.map((r) => (r === 'label' ? 'field / sample label' : 'sampling date')).join(' and the ')}.
              </p>
            )}

            {!mapping.includes('lab') && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                Lab
                <input
                  value={labName}
                  onChange={(e) => setLabName(e.target.value)}
                  placeholder="optional"
                  className="w-48 rounded-md border border-gray-200 px-2 py-1 text-sm"
                />
              </label>
            )}

            {/* 3. Reports */}
            {grouped.groups.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {grouped.groups.length} sampling{grouped.groups.length === 1 ? '' : 's'}
                  </h3>
                  <HelpNote title="Fields and crop years">
                    Each sampling is matched to a field by the legal land description in its label
                    first, then by a field name written in the label. Anything that doesn&apos;t
                    match cleanly is set to skip — pick its field, or leave it if it isn&apos;t
                    your ground. A sample taken from July on counts toward the next crop year;
                    change the year if that is wrong.
                  </HelpNote>
                </div>
                <div className="overflow-x-auto rounded-md border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-left text-gray-500">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Label</th>
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium">Samples</th>
                        <th className="px-2 py-1.5 font-medium">Field</th>
                        <th className="px-2 py-1.5 font-medium">Crop year</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.groups.map((g) => {
                        const f = chosenField(g)
                        const how = auto.get(g.key)?.how
                        return (
                          <tr key={g.key} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-gray-800">{g.label}</td>
                            <td className="whitespace-nowrap px-2 py-1 text-gray-600">{g.date}</td>
                            <td className="px-2 py-1 text-gray-600">{g.samples.length}</td>
                            <td className="w-56 px-2 py-1">
                              <Select
                                size="sm"
                                value={f}
                                onChange={(v) => setFieldChoice((c) => ({ ...c, [g.key]: v }))}
                                options={fieldOptions}
                                ariaLabel={`Field for ${g.label}`}
                                title={
                                  fieldChoice[g.key] == null && how
                                    ? how === 'legal'
                                      ? 'Matched by legal land description'
                                      : 'Matched by field name'
                                    : undefined
                                }
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={yearChoice[g.key] ?? String(g.cropYear ?? '')}
                                onChange={(e) =>
                                  setYearChoice((c) => ({ ...c, [g.key]: e.target.value }))
                                }
                                className="w-20 rounded border border-gray-200 px-1.5 py-0.5"
                                aria-label={`Crop year for ${g.label}`}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(grouped.tissue > 0 || grouped.incomplete > 0) && (
              <p className="text-xs text-gray-500">
                {grouped.tissue > 0 && `${grouped.tissue} plant tissue row${grouped.tissue === 1 ? '' : 's'} left out. `}
                {grouped.incomplete > 0 &&
                  `${grouped.incomplete} row${grouped.incomplete === 1 ? '' : 's'} with no label or readable date left out.`}
              </p>
            )}

            {/* 4. Import */}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void run()}
                disabled={busy || toImport.length === 0}
                className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {toImport.length} report{toImport.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-800">
              <b>{result.written.length}</b> report{result.written.length === 1 ? '' : 's'} written
              {result.skipped.length > 0 && <>, <b>{result.skipped.length}</b> skipped</>}
              {result.unmatched > 0 && <>, <b>{result.unmatched}</b> left unmatched</>}
              {result.failed.length > 0 && <>, <b className="text-red-700">{result.failed.length}</b> failed</>}.
            </p>
            {result.written.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-gray-600">
                {result.written.map((w, i) => (
                  <li key={i}>
                    {w.label} → {w.field} ({w.samples} sample{w.samples === 1 ? '' : 's'})
                  </li>
                ))}
              </ul>
            )}
            {result.skipped.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-gray-500">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    {s.label} — {s.why}
                  </li>
                ))}
              </ul>
            )}
            {result.failed.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-red-700">
                {result.failed.map((s, i) => (
                  <li key={i}>
                    {s.label} — {s.why}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setResult(null)}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={onClose}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
