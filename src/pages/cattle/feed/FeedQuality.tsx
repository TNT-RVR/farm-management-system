import { Fragment, useState } from 'react'
import { ChevronRight, FlaskConical, Plus, Trash2 } from 'lucide-react'
import { DeleteButton, DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Select } from '@/components/Select'
import { Fold } from '@/components/Fold'
import { supabase } from '@/lib/supabase'
import { nitrateNPpmToPct, tdnFromAdf, type FeedCategory, type FeedValue } from '@/lib/cattle-nutrition'
import {
  feedTypeDeletePlan,
  useDeleteFeedType,
  useFeedTestMutations,
  useUpdateFeedType,
  type FeedTestRow,
  type FeedTypeRow,
} from '@/lib/winter-feeding'
import { cn } from '@/lib/utils'
import { FeedInfo } from './FeedInfo'
import { Num, n0, n1 } from './bits'

const CATEGORY_LABEL: Record<FeedCategory, string> = {
  hay: 'Hay',
  greenfeed: 'Green feed',
  straw: 'Straw',
  silage: 'Silage',
  grain: 'Grain',
  supplement: 'Supplement',
  other: 'Other',
}

/** Book values a new feed starts from (report, recommended defaults). */
const BOOK: Record<FeedCategory, { dm: number; tdn: number; cp: number; loss: number }> = {
  hay: { dm: 88, tdn: 57, cp: 13, loss: 8 },
  greenfeed: { dm: 88, tdn: 58, cp: 10, loss: 8 },
  straw: { dm: 88, tdn: 44, cp: 4.5, loss: 8 },
  silage: { dm: 33, tdn: 68, cp: 8, loss: 12 },
  grain: { dm: 88, tdn: 84, cp: 12.8, loss: 1 },
  supplement: { dm: 90, tdn: 75, cp: 32, loss: 1 },
  other: { dm: 88, tdn: 55, cp: 10, loss: 5 },
}

/**
 * Each feed's quality — the book value until a lab test replaces it — and its
 * bale weight and storage loss, which decide how far the pile goes.
 */
