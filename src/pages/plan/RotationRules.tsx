import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HelpNote } from '@/components/HelpNote'
import { CropsGrownPanel } from '@/components/CropsGrownPanel'
import { RecropOverrides } from '@/components/RecropOverrides'
import { supabase } from '@/lib/supabase'
import { useCrops } from '@/lib/queries'
import {
  buildSuccessionMap,
  buildSuccessionNotes,
  useSetCropReturnYears,
  useSetCropRotationSettings,
  useSuccessionMutations,
  useSuccessionRules,
  type CropInfo,
  type Preference,
} from '@/lib/rotation'
import { cn } from '@/lib/utils'
import { usePartnerCrops } from '@/lib/partner-view'
import { TABLE_HEAD, TABLE_TH } from '@/lib/table-style'

/**
 * Its own tab since 28 Oct 2026 (Sam): the rules were a drawer that pushed the
 * grid down the page, and they are read once a winter while the grid is read
 * weekly. It fetches its own crops and rules rather than taking them from the
 * planner, so the tab loads on its own.
 */
export function RotationRulesTab({ isManager }: { isManager: boolean }) {
  const { data: crops } = useCrops()
  const { data: rules } = useSuccessionRules()
  const active = useMemo<CropInfo[]>(
    () =>
      (crops ?? [])
        .filter((c) => c.active)
        .map((c) => ({
          id: c.id,
          name: c.name,
          min_return_years: c.min_return_years,
          max_in_a_row: c.max_in_a_row ?? 1,
          stand_max_years: c.stand_max_years ?? null,
          color: c.color,
        })),
    [crops],
  )
  const succession = useMemo(() => buildSuccessionMap(rules ?? []), [rules])
  const notes = useMemo(() => buildSuccessionNotes(rules ?? []), [rules])
  return <RotationRules isManager={isManager} crops={active} succession={succession} notes={notes} />
}

