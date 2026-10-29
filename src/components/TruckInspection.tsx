import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, ClipboardCheck, Download, PenLine, Play, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/Modal'
import { DateField } from '@/components/DateField'
import { Select } from '@/components/Select'
import { useAuth } from '@/lib/auth'
import { useMySignature } from '@/lib/signature'
import { localDateKey } from '@/lib/ranchWeather'
import { longDate } from '@/lib/reports/framework'
import { downloadBlob, tableReportToPdf } from '@/lib/table-report'
import { inspectionReport } from '@/lib/reports/truck-inspection-report'
import { INSPECTION_SECTIONS, allAnswered, isDue, progress, toFix, type Answer, type Answers } from '@/lib/truck-inspection'
import {
  useDeleteInspection,
  useMoveInspection,
  useSaveInspection,
  useSignInspection,
  useStartInspection,
  type Inspection,
  type SemiTruck,
  type Truckish,
  vehicleOptions,
} from '@/lib/truck-inspection-data'
import { cn } from '@/lib/utils'
import { CARD_HEAD } from '@/lib/table-style'

/*
 * The yearly truck inspection form (Sam, 21 Oct 2026), shared by the two
 * ways in since 24 Oct 2026: a truck's Inspections tab on Equipment service,
 * and the Truck inspection checklist, where the truck is picked on the form.
 * Both read and write the same truck_inspections rows, so they cannot drift.
 */

const primary = 'flex items-center justify-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40'
const secondary = 'flex items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40'

/** The inspection's report as a PDF, with the signer's signature drawn on it. */
async function downloadReport(i: Inspection, truck: { name: string; make: string | null; model: string | null }) {
  let signature: { dataUrl: string; width: number; height: number } | null = null
  if (i.signature) {
    const bmp = await createImageBitmap(await (await fetch(i.signature)).blob())
    signature = { dataUrl: i.signature, width: bmp.width, height: bmp.height }
  }
  const r = inspectionReport(i, truck, signature)
  downloadBlob(await tableReportToPdf(r), `${r.filename.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`)
}

/**
 * One truck's inspections: done this year or due, the one in progress to
 * continue or a new one to start, and the signed ones to open or download.
 */
export function TruckInspectionHistory({
  truck,
  inspections,
  onOpen,
}: {
  truck: { id: string; name: string; make: string | null; model: string | null }
  inspections: Inspection[]
  onOpen: (id: string) => void
}) {
  const start = useStartInspection()
  const year = Number(localDateKey().slice(0, 4))
  const signed = inspections.filter((i) => i.signed_on).sort((a, b) => (b.signed_on ?? '').localeCompare(a.signed_on ?? ''))
  const inProgress = inspections.find((i) => !i.signed_at) ?? null
  const due = isDue(signed[0]?.signed_on, year)
  const p = inProgress ? progress(inProgress.answers) : null
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">Yearly inspection</p>
          <p className={cn('text-xs', due ? 'font-medium text-amber-700' : 'text-green-700')}>
            {due ? `Due: not inspected in ${year}` : `Inspected ${longDate(signed[0].signed_on)}${signed[0].signer_name ? ` by ${signed[0].signer_name}` : ''}`}
          </p>
        </div>
        {inProgress ? (
          <button type="button" onClick={() => onOpen(inProgress.id)} className={primary}>
            <Play className="h-4 w-4" /> Continue ({p!.done} of {p!.total})
          </button>
        ) : (
          <button type="button" disabled={start.isPending} onClick={() => start.mutate(truck.id, { onSuccess: (row) => onOpen(row.id) })} className={due ? primary : secondary}>
            <ClipboardCheck className="h-4 w-4" /> {start.isPending ? 'Starting…' : 'Start inspection'}
          </button>
        )}
      </div>
      {start.error && <p className="mt-1 text-xs text-red-700">{(start.error as Error).message}</p>}
      {signed.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-700">
          {signed.map((i) => {
            const fix = toFix(i.answers, i.notes).length
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => onOpen(i.id)} className="text-left hover:text-brand-800">
                  {longDate(i.signed_on)} · {i.signer_name ?? 'signed'} · {fix ? `${fix} to fix` : 'nothing to fix'}
                </button>
                <button
                  type="button"
                  disabled={busy === i.id}
                  onClick={() => {
                    setBusy(i.id)
                    void downloadReport(i, truck).finally(() => setBusy(null))
                  }}
                  className="flex items-center gap-1 text-brand-700 hover:underline disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" /> {busy === i.id ? 'Making…' : 'Report (PDF)'}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500">No inspections signed off yet.</p>
      )}
    </div>
  )
}

