import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Sparkles } from 'lucide-react'
import { Card } from '@/components/Card'
import { HelpNote } from '@/components/HelpNote'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  SCLEROTINIA_QUESTIONS,
  SCLEROTINIA_SOURCE,
  SECTION_RULES,
  scoreSections,
  sprayWindow,
  verdict,
  type Answers,
} from '@/lib/sclerotinia'
import { useChecklistHints, useSaveChecklist, useSclerotiniaChecklists } from '@/lib/sclerotinia-data'
import type { FarmBloomRow } from '@/lib/canola-bloom-data'
import { cn } from '@/lib/utils'

/**
 * Canola bloom → Sclerotinia: Alberta's checklist, per field.
 *
 * It lives here because that is when it has to be filled in. The sheet is
 * completed shortly after first flower and the fungicide goes on four to eight
 * days later, so the page that knows which fields have started flowering is the
 * page that should be asking.
 */

const day = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

const CALL_STYLE = {
  spray: 'bg-amber-100 text-amber-900',
  hold: 'bg-gray-100 text-gray-700',
  incomplete: 'bg-blue-50 text-blue-800',
} as const

export function SclerotiniaTab({ rows }: { rows: FarmBloomRow[] }) {
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const year = rows.length ? Math.max(...rows.map((r) => r.crop_year)) : new Date().getFullYear()
  const fields = useMemo(
    () => rows.filter((r) => r.crop_year === year).sort((a, b) => a.fieldName.localeCompare(b.fieldName)),
    [rows, year],
  )
  const { data: saved } = useSclerotiniaChecklists(year)
  const { data: hints } = useChecklistHints(year)
  const [open, setOpen] = useState<string | null>(null)

  if (!fields.length) return <p className="text-sm text-gray-500">No canola in the crop plan yet.</p>

  return (
    <div className="space-y-3">
      <Card title={`Sclerotinia checklist · ${year}`} icon={ClipboardCheck}>
        <div className="divide-y divide-gray-100">
          {fields.map((f) => {
            const row = saved?.get(f.field_id)
            const answers = (row?.answers ?? {}) as Answers
            const scores = scoreSections(answers)
            const v = verdict(scores)
            const first = f.started_on ?? f.forecast_start_on
            const win = first ? sprayWindow(first) : null
            return (
              <div key={f.field_id} className="py-2">
                <button
                  onClick={() => setOpen(open === f.field_id ? null : f.field_id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
                >
                  <span className="font-medium text-gray-900">{f.fieldName}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', CALL_STYLE[v.call])}>
                    {v.call === 'spray' ? 'Sheet says spray' : v.call === 'hold' ? 'Sheet says hold' : 'Not finished'}
                  </span>
                  <span className="text-xs tabular-nums text-gray-500">
                    {scores.map((s) => `${s.points}/${s.max}`).join(' · ')}
                  </span>
                  {win && (
                    <span className="text-xs text-gray-500">
                      first flower {f.started_on ? day(f.started_on) : `~${day(f.forecast_start_on)}`} · spray{' '}
                      {day(win.opensOn)}–{day(win.closesOn)}
                    </span>
                  )}
                </button>
                {open === f.field_id && (
                  <Checklist
                    fieldId={f.field_id}
                    year={year}
                    saved={answers}
                    savedNotes={row?.notes ?? ''}
                    hints={hints?.get(f.field_id)?.hints ?? {}}
                    canEdit={canEdit}
                  />
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <HelpNote
        summary="Alberta's own checklist, scored the way the sheet scores it."
        title="Where this checklist comes from and what it can tell you"
      >
        Agdex {SCLEROTINIA_SOURCE.agdex}, {SCLEROTINIA_SOURCE.paper} ({SCLEROTINIA_SOURCE.revised}),
        which came out of fungicide trials in 1981 and 1982. Fifteen questions in three sections.
        Section one asks whether the farm has had the disease and wants 60 or more; section two
        whether this year&rsquo;s weather suits it and wants more than 50; section three whether
        there is a crop worth protecting and wants 50 or more. The sheet says a fungicide is worth
        applying when all three clear, and that is the only thing marked &ldquo;spray&rdquo; here.
        <br />
        <br />
        The sheet warns about itself: it is <i>not always reliable</i>, because sudden weather can
        bring an infection on unexpectedly and a high-risk field can show little disease. It is a
        practical direction, not a probability, which is why there is no percentage on this screen.
        <br />
        <br />
        Timing is the reason it lives on this page. Fill it in shortly after first flower — 75 per
        cent of plants with three open flowers on the main stem. The fungicide goes on at 20 to 30
        per cent bloom, which is four to eight days later, and covers the crop for at least nine
        days. Book an applicator before you need one.
        <br />
        <br />
        Where the app already knows something it offers it with a ✨ and waits to be clicked —
        scouting records for sclerotinia and apothecia, and the yield history for question 15. The
        weather questions are left alone on purpose: &ldquo;wet enough for the soil to stay moist
        for extended periods&rdquo; is not a rainfall total, and the nearest station is not the
        field.
        <br />
        <br />
        <Link
          to={`/research?tab=search&q=${encodeURIComponent(SCLEROTINIA_SOURCE.paper)}`}
          className="font-medium underline"
        >
          Open the sheet in the research library
        </Link>
      </HelpNote>
    </div>
  )
}

function Checklist({
  fieldId,
  year,
  saved,
  savedNotes,
  hints,
  canEdit,
}: {
  fieldId: string
  year: number
  saved: Answers
  savedNotes: string
  hints: Record<string, { points: number; why: string }>
  canEdit: boolean
}) {
  const [answers, setAnswers] = useState<Answers>(saved)
  const [notes, setNotes] = useState(savedNotes)
  const save = useSaveChecklist(year)
  const scores = scoreSections(answers)
  const v = verdict(scores)
  const dirty =
    JSON.stringify(answers) !== JSON.stringify(saved) || notes !== savedNotes

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      {([1, 2, 3] as const).map((section) => {
        const s = scores[section - 1]
        const rule = SECTION_RULES[section]
        return (
          <div key={section} className="rounded-lg border border-gray-200 bg-white p-2.5">
            <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Section {section}
              <span className="font-normal normal-case tracking-normal text-gray-500">
                {rule.meaning} — wants {rule.inclusive ? `${rule.threshold} or more` : `over ${rule.threshold}`}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal',
                  s.clears == null ? 'bg-blue-50 text-blue-800'
                  : s.clears ? 'bg-amber-100 text-amber-900'
                  : 'bg-gray-100 text-gray-700',
                )}
              >
                {s.points} of {s.max}
                {s.clears == null ? ` · ${s.questions - s.answered} left` : s.clears ? ' · clears' : ' · under'}
              </span>
            </p>
            <div className="space-y-2">
              {SCLEROTINIA_QUESTIONS.filter((q) => q.section === section).map((q) => {
                const hint = hints[String(q.n)]
                return (
                  <div key={q.n} className="text-xs">
                    <p className="text-gray-700">
                      <b className="text-gray-500">{q.n}.</b> {q.question}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {q.options.map((o) => {
                        const chosen = answers[String(q.n)] === o.points
                        const suggested = hint?.points === o.points
                        return (
                          <button
                            key={o.label}
                            disabled={!canEdit}
                            onClick={() => setAnswers({ ...answers, [String(q.n)]: o.points })}
                            title={suggested ? hint.why : undefined}
                            className={cn(
                              'rounded-md border px-2 py-1 text-[11px] font-medium',
                              chosen
                                ? 'border-brand-600 bg-brand-50 text-brand-800'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                              !canEdit && 'cursor-default opacity-70',
                            )}
                          >
                            {suggested && <Sparkles className="mr-1 inline h-3 w-3 text-amber-600" />}
                            {o.label} <span className="text-gray-400">{o.points}</span>
                          </button>
                        )
                      })}
                    </div>
                    {hint && (
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        The records suggest {hint.points} — {hint.why}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className={cn('rounded-lg px-3 py-2 text-sm', CALL_STYLE[v.call])}>{v.why}</div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What the field looked like"
            className="min-w-48 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ fieldId, answers, notes: notes.trim() || null })}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          {save.isError && <span className="text-xs text-red-700">Did not save — try again.</span>}
        </div>
      )}
    </div>
  )
}
