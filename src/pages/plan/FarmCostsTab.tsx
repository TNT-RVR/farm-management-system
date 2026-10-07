import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Select } from '@/components/Select'
import { canSeeFinances, useAuth } from '@/lib/auth'
import {
  FIXED_CATEGORIES,
  breakdownPerAcre,
  linePerAcre,
  useFixedCostLines,
  useFixedPerAcre,
  usePlanAcres,
  useRentedOutAcres,
  useSaveFixedCosts,
  type FixedBasis,
  type FixedCategory,
  type FixedLine,
  type FixedSetting,
} from '@/lib/farm-costs'
import { money2 } from '@/lib/planner'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { BooksFixedCosts } from './BooksFixedCosts'

const input = 'rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums'
const acres0 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })
const numOrNull = (s: string) => {
  const t = s.replace(/[$,\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Financials → Farm costs: the farm's fixed expenses for the year.
 *
 * Everybody sees the figure per acre, because every budget is built on it.
 * Only an owner, or someone the owners gave access (the accountant), sees what
 * it is made of or can change it; for anyone else the
 * database returns no breakdown at all, so this screen has nothing to hide.
 */
export function FarmCostsTab({ year, locked }: { year: number; locked: boolean }) {
  const { profile } = useAuth()
  const owner = canSeeFinances(profile)
  const { perAcre, carriedFrom, setting, isLoading } = useFixedPerAcre(year)
  // Out here, not in the form: the form starts afresh when the saved row
  // changes, and the "Saved" note must outlive that.
  const save = useSaveFixedCosts()

  return (
    <div className="max-w-3xl space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Fixed expenses · {year}</h2>
          <span className="text-2xl font-bold tabular-nums text-gray-900">
            {isLoading ? '…' : perAcre != null ? `${money2(perAcre)}/ac` : 'not set'}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {carriedFrom != null
            ? `Nothing set for ${year} yet, so ${carriedFrom}'s figure carries forward.`
            : setting
              ? `Set for ${year}${setting.mode === 'breakdown' && owner ? ', from the breakdown below' : ''}.`
              : null}
        </p>
        <p className="mt-2 text-sm text-gray-700">
          Land, machinery, labour and overhead, as one figure per acre. Every crop we farm carries it as its
          &ldquo;Fixed expenses&rdquo; line, and so do the potato grower&apos;s crops on our land, so it is in the budget,
          breakeven, targets and rotation margins, and the Profit/Loss Map charges it on those acres. Land rented out
          carries only its land share; somebody else&apos;s crop carries none.
        </p>
        {!owner && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <Lock className="h-3.5 w-3.5" /> Only the farm&apos;s owners and its accountant can see how this breaks down or change it.
          </p>
        )}
      </section>

      {owner && (
        <OwnerEditor
          // A different year, or the saved row changing under it, starts the form afresh.
          key={`${year}:${setting?.updated_at ?? 'none'}`}
          year={year}
          locked={locked}
          setting={setting}
          carriedFrom={carriedFrom}
          save={save}
        />
      )}
      {owner && <BooksFixedCosts year={year} locked={locked} setting={setting} />}
    </div>
  )
}

type Row = { basis: FixedBasis; amount: string; note: string }

function OwnerEditor({
  year,
  locked,
  setting,
  carriedFrom,
  save,
}: {
  year: number
  locked: boolean
  setting: FixedSetting | null
  carriedFrom: number | null
  save: ReturnType<typeof useSaveFixedCosts>
}) {
  // A year still on last year's figures starts from last year's parts.
  const sourceYear = setting?.crop_year ?? null
  const { data: lines, isLoading } = useFixedCostLines(sourceYear, true)
  const { data: planAcres, isLoading: acresLoading } = usePlanAcres(year)
  const { data: rentedOutAcres } = useRentedOutAcres(year)

  if (isLoading || acresLoading) return <p className="text-sm text-gray-500">Loading the breakdown…</p>
  return (
    <Form
      year={year}
      locked={locked}
      setting={setting}
      carriedFrom={carriedFrom}
      lines={lines ?? []}
      planAcres={planAcres ?? null}
      rentedOutAcres={rentedOutAcres ?? 0}
      save={save}
    />
  )
}

function Form({
  year,
  locked,
  setting,
  carriedFrom,
  lines,
  planAcres,
  rentedOutAcres,
  save,
}: {
  year: number
  locked: boolean
  setting: FixedSetting | null
  carriedFrom: number | null
  lines: FixedLine[]
  planAcres: number | null
  /** Land rented out (Hytech's): the land part is spread over these too. */
  rentedOutAcres: number
  save: ReturnType<typeof useSaveFixedCosts>
}) {
  const [mode, setMode] = useState<'lump' | 'breakdown'>(setting?.mode ?? 'lump')
  const [lump, setLump] = useState(setting?.lump_per_acre != null ? String(setting.lump_per_acre) : '')
  // A carried-forward year divides by this year's plan, not the old year's.
  const [spread, setSpread] = useState(
    carriedFrom == null && setting?.spread_acres != null ? String(setting.spread_acres) : planAcres ? String(Math.round(planAcres)) : '',
  )
  const [note, setNote] = useState(carriedFrom == null ? (setting?.note ?? '') : '')
  const [rows, setRows] = useState<Record<FixedCategory, Row>>(() => {
    const out = {} as Record<FixedCategory, Row>
    for (const c of FIXED_CATEGORIES) {
      const l = lines.find((x) => x.category === c.key)
      out[c.key] = { basis: l?.basis ?? 'per_acre', amount: l ? String(l.amount) : '', note: l?.note ?? '' }
    }
    return out
  })

  const spreadAcres = numOrNull(spread)
  const draftLines = FIXED_CATEGORIES.map((c) => ({ category: c.key, basis: rows[c.key].basis, amount: numOrNull(rows[c.key].amount), note: rows[c.key].note.trim() || null }))
  const total = mode === 'lump' ? (numOrNull(lump) ?? 0) : breakdownPerAcre(draftLines, spreadAcres, rentedOutAcres)
  // The same without depreciation: what the year costs in cash.
  const cash = breakdownPerAcre(
    draftLines.filter((l) => l.category !== 'depreciation'),
    spreadAcres,
    rentedOutAcres,
  )
  const hasDepreciation = draftLines.some((l) => l.category === 'depreciation' && l.amount != null)
  const needsAcres = mode === 'breakdown' && draftLines.some((l) => l.basis === 'farm_total' && l.amount != null) && !spreadAcres
  const canSave = !locked && !save.isPending && !needsAcres && (mode === 'breakdown' || numOrNull(lump) != null)
  const setRow = (k: FixedCategory, patch: Partial<Row>) => setRows((r) => ({ ...r, [k]: { ...r[k], ...patch } }))

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Set the {year} figure</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Owners and the accountant only. Nobody else — managers and other admins included — can read the breakdown; the database
        holds it back, and changes to it are kept in a history only they can read.
      </p>
      {carriedFrom != null && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          Filled in from {carriedFrom}. Saving makes these {year}&apos;s own figures; {carriedFrom} keeps its own.
        </p>
      )}
      {locked && <p className="mt-2 text-xs text-amber-800">{year} is a past year and read-only.</p>}

      <div className="mt-3 flex rounded-md border border-gray-200 p-0.5 text-xs">
        {(
          [
            ['lump', 'One figure per acre'],
            ['breakdown', 'Break it down'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            disabled={locked}
            onClick={() => setMode(k)}
            className={cn('flex-1 rounded px-2 py-1.5', mode === k ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600')}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'lump' ? (
        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-gray-700">
          <span>
            Fixed expenses, $/ac
            <span className="block text-xs text-gray-500">Land, machinery, labour and overhead together.</span>
          </span>
          <input value={lump} onChange={(e) => setLump(e.target.value)} disabled={locked} inputMode="decimal" className={cn(input, 'w-28')} />
        </label>
      ) : (
        <>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-1 font-medium">Part</th>
                <th className="py-1 font-medium">Entered as</th>
                <th className="py-1 text-right font-medium">Amount</th>
                <th className="py-1 text-right font-medium">$/ac</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {FIXED_CATEGORIES.map((c) => {
                const r = rows[c.key]
                const per = linePerAcre({ basis: r.basis, amount: numOrNull(r.amount), category: c.key }, spreadAcres, rentedOutAcres)
                return (
                  <tr key={c.key}>
                    <td className="py-1.5 pr-2 text-gray-800">{c.label}</td>
                    <td className="py-1.5 pr-2">
                      <Select
                        value={r.basis}
                        onChange={(v) => setRow(c.key, { basis: v as FixedBasis })}
                        options={[
                          { value: 'per_acre', label: '$ per acre' },
                          { value: 'farm_total', label: 'Farm total for the year' },
                        ]}
                        size="sm"
                        className="w-48"
                        ariaLabel={`${c.label}: entered as`}
                        disabled={locked}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <input
                        value={r.amount}
                        onChange={(e) => setRow(c.key, { amount: e.target.value })}
                        disabled={locked}
                        inputMode="decimal"
                        placeholder="—"
                        aria-label={`${c.label} amount`}
                        className={cn(input, r.basis === 'farm_total' ? 'w-32' : 'w-24')}
                      />
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-gray-700">{per != null ? money2(per) : '—'}</td>
                  </tr>
                )
              })}
              <tr>
                <td colSpan={3} className="py-1.5 font-semibold text-gray-900">
                  Fixed expenses
                </td>
                <td className="py-1.5 pl-2 text-right font-semibold tabular-nums text-gray-900">{money2(total)}</td>
              </tr>
              {hasDepreciation && (
                <tr>
                  <td colSpan={3} className="py-1 text-xs text-gray-500">
                    Without depreciation — the cash part
                  </td>
                  <td className="py-1 pl-2 text-right text-xs tabular-nums text-gray-500">{money2(cash)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <label className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700">
            <span className="min-w-0 flex-1">
              Farm totals are spread over, acres
              <span className="flex items-center gap-1 text-xs text-gray-500">
                Every acre that carries the figure in the {year} plan takes its share.
                {planAcres ? ` The ${year} plan has ${acres0(planAcres)} ac.` : ''}
                <InfoPopover title="How farm totals are spread" width={320}>
                  <p>
                    A farm total is divided by the acres in the {year} plan that are charged the fixed figure: our own crops and the
                    potato grower&apos;s crops on our land, a split field by its crop areas. Somebody else&apos;s crop is left out,
                    as it is charged nothing. The land part alone is also spread over land rented out
                    {rentedOutAcres > 0 ? ` (${acres0(rentedOutAcres)} ac this year)` : ''}, which carries that share and nothing else.
                    That way the acres together carry exactly the total, no more and no less.
                  </p>
                </InfoPopover>
              </span>
            </span>
            <span className="flex items-center gap-2">
              {planAcres != null && planAcres > 0 && numOrNull(spread) !== Math.round(planAcres) && !locked && (
                <button type="button" onClick={() => setSpread(String(Math.round(planAcres)))} className="text-xs text-brand-700 underline">
                  Use the plan&apos;s {acres0(planAcres)}
                </button>
              )}
              <input value={spread} onChange={(e) => setSpread(e.target.value)} disabled={locked} inputMode="decimal" className={cn(input, 'w-24')} />
            </span>
          </label>
          {needsAcres && <p className="mt-1 text-xs text-red-700">A farm total needs acres to be spread over.</p>}
        </>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Labour, parts and depreciation each have one row: a farm total <em>or</em> a $/ac, never both, so nothing is counted twice.
        &ldquo;One figure per acre&rdquo; already includes them all — the parts stay saved but are not added on top.
      </p>

      <label className="mt-3 block text-xs text-gray-600">
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </label>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            save.mutate({
              year,
              mode,
              lump: numOrNull(lump),
              spreadAcres,
              note: note.trim() || null,
              lines: draftLines,
            })
          }
          className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : `Save ${money2(total)}/ac for ${year}`}
        </button>
        {save.isSuccess && <span className="text-xs text-green-700">Saved — every {year} crop budget now carries it.</span>}
        {save.isError && <span className="text-xs text-red-700">{(save.error as Error).message}</span>}
      </div>
    </section>
  )
}