const ANSWERS: { value: Answer; label: string; on: string }[] = [
  { value: 'ok', label: 'OK', on: 'border-green-600 bg-green-600 text-white' },
  { value: 'fix', label: 'Needs work', on: 'border-red-600 bg-red-600 text-white' },
  { value: 'na', label: 'N/A', on: 'border-gray-500 bg-gray-500 text-white' },
]

/**
 * One inspection, a section at a time. Every answer and note is saved a moment
 * after it is made, so the phone can be put away and the inspection finished
 * later. Signed off, it is read-only.
 */
export function InspectionView({
  inspection,
  truck,
  onBack,
  backLabel,
  vehicles,
  onMoved,
}: {
  inspection: Inspection
  truck: Truckish | null
  onBack: () => void
  backLabel: string
  /**
   * The trucks and trailers to pick from, on the Checklists form (Sam,
   * 24 Oct 2026: "select the truck from a drop down selector on the form").
   * Left out on a truck's own page, where the truck is the page.
   */
  vehicles?: SemiTruck[]
  onMoved?: (equipmentId: string) => void
}) {
  const { profile } = useAuth()
  const move = useMoveInspection()
  const mySig = useMySignature()
  const save = useSaveInspection()
  const sign = useSignInspection()
  const del = useDeleteInspection()
  const signed = !!inspection.signed_at
  const [answers, setAnswers] = useState<Answers>(inspection.answers)
  const [notes, setNotes] = useState<Partial<Record<string, string>>>(inspection.notes)
  // Open on the first section with an item left, or the sign-off when none is.
  const firstOpen = INSPECTION_SECTIONS.findIndex((s) => s.items.some((i) => !inspection.answers[i.key]))
  const [at, setAt] = useState(signed ? INSPECTION_SECTIONS.length : firstOpen < 0 ? INSPECTION_SECTIONS.length : firstOpen)
  const [signedOn, setSignedOn] = useState(localDateKey())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  // Saved a moment after the last change, and when leaving.
  // The effect below re-arms on every change, so its flush sees the latest.
  const [dirty, setDirty] = useState(false)
  const flush = () => {
    if (signed) return
    setDirty(false)
    save.mutate({ id: inspection.id, answers, notes })
  }
  useEffect(() => {
    if (!dirty || signed) return
    const t = window.setTimeout(flush, 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, answers, notes])

  const answer = (key: string, v: Answer) => {
    if (signed) return
    setAnswers((a) => ({ ...a, [key]: v }))
    setDirty(true)
  }
  const note = (key: string, v: string) => {
    if (signed) return
    setNotes((n) => ({ ...n, [key]: v }))
    setDirty(true)
  }
  const go = (n: number) => {
    if (dirty) flush()
    setAt(n)
    window.scrollTo({ top: 0 })
  }

  const p = progress(answers)
  const fix = toFix(answers, notes)
  const section = INSPECTION_SECTIONS[at] ?? null
  const status = signed ? null : save.isPending ? 'Saving…' : dirty ? 'Not saved yet' : save.isError ? 'Not saved' : 'Saved'

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            if (dirty) flush()
            onBack()
          }}
          className="flex items-center gap-1 text-sm text-brand-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </button>
        <span className={cn('text-xs', save.isError ? 'text-red-700' : 'text-gray-500')}>{status}</span>
      </div>
      <div>
        {vehicles && !signed ? (
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900">Inspection of</h1>
            <Select
              value={inspection.equipment_id}
              ariaLabel="Truck or trailer"
              className="w-56"
              disabled={move.isPending}
              onChange={(id) => {
                if (id === inspection.equipment_id) return
                if (dirty) flush()
                move.mutate({ id: inspection.id, equipmentId: id }, { onSuccess: () => onMoved?.(id) })
              }}
              options={vehicleOptions(vehicles, truck)}
            />
          </div>
        ) : (
          <h1 className="text-lg font-semibold text-gray-900">{truck?.name ?? 'Truck'} inspection</h1>
        )}
        {move.error && <p className="text-xs text-red-700">{(move.error as Error).message}</p>}
        <p className="text-xs text-gray-500">
          {signed ? `Signed off ${longDate(inspection.signed_on)} by ${inspection.signer_name ?? 'the inspector'}` : `Started ${longDate(inspection.started_at.slice(0, 10))}`} · {p.done} of {p.total}{' '}
          checked{fix.length ? ` · ${fix.length} need work` : ''}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-brand-600" style={{ width: `${(p.done / p.total) * 100}%` }} />
        </div>
      </div>
      {save.isError && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}

      {/* The sections, to jump between; a tick when every item is answered. */}
      <div className="flex gap-1 overflow-x-auto pb-1 text-[11px]">
        {INSPECTION_SECTIONS.map((s, n) => {
          const left = s.items.filter((i) => !answers[i.key]).length
          const bad = s.items.some((i) => answers[i.key] === 'fix')
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => go(n)}
              className={cn(
                'shrink-0 rounded-md border px-2 py-1',
                n === at ? 'border-brand-700 bg-brand-700 text-white' : left ? 'border-gray-200 bg-white text-gray-600' : bad ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800',
              )}
            >
              {!left && <Check className="mr-0.5 inline h-3 w-3" />}
              {s.title}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => go(INSPECTION_SECTIONS.length)}
          className={cn('shrink-0 rounded-md border px-2 py-1', at === INSPECTION_SECTIONS.length ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-200 bg-white text-gray-600')}
        >
          {signed ? 'Signed off' : 'Sign off'}
        </button>
      </div>

      {section ? (
        <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-900">{section.title}</h2>
            {!signed && section.items.some((i) => !answers[i.key]) && (
              <button
                type="button"
                onClick={() => {
                  setAnswers((a) => ({ ...a, ...Object.fromEntries(section.items.filter((i) => !a[i.key]).map((i) => [i.key, 'ok'])) }))
                  setDirty(true)
                }}
                className="text-xs text-brand-700 underline decoration-dotted"
              >
                Mark the rest OK
              </button>
            )}
          </div>
          {section.hint && <p className="text-xs text-gray-500">{section.hint}</p>}
          <ul className="divide-y divide-gray-100">
            {section.items.map((it) => (
              <li key={it.key} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-gray-800">{it.text}</span>
                <span className="flex shrink-0 gap-1">
                  {ANSWERS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      disabled={signed}
                      onClick={() => answer(it.key, a.value)}
                      className={cn(
                        'min-w-[3.5rem] rounded-md border px-2.5 py-1.5 text-xs font-medium',
                        answers[it.key] === a.value ? a.on : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                        signed && answers[it.key] !== a.value && 'opacity-40',
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <label className="block text-xs text-gray-500">
            Notes for this section
            <textarea
              value={notes[section.key] ?? ''}
              onChange={(e) => note(section.key, e.target.value)}
              readOnly={signed}
              rows={2}
              placeholder={signed ? '' : 'What you found, what to fix, parts needed…'}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {at > 0 && (
              <button type="button" onClick={() => go(at - 1)} className={secondary}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}
            <button type="button" onClick={() => go(at + 1)} className={cn(primary, 'flex-1 sm:flex-none')}>
              Next: {INSPECTION_SECTIONS[at + 1]?.title ?? (signed ? 'Signed off' : 'Sign off')} <ArrowRight className="h-4 w-4" />
            </button>
            {!signed && (
              <button
                type="button"
                onClick={() => {
                  if (dirty) flush()
                  onBack()
                }}
                className="px-1 text-xs text-gray-500 underline"
              >
                Save and finish later
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="overflow-hidden space-y-3 rounded-lg border border-gray-200 bg-white">
          <h2 className={cn('font-medium', CARD_HEAD)}>What needs to be done</h2>
          <div className="p-3">
          {fix.length ? (
            <ul className="space-y-1 text-sm">
              {fix.map((f, n) => (
                <li key={n} className="flex gap-2">
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-gray-400" />
                  <span>
                    {f.text} <span className="text-xs text-gray-500">({f.section})</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">Nothing marked Needs work{allAnswered(answers) ? '.' : ' so far.'}</p>
          )}

          {signed ? (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              {inspection.signature && <img src={inspection.signature} alt="Signature" className="h-14 max-w-[16rem] rounded border border-gray-200 bg-white object-contain p-1" />}
              <p className="text-sm text-gray-700">
                Signed off by {inspection.signer_name ?? 'the inspector'} on {longDate(inspection.signed_on)}.
              </p>
            </div>
          ) : !allAnswered(answers) ? (
            <p className="border-t border-gray-100 pt-3 text-sm text-amber-800">
              {p.total - p.done} item{p.total - p.done === 1 ? '' : 's'} still to answer before it can be signed off.
            </p>
          ) : mySig.data?.image ? (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <img src={mySig.data.image} alt="Your signature" className="h-14 max-w-[16rem] rounded border border-gray-200 bg-white object-contain p-1" />
              <label className="block max-w-[12rem] text-xs text-gray-500">
                Date of the inspection
                <DateField value={signedOn} onChange={setSignedOn} className="mt-1 rounded-md bg-white" />
              </label>
              <button
                type="button"
                disabled={sign.isPending || !signedOn || !profile}
                onClick={() => {
                  // The sign-off carries the answers; no save may follow it.
                  setDirty(false)
                  sign.mutate({
                    id: inspection.id,
                    userId: profile!.id,
                    name: profile!.full_name ?? null,
                    signature: mySig.data!.image,
                    signedOn,
                    answers,
                    notes,
                  })
                }}
                className={primary}
              >
                <PenLine className="h-4 w-4" /> {sign.isPending ? 'Signing…' : `Sign off as ${profile?.full_name ?? 'me'}`}
              </button>
              {sign.error && <p className="text-xs text-red-700">{(sign.error as Error).message}</p>}
            </div>
          ) : (
            <p className="border-t border-gray-100 pt-3 text-sm text-gray-700">
              <Link to="/settings/account?tab=profile" className="font-medium text-brand-700 hover:underline">
                Add your signature
              </Link>{' '}
              on My account to sign this off. Your answers are saved.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={() => go(INSPECTION_SECTIONS.length - 1)} className={secondary}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {truck && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void downloadReport({ ...inspection, answers, notes }, truck).finally(() => setBusy(false))
                }}
                className={secondary}
              >
                <Download className="h-4 w-4" /> {busy ? 'Making…' : signed ? 'Report (PDF)' : 'Draft report (PDF)'}
              </button>
            )}
            {!signed && (
              <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-red-700">
                <Trash2 className="h-3.5 w-3.5" /> Throw away
              </button>
            )}
          </div>

          </div>
        </section>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Throw away this inspection?"
          message="Its answers and notes are deleted. A new one can be started any time."
          confirmLabel="Throw away"
          busy={del.isPending}
          error={del.error ? (del.error as Error).message : null}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => del.mutate(inspection.id, { onSuccess: onBack })}
        />
      )}
    </>
  )
}