export function FeedQuality({
  types,
  tests,
  values,
  isManager,
}: {
  types: FeedTypeRow[]
  tests: FeedTestRow[]
  values: Map<string, FeedValue & { test: FeedTestRow | null; bookNote: string | null }>
  isManager: boolean
}) {
  const upd = useUpdateFeedType()
  const [testing, setTesting] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // A row opens to its tests (each editable) and Delete (Sam, 7 Oct 2026).
  const [open, setOpen] = useState<string | null>(null)

  // Folded by default: set up once a season, when a test comes back.
  const tested = types.filter((t) => values.get(t.id)?.test).length
  return (
    <Fold
      storageKey="cattle-feed-quality"
      title={
        <span className="flex items-center gap-1.5">
          <FlaskConical className="h-4 w-4 text-gray-400" /> Feed quality and tests
        </span>
      }
      summary={`${types.length} feeds · ${tested} tested`}
      actions={
        <span className="flex items-center gap-2 text-xs text-gray-400">
          <FeedInfo k="quality" />
          How to get a test <FeedInfo k="test" />
        </span>
      }
      bodyClassName="p-0"
    >
      {isManager && !adding && (
        <div className="flex justify-end border-b border-gray-100 px-3 py-1.5 text-xs">
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> New feed
          </button>
        </div>
      )}
      {adding && <NewFeed onDone={() => setAdding(false)} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <th className="px-3 py-1.5 font-medium">Feed</th>
              <th className="px-2 py-1.5 font-medium">Kind</th>
              <th className="px-2 py-1.5 text-right font-medium">
                <span className="inline-flex items-center gap-1">Bale weight <FeedInfo k="baleWeight" /></span>
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                <span className="inline-flex items-center gap-1">Dry matter % <FeedInfo k="dm" /></span>
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                <span className="inline-flex items-center gap-1">Energy (TDN) % <FeedInfo k="tdn" /></span>
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                <span className="inline-flex items-center gap-1">Protein (CP) % <FeedInfo k="cp" /></span>
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                <span className="inline-flex items-center gap-1">Storage loss <FeedInfo k="storageLoss" /></span>
              </th>
              <th className="px-3 py-1.5 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {types.map((ft) => {
              const v = values.get(ft.id)
              const t = v?.test
              const edit = (patch: Parameters<typeof upd.mutate>[0]['patch']) => upd.mutate({ id: ft.id, patch })
              return (
                <Fragment key={ft.id}>
                <tr
                  onClick={rowClick(() => setOpen(open === ft.id ? null : ft.id))}
                  className={cn('cursor-pointer hover:bg-gray-50', ft.is_bedding && 'text-gray-500')}
                >
                  <td className="px-3 py-1.5">
                    <ChevronRight className={cn('mr-1 inline h-3.5 w-3.5 text-gray-400 transition-transform', open === ft.id && 'rotate-90')} />
                    {ft.name}
                    {ft.is_bedding && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">bedding</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={ft.category}
                      size="sm"
                      disabled={!isManager}
                      ariaLabel="Kind of feed"
                      className="w-28"
                      onChange={(c) => edit({ category: c as FeedCategory })}
                      options={(Object.keys(CATEGORY_LABEL) as FeedCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {ft.default_unit === 'lb' ? (
                      <span className="text-xs text-gray-400">by the lb</span>
                    ) : (
                      <Num value={ft.default_lb_per_bale == null ? null : Number(ft.default_lb_per_bale)} step="25" min={100} max={3000} suffix="lb" disabled={!isManager} onCommit={(x) => edit({ default_lb_per_bale: x })} className="w-20" allowEmpty />
                    )}
                  </td>
                  {t ? (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums">{v ? n1(v.dmPct) : '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{v ? n1(v.tdnPct) : '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{v ? n1(v.cpPct) : '—'}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5 text-right"><Num value={ft.dm_pct == null ? null : Number(ft.dm_pct)} step="1" min={1} max={100} disabled={!isManager} onCommit={(x) => edit({ dm_pct: x })} className="w-14" /></td>
                      <td className="px-2 py-1.5 text-right"><Num value={ft.tdn_pct == null ? null : Number(ft.tdn_pct)} step="1" min={1} max={100} disabled={!isManager} onCommit={(x) => edit({ tdn_pct: x })} className="w-14" /></td>
                      <td className="px-2 py-1.5 text-right"><Num value={ft.cp_pct == null ? null : Number(ft.cp_pct)} step="0.5" min={0} max={60} disabled={!isManager} onCommit={(x) => edit({ cp_pct: x })} className="w-14" /></td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right">
                    <Num value={Number(ft.storage_loss_pct)} step="1" min={0} max={60} suffix="%" disabled={!isManager} onCommit={(x) => x != null && edit({ storage_loss_pct: x })} className="w-12" />
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {t ? (
                      <span className="text-emerald-800">
                        Tested {t.sampled_on}
                        {t.lab ? `, ${t.lab}` : ''}
                        {t.nitrate_pct != null && <span className={cn('ml-1', Number(t.nitrate_pct) >= 0.5 ? 'font-semibold text-red-700' : '')}>NO₃ {Number(t.nitrate_pct).toFixed(2)}%</span>}
                      </span>
                    ) : (
                      <span className="text-gray-400" title={ft.book_note ?? undefined}>
                        Book value{ft.book_note ? ' ⓘ' : ''}
                      </span>
                    )}
                    {isManager && (
                      <button type="button" onClick={() => setTesting(testing === ft.id ? null : ft.id)} className="ml-2 text-brand-700 hover:underline">
                        {testing === ft.id ? 'close' : '+ test'}
                      </button>
                    )}
                    {testing === ft.id && <TestForm feed={ft} onDone={() => setTesting(null)} />}
                  </td>
                </tr>
                {open === ft.id && (
                  <tr className="bg-gray-50">
                    <td colSpan={8} className="px-3 py-2">
                      <FeedDetail feed={ft} tests={tests.filter((x) => x.feed_type_id === ft.id)} isManager={isManager} onGone={() => setOpen(null)} />
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <QuickEstimates />
    </Fold>
  )
}

function TestForm({ feed, onDone }: { feed: FeedTypeRow; onDone: () => void }) {
  const m = useFeedTestMutations()
  const [f, setF] = useState({ sampled_on: new Date().toISOString().slice(0, 10), lab: '', dm: '', cp: '', tdn: '', adf: '', ndf: '', nitrate: '', nitrateUnit: 'pct', notes: '' })
  const n = (s: string) => (s.trim() === '' ? null : Number(s))
  const cat = feed.category as FeedCategory
  const estTdn = n(f.tdn) == null && n(f.adf) != null ? tdnFromAdf(cat, n(f.adf)!, n(f.cp), feed.legume) : null
  const nitratePct = n(f.nitrate) == null ? null : f.nitrateUnit === 'ppmN' ? nitrateNPpmToPct(n(f.nitrate)!) : n(f.nitrate)
  const field = (key: keyof typeof f, label: string, ph = '') => (
    <label className="text-[11px] text-gray-500">
      {label}
      <input value={f[key]} placeholder={ph} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} inputMode="decimal" className="mt-0.5 w-full rounded border border-gray-300 px-1.5 py-1 text-sm tabular-nums text-gray-900" />
    </label>
  )
  return (
    <div className="mt-2 w-[520px] max-w-full rounded-md border border-emerald-200 bg-emerald-50/40 p-2 text-gray-800">
      <p className="text-xs font-semibold">Lab test for {feed.name} — dry-matter basis</p>
      <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-gray-500">
          Sampled
          <input type="date" value={f.sampled_on} onChange={(e) => setF((x) => ({ ...x, sampled_on: e.target.value }))} className="mt-0.5 w-full rounded border border-gray-300 px-1.5 py-1 text-sm" />
        </label>
        {field('lab', 'Lab', 'Down to Earth')}
        {field('dm', 'Dry matter %', '88')}
        {field('cp', 'Crude protein %', '10.5')}
        {field('tdn', 'TDN %', estTdn != null ? `≈${estTdn.toFixed(1)} from ADF` : 'blank = from ADF')}
        {field('adf', 'ADF %', '35')}
        {field('ndf', 'NDF %', '55')}
        <label className="text-[11px] text-gray-500">
          Nitrate
          <span className="mt-0.5 flex gap-1">
            <input value={f.nitrate} onChange={(e) => setF((x) => ({ ...x, nitrate: e.target.value }))} inputMode="decimal" className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm tabular-nums" />
            <select value={f.nitrateUnit} onChange={(e) => setF((x) => ({ ...x, nitrateUnit: e.target.value }))} className="rounded border border-gray-300 text-xs">
              <option value="pct">% NO₃</option>
              <option value="ppmN">ppm NO₃-N</option>
            </select>
          </span>
        </label>
      </div>
      {field('notes', 'Notes', 'lot, field, how many bales cored')}
      {nitratePct != null && (
        <p className={cn('mt-1 text-[11px]', nitratePct > 1 ? 'text-red-700' : nitratePct >= 0.5 ? 'text-amber-700' : 'text-emerald-700')}>
          {nitratePct.toFixed(2)}% NO₃ of DM — {nitratePct > 1 ? 'dangerous' : nitratePct >= 0.5 ? 'caution' : 'safe'}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={m.add.isPending}
          onClick={() =>
            m.add.mutate(
              {
                feed_type_id: feed.id,
                sampled_on: f.sampled_on,
                lab: f.lab.trim() || null,
                dm_pct: n(f.dm),
                cp_pct: n(f.cp),
                tdn_pct: n(f.tdn) ?? (estTdn != null ? Math.round(estTdn * 10) / 10 : null),
                adf_pct: n(f.adf),
                ndf_pct: n(f.ndf),
                nitrate_pct: nitratePct,
                notes: f.notes.trim() || null,
              },
              { onSuccess: onDone },
            )
          }
          className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Save test
        </button>
        <button type="button" onClick={onDone} className="text-xs text-gray-500">
          Cancel
        </button>
        {m.add.isError && <span className="text-xs text-red-600">{(m.add.error as Error).message}</span>}
      </div>
    </div>
  )
}

const TEST_FIELDS: EditField[] = [
  { key: 'sampled_on', label: 'Sampled', kind: 'date', required: true },
  { key: 'lab', label: 'Lab', kind: 'text' },
  { key: 'dm_pct', label: 'Dry matter %', kind: 'number' },
  { key: 'cp_pct', label: 'Crude protein %', kind: 'number' },
  { key: 'tdn_pct', label: 'TDN %', kind: 'number' },
  { key: 'adf_pct', label: 'ADF %', kind: 'number' },
  { key: 'ndf_pct', label: 'NDF %', kind: 'number' },
  { key: 'nitrate_pct', label: 'Nitrate (% NO₃ of DM)', kind: 'number', hint: 'Percent nitrate. A lab giving ppm NO₃-N: enter it through + test, which converts it.' },
  { key: 'notes', label: 'Notes', kind: 'textarea' },
]

/** One feed opened: its standing facts, every lab test (edit, delete), and Delete for the feed. */
function FeedDetail({ feed, tests, isManager, onGone }: { feed: FeedTypeRow; tests: FeedTestRow[]; isManager: boolean; onGone: () => void }) {
  const m = useFeedTestMutations()
  const del = useDeleteFeedType()
  const [edit, setEdit] = useState<FeedTestRow | null>(null)
  const [checking, setChecking] = useState(false)
  const unit = feed.default_unit === 'lb' ? 'Pounds' : feed.default_unit === 'round' ? 'Round bales' : 'Big squares'

  const removeFeed = async () => {
    setChecking(true)
    try {
      const plan = feedTypeDeletePlan(await del.usage(feed.id))
      if (!window.confirm(plan.message)) return
      await del.run.mutateAsync({ id: feed.id, action: plan.action })
      onGone()
    } catch {
      // Shown below from the mutation's error.
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <DetailList
        className="text-xs"
        rows={[
          ['Kind', CATEGORY_LABEL[feed.category as FeedCategory] ?? feed.category],
          ['Counted in', unit],
          ['Bale weight', feed.default_unit === 'lb' || feed.default_lb_per_bale == null ? null : `${Number(feed.default_lb_per_bale).toLocaleString('en-CA')} lb`],
          ['Bedding', feed.is_bedding ? 'Yes — kept out of the per-head average' : null],
          ['Book value', feed.book_note],
        ]}
      />
      <div>
        <p className="font-semibold text-gray-700">Lab tests</p>
        {tests.length === 0 ? (
          <p className="text-gray-400">None — the book value is used.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {tests.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-gray-700">
                <span className="tabular-nums">{h.sampled_on}</span>
                <span>{h.lab ?? ''}</span>
                <span className="tabular-nums text-gray-600">
                  DM {h.dm_pct ?? '—'} · TDN {h.tdn_pct ?? '—'} · CP {h.cp_pct ?? '—'}
                  {h.adf_pct != null && ` · ADF ${h.adf_pct}`}
                  {h.ndf_pct != null && ` · NDF ${h.ndf_pct}`}
                  {h.nitrate_pct != null && ` · NO₃ ${h.nitrate_pct}%`}
                </span>
                {h.notes && <span className="text-gray-400">{h.notes}</span>}
                {isManager && (
                  <span className="ml-auto flex items-center gap-1">
                    <EditButton onClick={() => setEdit(h)} />
                    <DeleteButton confirm={`Delete the ${h.sampled_on} test of ${feed.name}?`} onDelete={() => m.remove.mutate(h.id)} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {isManager && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={checking || del.run.isPending}
            onClick={() => void removeFeed()}
            className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> {checking ? 'Checking…' : 'Delete feed'}
          </button>
          {(del.run.error || m.remove.error) && <span className="text-red-600">{((del.run.error ?? m.remove.error) as Error).message}</span>}
        </div>
      )}
      {edit && (
        <RecordEditModal
          title={`Edit the ${edit.sampled_on} test of ${feed.name}`}
          fields={TEST_FIELDS}
          row={edit}
          saving={m.update.isPending}
          error={m.update.error ? (m.update.error as Error).message : null}
          onClose={() => setEdit(null)}
          onDelete={() => m.remove.mutateAsync(edit.id)}
          deleteConfirm={`Delete the ${edit.sampled_on} test of ${feed.name}?`}
          onSave={(p) =>
            m.update.mutateAsync({
              id: edit.id,
              patch: {
                sampled_on: p.sampled_on as string,
                lab: p.lab as string | null,
                dm_pct: p.dm_pct as number | null,
                cp_pct: p.cp_pct as number | null,
                tdn_pct: p.tdn_pct as number | null,
                adf_pct: p.adf_pct as number | null,
                ndf_pct: p.ndf_pct as number | null,
                nitrate_pct: p.nitrate_pct as number | null,
                notes: p.notes as string | null,
              },
            })
          }
        />
      )}
    </div>
  )
}

function NewFeed({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', category: 'greenfeed' as FeedCategory, unit: 'round', lb: '1350' })
  const save = useMutation({
    mutationFn: async () => {
      const b = BOOK[f.category]
      const { error } = await supabase.from('feed_types').insert({
        name: f.name.trim(),
        category: f.category,
        default_unit: f.unit as 'lb' | 'round' | 'big_square',
        default_lb_per_bale: f.unit === 'lb' ? null : Number(f.lb) || null,
        dm_pct: b.dm,
        tdn_pct: b.tdn,
        cp_pct: b.cp,
        storage_loss_pct: b.loss,
        is_bedding: false,
        sort_order: 50,
        book_note: 'Book value for its kind until a test is entered.',
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed_types'] })
      onDone()
    },
  })
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs">
      <label className="text-gray-500">
        Name (one lot: field, cut, year)
        <input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="Oat-pea green feed 2026" className="mt-0.5 block w-56 rounded border border-gray-300 px-1.5 py-1 text-sm" />
      </label>
      <label className="text-gray-500">
        Kind
        <Select value={f.category} size="sm" ariaLabel="Kind" className="mt-0.5 w-28" onChange={(v) => setF((x) => ({ ...x, category: v as FeedCategory }))} options={(Object.keys(CATEGORY_LABEL) as FeedCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
      </label>
      <label className="text-gray-500">
        Counted in
        <Select value={f.unit} size="sm" ariaLabel="Unit" className="mt-0.5 w-32" onChange={(v) => setF((x) => ({ ...x, unit: v }))} options={[{ value: 'round', label: 'Round bales' }, { value: 'big_square', label: 'Big squares' }, { value: 'lb', label: 'Pounds' }]} />
      </label>
      {f.unit !== 'lb' && (
        <label className="text-gray-500">
          lb per bale
          <input value={f.lb} onChange={(e) => setF((x) => ({ ...x, lb: e.target.value }))} inputMode="decimal" className="mt-0.5 block w-20 rounded border border-gray-300 px-1.5 py-1 text-sm tabular-nums" />
        </label>
      )}
      <button type="button" disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()} className="rounded-md bg-brand-700 px-2.5 py-1 font-semibold text-white disabled:opacity-50">
        Add
      </button>
      <button type="button" onClick={onDone} className="text-gray-500">
        Cancel
      </button>
      {save.isError && <span className="text-red-600">{(save.error as Error).message}</span>}
    </div>
  )
}

/** Bale weight from its size, and silage tonnes from a pile — for when there is no scale handy. */
function QuickEstimates() {
  const [b, setB] = useState({ d: 6, w: 5, density: 10, dm: 88 })
  const [p, setP] = useState({ l: 150, w: 40, h: 8, dm: 33 })
  const baleDm = Math.PI * (b.d / 2) ** 2 * b.w * b.density
  const baleAsFed = baleDm / (b.dm / 100)
  const h = p.h
  const pileFt3 = Math.max(0, h * (p.w - 3 * h) * (p.l - 3 * h))
  const pileDm = pileFt3 * 14.5
  const pileAsFed = pileDm / (p.dm / 100)
  const box = 'w-14 rounded border border-gray-300 px-1 py-0.5 text-right text-xs tabular-nums'
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : fallback)
  return (
    <div className="grid gap-3 border-t border-gray-100 px-3 py-2 text-xs text-gray-600 md:grid-cols-2">
      <div>
        <p className="flex items-center gap-1 font-semibold text-gray-800">
          Round bale weight from its size <FeedInfo k="baleWeight" />
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1">
          <input className={box} defaultValue={b.d} onBlur={(e) => setB((x) => ({ ...x, d: num(e.target.value, x.d) }))} /> ft across ×
          <input className={box} defaultValue={b.w} onBlur={(e) => setB((x) => ({ ...x, w: num(e.target.value, x.w) }))} /> ft wide, feel
          <select value={b.density} onChange={(e) => setB((x) => ({ ...x, density: Number(e.target.value) }))} className="rounded border border-gray-300 text-xs">
            <option value={9}>spongy (9)</option>
            <option value={10}>gives a little (10)</option>
            <option value={11}>rigid (11)</option>
            <option value={12}>very rigid (12)</option>
          </select>
          at <input className={box} defaultValue={b.dm} onBlur={(e) => setB((x) => ({ ...x, dm: num(e.target.value, x.dm) }))} />% DM
        </p>
        <p className="mt-0.5">
          ≈ <b>{n0(baleAsFed)} lb as fed</b> ({n0(baleDm)} lb dry matter). Weigh 3–5 to be sure.
        </p>
      </div>
      <div>
        <p className="flex items-center gap-1 font-semibold text-gray-800">
          Silage pile tonnes <FeedInfo k="silage" />
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1">
          base <input className={box} defaultValue={p.l} onBlur={(e) => setP((x) => ({ ...x, l: num(e.target.value, x.l) }))} /> ×
          <input className={box} defaultValue={p.w} onBlur={(e) => setP((x) => ({ ...x, w: num(e.target.value, x.w) }))} /> ft, settled height
          <input className={box} defaultValue={p.h} onBlur={(e) => setP((x) => ({ ...x, h: num(e.target.value, x.h) }))} /> ft at
          <input className={box} defaultValue={p.dm} onBlur={(e) => setP((x) => ({ ...x, dm: num(e.target.value, x.dm) }))} />% DM
        </p>
        <p className="mt-0.5">
          ≈ <b>{n0(pileAsFed / 2204.62)} t as fed</b> ({n0(pileDm / 2204.62)} t dry matter, {n0(pileFt3)} ft³ with 3:1 sides).
        </p>
      </div>
    </div>
  )
}
