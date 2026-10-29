import { useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useTownshipTable } from '@/lib/geo/atsTownships'
import { useAllBoundaries, useCrops, useFields } from '@/lib/queries'
import {
  MILE_M,
  cropFor,
  isCanolaCrop,
  ourFieldFor,
  quartersInArea,
  reportYears,
  useFieldYears,
  useIsolationArea,
  useIsolationReport,
  useDeleteQuarterOwner,
  useKnownOwners,
  useQuarterCrops,
  useQuarterOwners,
  useSaveIsolationReport,
  useSaveQuarterCrop,
  useSaveQuarterOwner,
  whoseLabel,
  type CropCell,
  type QuarterOwner,
} from '@/lib/canola-isolation'
import { AddButton, DetailList, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { isolationReport, type IsolationRow } from '@/lib/reports/canola-reports'
import { downloadBlob, tableReportToCsv, tableReportToPdf } from '@/lib/table-report'
import { farmBrand } from '@/lib/farm-setup'
import { cn } from '@/lib/utils'
import { lastSeedCanola } from '@/lib/seed-canola-year'
import { IsolationMap, type IsolationMapHandle, type MapQuarter } from './IsolationMap'
import { TABLE_HEAD } from '@/lib/table-style'
import { ExportButton } from '@/components/ExportButton'

/** What a neighbour's quarter is likely to be, beside the farm's own crops, for the picker. */
const COMMON = ['Canola', 'Wheat', 'Durum', 'Barley', 'Oats', 'Peas', 'Dry beans', 'Potatoes', 'Sugar beets', 'Corn', 'Alfalfa', 'Hay', 'Pasture', 'Native grass', 'Summerfallow', 'Yard / farmstead', 'Not farmed', 'Unknown']

const fileSafe = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/**
 * Canola reports → Isolation (Sam, 8 Oct 2026): pick the seed canola field,
 * see the mile around it, label every quarter in it with what is planted now
 * and the four years before, and export it for the seed company. Labels are
 * kept by quarter and year, so a quarter done once fills itself in on every
 * later report.
 */
export function IsolationTab() {
  const { profile } = useAuth()
  // Anyone active marks quarters (Sam, 13 Oct 2026); the database checks is_active.
  const canEdit = Boolean(profile?.active)
  const { cropYear } = useCropYear()
  const [year, setYear] = useState(cropYear)
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const { data: fields } = useFields()
  const { data: boundaries } = useAllBoundaries()
  const { data: crops } = useCrops()
  const table = useTownshipTable(true)
  const area = useIsolationArea(fieldId, MILE_M)
  const years = useMemo(() => reportYears(year), [year])
  const mapRef = useRef<IsolationMapHandle>(null)

  const withBoundary = useMemo(() => {
    const has = new Set((boundaries ?? []).filter((b) => b.valid_to == null).map((b) => b.field_id))
    return (fields ?? []).filter((f) => has.has(f.id))
  }, [fields, boundaries])
  const fieldName = (id: string | null) => (fields ?? []).find((f) => f.id === id)?.name ?? 'field'

  const quarters = useMemo(() => (area.data?.area ? quartersInArea(area.data.area, table) : []), [area.data, table])
  const owner = useMemo(() => new Map(quarters.map((q) => [q.text, ourFieldFor(q, area.data?.ours ?? [])])), [quarters, area.data])
  const { data: labels } = useQuarterCrops(quarters.map((q) => q.text))
  const { data: owners } = useQuarterOwners(quarters.map((q) => q.text))
  const ourIds = useMemo(() => [...new Set([...owner.values()].filter(Boolean).map((o) => o!.fieldId))], [owner])
  const { data: fieldYears } = useFieldYears(ourIds, years)
  const ourCrops = useMemo(() => new Map([...(fieldYears ?? new Map()).entries()].map(([k, v]) => [k, v.display])), [fieldYears])
  // The field's last seed canola from its whole record, not only the five years shown.
  const recordYears = useMemo(() => Array.from({ length: year - 1999 + 1 }, (_, k) => year - k), [year])
  const { data: record } = useFieldYears(fieldId ? [fieldId] : [], recordYears)
  const lastSeed = useMemo(() => {
    const l = lastSeedCanola([...(record?.values() ?? [])])
    return l?.canola ? { year: l.year, label: l.canola.label } : null
  }, [record])

  const rows: IsolationRow[] = useMemo(
    () =>
      quarters.map((q) => {
        const o = owner.get(q.text) ?? null
        const who = owners?.get(q.text) ?? null
        return {
          parcel: q.text,
          label: q.label,
          ours: o ? fieldName(o.fieldId) : null,
          isTheField: o?.fieldId === fieldId,
          owner: who,
          cells: years.map((y) => cropFor({ parcel: q.text, year: y, labels: labels ?? new Map(), fieldId: o?.fieldId ?? null, ourCrops, pasture: who?.kind === 'pasture' })),
        }
      }),
    // fieldName reads `fields`, listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quarters, owner, owners, years, labels, ourCrops, fieldId, fields],
  )
  const mapQuarters: MapQuarter[] = useMemo(
    () =>
      quarters.map((q, k) => {
        const r = rows[k]
        const now = r.cells[0]?.crop
        return {
          parcel: q.text,
          label: `${q.label}\n${now ?? '?'}`,
          ring: q.box.ring.map((c) => [c.lng, c.lat] as [number, number]),
          kind: isCanolaCrop(now) ? 'canola' : r.ours ? 'ours' : /pasture/i.test(now ?? '') ? 'pasture' : now ? 'labelled' : 'blank',
        }
      }),
    [quarters, rows],
  )

  const report = useIsolationReport(fieldId, year)
  const saveReport = useSaveIsolationReport()
  const [, setBusy] = useState<'pdf' | 'csv' | null>(null)
  const unknown = rows.filter((r) => !r.isTheField && !r.cells[0]?.crop).length
  const canolaNear = rows.filter((r) => !r.isTheField && isCanolaCrop(r.cells[0]?.crop)).length

  const build = async (withMap: boolean) => {
    const f = (fields ?? []).find((x) => x.id === fieldId)
    const b = (boundaries ?? []).find((x) => x.field_id === fieldId && x.valid_to == null)
    return isolationReport({
      farmName: farmBrand().farmName,
      field: { name: f?.name ?? 'Field', legal: f?.legal_land_description ?? null, acres: b?.acres == null ? null : Number(b.acres) },
      year,
      years,
      distanceM: MILE_M,
      company: report.data?.company ?? null,
      notes: report.data?.notes ?? null,
      rows,
      lastSeedCanola: lastSeed,
      map: withMap ? ((await mapRef.current?.capture()) ?? null) : null,
    })
  }
  const exportAs = async (kind: 'pdf' | 'csv') => {
    setBusy(kind)
    try {
      const r = await build(kind === 'pdf')
      const name = `Canola isolation ${fieldName(fieldId)} ${year}`
      if (kind === 'pdf') downloadBlob(await tableReportToPdf(r), `${fileSafe(name)}.pdf`)
      else downloadBlob(new Blob([tableReportToCsv(r)], { type: 'text/csv' }), `${fileSafe(name)}.csv`)
    } finally {
      setBusy(null)
    }
  }

  const open = rows.find((r) => r.parcel === selected) ?? null
  const cropOptions = useMemo(() => [...new Set([...(crops ?? []).map((c) => c.name), ...COMMON])].sort((a, b) => a.localeCompare(b)), [crops])

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            Seed canola field
            <Select
              value={fieldId ?? ''}
              onChange={(v) => {
                setFieldId(v || null)
                setSelected(null)
              }}
              options={[{ value: '', label: 'Pick a field' }, ...withBoundary.map((f) => ({ value: f.id, label: f.name }))]}
              className="mt-1 w-60"
              ariaLabel="Seed canola field"
            />
          </label>
          <label className="text-xs text-gray-600">
            Crop year
            <Select
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={[cropYear + 1, cropYear, cropYear - 1, cropYear - 2].map((y) => ({ value: String(y), label: String(y) }))}
              className="mt-1 w-28"
              ariaLabel="Crop year"
            />
          </label>
          {fieldId && (
            <ReportFields
              key={`${fieldId}:${year}:${report.data?.updated_at ?? ''}`}
              company={report.data?.company ?? ''}
              notes={report.data?.notes ?? ''}
              disabled={!canEdit}
              onSave={(company, notes) => saveReport.mutate({ field_id: fieldId, crop_year: year, company, notes })}
            />
          )}
        </div>
        <HelpNote summary="A mile out from the field's edge; click a quarter to say what's on it." className="mt-2">
          <p>
            The field&apos;s current boundary is grown a mile on every side, so the line follows its shape. Every quarter section that reaches into that mile is listed, from
            the Alberta survey grid. Our own quarters fill in from the crop plans and crop history; a neighbour&apos;s quarter is filled in by clicking it. What you write is kept
            by quarter and year, so it fills in on every later report, and this year&apos;s crop is next year&apos;s history.
          </p>
        </HelpNote>
        {area.error && <p className="mt-2 text-sm text-red-600">{(area.error as Error).message}</p>}
      </section>

      {fieldId && (
        <div className={cn('grid gap-3', open && 'lg:grid-cols-[1fr_360px]')}>
          <IsolationMap ref={mapRef} field={area.data?.field ?? null} area={area.data?.area ?? null} quarters={mapQuarters} selected={selected} onSelect={setSelected} className="relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded-lg border border-gray-200" />
          {open && (
            <QuarterEditor
              key={`${open.parcel}:${year}`}
              row={open}
              years={years}
              thisYear={year}
              options={cropOptions}
              canEdit={canEdit}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}

      {fieldId && rows.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">
              {rows.length} quarters within a mile
              <span className="ml-2 text-xs font-normal text-gray-500">
                {canolaNear ? `${canolaNear} with canola in ${year}` : `no canola in ${year}`}
                {unknown ? ` · ${unknown} not known yet` : ''}
                {` · last seed canola on this field: ${lastSeed ? `${lastSeed.year}, ${lastSeed.label}` : 'none on record'}`}
              </span>
            </h2>
            {/* One button that asks which, rather than one for each format
                (Sam, 29 Oct 2026). */}
            <ExportButton label="Export the quarters within a mile" onExport={(f) => exportAs(f === 'PDF' ? 'pdf' : 'csv')} />
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="py-1 font-medium">Quarter</th>
                  <th className="py-1 font-medium">Whose</th>
                  {years.map((y) => (
                    <th key={y} className="py-1 font-medium">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.parcel} onClick={() => setSelected(r.parcel)} className={cn('cursor-pointer hover:bg-gray-50', selected === r.parcel && 'bg-brand-50')}>
                    <td className="py-1.5 pr-2 font-medium text-gray-900">{r.label}</td>
                    <td className="py-1.5 pr-2 text-xs text-gray-600">{whoseLabel(r)}</td>
                    {r.cells.map((c, k) => (
                      <td key={k} className={cn('py-1.5 pr-2', isCanolaCrop(c.crop) ? 'font-semibold text-amber-700' : c.crop ? 'text-gray-800' : 'text-gray-300')}>
                        {c.crop ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {fieldId && area.isLoading && <p className="text-sm text-gray-500">Drawing the mile…</p>}
    </div>
  )
}

function ReportFields({ company, notes, disabled, onSave }: { company: string; notes: string; disabled: boolean; onSave: (company: string, notes: string) => void }) {
  const [c, setC] = useState(company)
  const [n, setN] = useState(notes)
  const save = () => (c !== company || n !== notes) && onSave(c, n)
  return (
    <>
      <label className="text-xs text-gray-600">
        For (seed company)
        <input value={c} onChange={(e) => setC(e.target.value)} onBlur={save} disabled={disabled} className="mt-1 block w-48 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
      </label>
      <label className="min-w-[200px] flex-1 text-xs text-gray-600">
        Notes on the report
        <input value={n} onChange={(e) => setN(e.target.value)} onBlur={save} disabled={disabled} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
      </label>
    </>
  )
}

/** One quarter: what is on it this year and the four before, written by hand (ours fill in from our records). */
function QuarterEditor({ row, years, thisYear, options, canEdit, onClose }: { row: IsolationRow; years: number[]; thisYear: number; options: string[]; canEdit: boolean; onClose: () => void }) {
  const save = useSaveQuarterCrop()
  // Starts from what was written by hand; a crop filled in from our records shows as the placeholder.
  const [draft, setDraft] = useState(() => row.cells.map((c: CropCell) => ({ crop: c.source === 'label' ? (c.crop ?? '') : '', notes: c.notes ?? '' })))
  const listId = `crops-${row.parcel}`
  const changed = draft.some((d, k) => d.crop !== (row.cells[k].source === 'label' ? (row.cells[k].crop ?? '') : '') || d.notes !== (row.cells[k].notes ?? ''))
  const submit = async () => {
    for (let k = 0; k < years.length; k++) {
      const was = row.cells[k]
      const d = draft[k]
      if (d.crop === (was.source === 'label' ? (was.crop ?? '') : '') && d.notes === (was.notes ?? '')) continue
      await save.mutateAsync({ parcel: row.parcel, crop_year: years[k], crop: d.crop, notes: d.notes })
    }
  }
  return (
    <aside className="rounded-lg border border-gray-200 bg-white p-3 text-sm lg:max-h-[60vh] lg:overflow-auto">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 font-semibold text-gray-900">
          {row.label}
          <span className="block text-xs font-normal text-gray-500">{whoseLabel(row)}</span>
        </h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      {!row.isTheField && <QuarterLand parcel={row.parcel} label={row.label} owner={row.owner ?? null} canEdit={canEdit} />}
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <div className="mt-2 space-y-2">
        {years.map((y, k) => (
          <div key={y} className="grid grid-cols-[3.5rem_1fr] items-start gap-2">
            <span className="pt-1.5 text-xs font-medium text-gray-600">{y === thisYear ? `${y} now` : y}</span>
            <div className="space-y-1">
              <input
                list={listId}
                value={draft[k].crop}
                onChange={(e) => setDraft((d) => d.map((x, i) => (i === k ? { ...x, crop: e.target.value } : x)))}
                placeholder={row.cells[k].source === 'ours' ? `${row.cells[k].crop} (our records)` : row.cells[k].source === 'pasture' ? 'Pasture' : 'What was planted'}
                disabled={!canEdit}
                aria-label={`${y} crop`}
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
              />
              <input
                value={draft[k].notes}
                onChange={(e) => setDraft((d) => d.map((x, i) => (i === k ? { ...x, notes: e.target.value } : x)))}
                placeholder="Note (whose, what kind)"
                disabled={!canEdit}
                aria-label={`${y} note`}
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
              />
            </div>
          </div>
        ))}
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={submit}
          disabled={!changed || save.isPending}
          className="mt-3 w-full rounded-md bg-brand-700 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      ) : (
        <p className="mt-2 text-xs text-gray-500">Managers fill these in.</p>
      )}
      {save.isError && <p className="mt-1 text-xs text-red-600">{(save.error as Error).message}</p>}
    </aside>
  )
}

const OWNER_FIELDS: EditField[] = [
  {
    key: 'kind',
    label: 'Land',
    kind: 'select',
    required: true,
    options: [
      { value: '', label: 'Pick one' },
      { value: 'neighbour', label: 'Neighbour’s land' },
      { value: 'pasture', label: 'Pasture' },
    ],
  },
  { key: 'owner_name', label: 'Owner', kind: 'text', hint: 'Needed for a neighbour’s land' },
  { key: 'phone', label: 'Phone', kind: 'text' },
  { key: 'email', label: 'Email', kind: 'text' },
  { key: 'notes', label: 'Notes (not on the report)', kind: 'textarea' },
]

const NEW_OWNER = '__new'

/** Whose a quarter is, kept from year to year: pasture, or a neighbour's land with the owner and contact. */
function QuarterLand({ parcel, label, owner, canEdit }: { parcel: string; label: string; owner: QuarterOwner | null; canEdit: boolean }) {
  const save = useSaveQuarterOwner()
  const del = useDeleteQuarterOwner()
  const { data: known } = useKnownOwners()
  const [editing, setEditing] = useState(false)
  // Pick a neighbour already written on another quarter, or add a new landowner.
  const [from, setFrom] = useState('')
  const start = known?.find((k) => k.owner_name === from)
  const others = (known ?? []).filter((k) => k.owner_name !== owner?.owner_name)
  const lines: [string, ReactNode][] = owner
    ? [
        ['Owner', owner.owner_name],
        ['Phone', owner.phone ? <a href={`tel:${owner.phone.replace(/[^\d+]/g, '')}`} className="text-brand-700 hover:underline">{owner.phone}</a> : null],
        ['Email', owner.email ? <a href={`mailto:${owner.email}`} className="text-brand-700 hover:underline">{owner.email}</a> : null],
        ['Notes', owner.notes],
      ]
    : []

  return (
    <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 p-2">
      {owner ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-700">{owner.kind === 'pasture' ? 'Pasture' : 'Neighbour’s land'}</span>
            {canEdit && <EditButton onClick={() => setEditing(true)} />}
          </div>
          <DetailList rows={lines} className="mt-1 text-xs" />
        </>
      ) : canEdit ? (
        <AddButton label="Pasture or neighbour" onClick={() => setEditing(true)} />
      ) : (
        <p className="text-xs text-gray-400">Owner not recorded.</p>
      )}
      {editing && (
        <RecordEditModal
          key={from}
          title={`${label}: whose land`}
          fields={OWNER_FIELDS}
          row={
            start
              ? { kind: 'neighbour', owner_name: start.owner_name, phone: start.phone, email: start.email, notes: owner?.notes ?? null }
              : from === NEW_OWNER
                ? { kind: 'neighbour', notes: owner?.notes ?? null }
                : (owner ?? { kind: 'neighbour' })
          }
          before={
            (others.length > 0 || owner?.owner_name) && (
              <label className="mt-3 block text-sm">
                <span className="mb-0.5 block text-xs text-gray-500">Neighbour</span>
                <Select
                  value={from}
                  size="sm"
                  ariaLabel="Neighbour"
                  className="w-full"
                  onChange={setFrom}
                  options={[
                    ...(owner?.owner_name ? [{ value: '', label: `${owner.owner_name} (as saved)` }, { value: NEW_OWNER, label: '+ Add new landowner' }] : [{ value: '', label: '+ Add new landowner' }]),
                    ...others.map((k) => ({ value: k.owner_name, label: k.phone ? `${k.owner_name} · ${k.phone}` : k.owner_name })),
                  ]}
                />
              </label>
            )
          }
          onClose={() => {
            setEditing(false)
            setFrom('')
          }}
          onSave={(p) =>
            save.mutateAsync({
              parcel,
              kind: p.kind as QuarterOwner['kind'],
              owner_name: (p.owner_name as string | null) ?? null,
              phone: (p.phone as string | null) ?? null,
              email: (p.email as string | null) ?? null,
              notes: (p.notes as string | null) ?? null,
            })
          }
          onDelete={owner ? () => del.mutateAsync(parcel) : undefined}
          deleteConfirm={`Clear whose land ${label} is? The crops written on it stay.`}
        />
      )}
    </div>
  )
}