/** Rotation-rule settings: per-crop return interval + the crop-after-crop matrix. */
function RotationRules({
  isManager,
  crops,
  succession,
  notes,
}: {
  isManager: boolean
  crops: CropInfo[]
  succession: ReturnType<typeof buildSuccessionMap>
  notes: ReturnType<typeof buildSuccessionNotes>
}) {
  const setReturn = useSetCropReturnYears()
  const setSettings = useSetCropRotationSettings()
  const { data: allCrops } = useCrops()
  const { setPreference } = useSuccessionMutations()
  // A crop-share partner changes the rules of the crops he grows, and the
  // pairs that involve one; the rest he reads (lib/partner-view.ts).
  const partnerCrops = usePartnerCrops()
  const canRule = (...ids: string[]) => isManager || ids.some((id) => partnerCrops?.has(id))
  const [reading, setReading] = useState<string | null>(null)
  const qc = useQueryClient()
  const poll = useRef<number | null>(null)
  useEffect(() => () => void (poll.current != null && window.clearInterval(poll.current)), [])
  /*
   * Tick = it may follow (Sam, 29 Oct 2026: "just simple checkboxes for
   * each section... get rid of all the colours and we have it more condensed
   * and sleek"). The box carries the one thing that matters on a plan — can
   * this follow that — and the mark beside it carries the farm's rating,
   * which the recommendations still read: blank, ★ recommended, ! with care.
   */
  const MARK_CYCLE: (Preference | null)[] = [null, 'recommended', 'caution']
  const MARK: Record<string, string> = { recommended: '★', possible: '', caution: '!' }
  const readLabels = async () => {
    setReading('Starting…')
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const res = await fetch('/.netlify/functions/recrop-extract-background', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    const started = res.ok || res.status === 202
    setReading(started ? 'Reading every label in the background — about 15 minutes; red cells appear as rules come in.' : `Could not start (${res.status})`)
    if (!started) return
    // The rotation data is cached (offline too), so pull the new rules in as
    // they land rather than whenever the cache next goes stale.
    let ticks = 0
    if (poll.current != null) window.clearInterval(poll.current)
    poll.current = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
      void qc.invalidateQueries({ queryKey: ['chemical_recrop_rules'] })
      if (++ticks >= 30 && poll.current != null) window.clearInterval(poll.current)
    }, 60_000)
  }

  return (
    <div className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Return, repeats and stands</h3>
        <HelpNote className="mb-2 text-xs" summary="Return, In a row and Stand, in years." title="What the columns mean">
          <b>Return</b>: years before the same crop comes back after it leaves (all beans count as one crop, canola with seed canola). <b>In a row</b>: years it may
          run back to back (1 = never twice). <b>Stand</b>: a perennial kept in at least the first number of years and taken out after the second.
        </HelpNote>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[480px] text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className={TABLE_TH}>Crop</th>
                <th className={cn(TABLE_TH, 'text-right')}>Return (yrs)</th>
                <th className={cn(TABLE_TH, 'text-right')}>In a row</th>
                <th className={cn(TABLE_TH, 'text-right')}>Stand min</th>
                <th className={cn(TABLE_TH, 'text-right')}>Stand max</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {crops.map((c) => {
                const full = allCrops?.find((x) => x.id === c.id)
                const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))))
                const box = 'w-14 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums'
                return (
                  <tr key={c.id}>
                    <td className="px-3 py-1 text-gray-800">{c.name}</td>
                    <td className="px-3 py-1 text-right">
                      <input
                        type="number"
                        min={0}
                        max={12}
                        disabled={!canRule(c.id)}
                        defaultValue={c.min_return_years}
                        onBlur={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value)))
                          if (v !== c.min_return_years) setReturn.mutate({ id: c.id, min_return_years: v })
                        }}
                        className={box}
                      />
                    </td>
                    <td className="px-3 py-1 text-right">
                      <input
                        type="number"
                        min={1}
                        max={6}
                        disabled={!canRule(c.id)}
                        defaultValue={full?.max_in_a_row ?? 1}
                        onBlur={(e) => {
                          const v = Math.min(6, Math.max(1, Math.round(Number(e.target.value) || 1)))
                          if (v !== (full?.max_in_a_row ?? 1)) setSettings.mutate({ id: c.id, max_in_a_row: v })
                        }}
                        className={box}
                      />
                    </td>
                    <td className="px-3 py-1 text-right">
                      <input
                        type="number"
                        min={1}
                        max={10}
                        placeholder="—"
                        disabled={!canRule(c.id)}
                        defaultValue={full?.stand_min_years ?? ''}
                        onBlur={(e) => {
                          const v = num(e.target.value)
                          if (v !== (full?.stand_min_years ?? null)) setSettings.mutate({ id: c.id, stand_min_years: v || null })
                        }}
                        className={box}
                      />
                    </td>
                    <td className="px-3 py-1 text-right">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        placeholder="—"
                        disabled={!canRule(c.id)}
                        defaultValue={full?.stand_max_years ?? ''}
                        onBlur={(e) => {
                          const v = num(e.target.value)
                          if (v !== (full?.stand_max_years ?? null)) setSettings.mutate({ id: c.id, stand_max_years: v || null })
                        }}
                        className={box}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900">Which crop can follow which</h3>
        <HelpNote className="mb-2 text-xs" summary="Ticked = it may follow." title="Reading the grid">
          Rows are last year&apos;s crop, columns the crop planted after it. A tick means it may follow; clear the tick and the
          planner treats that pairing as never. The mark beside a tick is how the farm rates it — <b>★</b> recommended,{' '}
          <b>!</b> with care — and clicking the mark cycles it. Hover a cell for the reason and whether it came from your
          rotation sheet or the research report.
        </HelpNote>
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="text-xs">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="sticky left-0 z-10 bg-brand-700 px-2 py-1 text-left font-medium">
                  prev ↓ / next →
                </th>
                {crops.map((c) => (
                  <th key={c.id} className="px-1 py-1 font-medium">
                    <span className="block max-w-[3.5rem] truncate" title={c.name}>
                      {c.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crops.map((prev) => (
                <tr key={prev.id} className="border-t border-gray-100">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-gray-700">
                    <span className="block max-w-[8rem] truncate" title={prev.name}>
                      {prev.name}
                    </span>
                  </th>
                  {crops.map((next) => {
                    const p = succession.get(prev.id)?.get(next.id) ?? null
                    const n = notes.get(`${prev.id}>${next.id}`)
                    const title = p
                      ? `${prev.name} → ${next.name}: ${p.replace('_', ' ')}${n?.notes ? ` — ${n.notes}` : ''} [${n?.source === 'research' ? 'research report' : n?.source === 'suggested' ? 'suggested by Claude — click to change' : 'your rotation sheet'}]`
                      : `${prev.name} → ${next.name}: no rule`
                    return (
                      <td key={next.id} className="px-0.5 py-0 text-center">
                        <span
                          title={title}
                          className={cn(
                            'inline-flex items-center justify-center gap-0.5 rounded px-0.5',
                            n?.source === 'research' && 'underline decoration-dotted',
                            n?.source === 'suggested' && 'outline outline-1 outline-dashed outline-gray-300',
                          )}
                        >
                          <input
                            type="checkbox"
                            disabled={!canRule(prev.id, next.id)}
                            checked={p !== 'no_go'}
                            aria-label={`${next.name} may follow ${prev.name}`}
                            onChange={(e) =>
                              setPreference.mutate({
                                prev: prev.id,
                                next: next.id,
                                // Unticking is the only thing that says never;
                                // ticking clears the rule, which means allowed.
                                preference: e.target.checked ? null : 'no_go',
                              })
                            }
                            className="h-3.5 w-3.5 cursor-pointer accent-gray-700 disabled:cursor-default disabled:opacity-40"
                          />
                          <button
                            type="button"
                            disabled={!canRule(prev.id, next.id) || p === 'no_go'}
                            title={`How the farm rates ${next.name} after ${prev.name}`}
                            aria-label={`Rate ${next.name} after ${prev.name}`}
                            onClick={() => {
                              const i = MARK_CYCLE.indexOf(p === 'possible' ? null : p)
                              setPreference.mutate({
                                prev: prev.id,
                                next: next.id,
                                preference: MARK_CYCLE[(i + 1) % MARK_CYCLE.length] as
                                  | 'recommended'
                                  | 'caution'
                                  | null,
                              })
                            }}
                            className="w-2 text-[10px] leading-none text-gray-500 hover:text-gray-900 disabled:opacity-0"
                          >
                            {p && p !== 'no_go' ? MARK[p] : ''}
                          </button>
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <HelpNote className="mt-1" summary="Dotted = research report; dashed = a suggestion." title="Where a rule came from">
          Dotted underline = from the research report (Southern Alberta crop rotation, Table 3). Dashed outline = a suggestion
          filling a cell your sheet left empty; change it and it becomes yours.
        </HelpNote>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-700">
        <b>Herbicide carryover</b> comes from the product labels: what each label says may be planted after it, how many months later, and
        under what conditions. Planned crops that clash with a product sprayed on the field in the last four years turn red.
        {isManager && (
          <button type="button" onClick={readLabels} className="ml-2 rounded border border-gray-300 px-2 py-0.5 font-medium text-brand-700 hover:bg-gray-50">
            Read re-cropping rules from the labels
          </button>
        )}
        {reading && <span className="ml-2 text-gray-500">{reading}</span>}
      </div>

      <RecropOverrides isManager={isManager} />
      <CropsGrownPanel isManager={isManager} />
    </div>
  )
}
