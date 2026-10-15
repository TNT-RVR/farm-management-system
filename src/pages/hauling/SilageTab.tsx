import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFields } from '@/lib/queries'
import { useBasics, usePlaces, useSaveOperatingSetting, useSilageFields, useSilageHaulInputs, useTrips } from '@/lib/hauling-data'
import { PIT_LABEL, binsKey, fieldKey, pitKey, shopKey } from '@/lib/road-routes'
import { breakEvenKm, costCurve, haulLimitPerT, silageHaulCost, type SilageCompare, type SilageHaulInputs } from '@/lib/silage-haul'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'
import { Card, SettingsGroup, input, type NumberField } from './ui'
import { FieldLink, Sources, money, n0, n1 } from '../fertilizer/savings/ui'

const FIELDS: NumberField<keyof SilageHaulInputs>[] = [
  { key: 'payloadT', label: 'Silage truck carries', unit: 't as fed' },
  { key: 'trucks', label: 'Trucks running', unit: 'trucks' },
  { key: 'loadedKmh', label: 'Speed loaded', unit: 'km/h', hint: 'averaged, field road and highway' },
  { key: 'emptyKmh', label: 'Speed empty', unit: 'km/h' },
  { key: 'lPerKm', label: 'Diesel', unit: 'L/km', hint: 'loaded out, empty back, averaged' },
  { key: 'loadMin', label: 'Under the chopper', unit: 'min a load', hint: 'never quicker than the chopper fills it' },
  { key: 'unloadMin', label: 'Dumping at the pit', unit: 'min a load' },
  { key: 'chopperTph', label: 'Chopper cuts', unit: 't/h as fed' },
  { key: 'truckPerHour', label: 'Truck repairs + ownership', unit: '$/h', hint: 'the driver is the Labour figure' },
  { key: 'dmPct', label: 'Dry matter', unit: '%' },
  { key: 'valuePerT', label: 'Our silage is worth', unit: '$/t as fed' },
  { key: 'localPerT', label: 'Bought near the pit', unit: '$/t as fed', hint: 'delivered' },
  { key: 'sharePct', label: 'Haul may take', unit: '% of value' },
]

const COMPARE: { key: SilageCompare; label: string }[] = [
  { key: 'share', label: 'a share of what the silage is worth' },
  { key: 'local', label: 'what buying silage near the pit saves' },
]

/**
 * How far silage can be trucked before it stops paying: the $ a tonne by
 * distance, where that crosses the limit Sam picks, how many trucks keep
 * the chopper going, and each silage field by its real road distance.
 */
export function SilageTab({ year, isManager }: { year: number; isManager: boolean }) {
  const s = useSilageHaulInputs(year)
  const i = s.inputs
  const b = useBasics()
  const save = useSaveOperatingSetting()
  const { pit } = usePlaces()
  const { trip } = useTrips()
  const { data: fields } = useFields()
  const { data: silage } = useSilageFields(year)
  const [atKm, setAtKm] = useState('15')

  const limit = haulLimitPerT(i, s.compare)
  const be = breakEvenKm(i, limit, b.dieselPerL, b.wage)
  const km = Math.max(0, Number(atKm) || 0)
  const at = silageHaulCost(i, km, b.dieselPerL, b.wage)
  // Far enough to show the crossing with room after it, never a flat stub.
  const chartTo = Math.min(300, Math.max(40, Math.ceil(((be.beyond ? 100 : be.km) * 1.5) / 10) * 10))
  const curve = useMemo(() => costCurve(i, b.dieselPerL, b.wage, chartTo), [i, b.dieselPerL, b.wage, chartTo])

  // With nothing planned as silage, every field is shown so the question
  // "could we grow it there?" still has an answer.
  const onlySilage = (silage?.size ?? 0) > 0
  const rows = useMemo(
    () =>
      (fields ?? [])
        .filter((f) => !onlySilage || silage?.has(f.id))
        .map((f) => {
          const t = trip(s.pit, fieldKey(f.id))
          if (!t) return { f, sf: silage?.get(f.id) ?? null, t: null, c: null }
          return { f, sf: silage?.get(f.id) ?? null, t, c: silageHaulCost(i, t.km, b.dieselPerL, b.wage) }
        })
        .sort((a, b2) => (a.t?.km ?? Infinity) - (b2.t?.km ?? Infinity)),
    [fields, silage, onlySilage, trip, s.pit, i, b.dieselPerL, b.wage],
  )

  const limitText =
    s.compare === 'share'
      ? `${n0(i.sharePct)}% of ${money(i.valuePerT, 2)}/t`
      : `${money(i.localPerT, 2)}/t bought − ${money(i.valuePerT, 2)}/t ours`
  const choose = (key: string, value: string) => save.mutate({ key, value })

  return (
    <div className="space-y-4">
      <Card title="How far silage can go">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
          <span>Stop when the haul costs more than</span>
          {isManager ? (
            <select value={s.compare} onChange={(e) => choose('silage_haul_compare', e.target.value)} className={cn(input, 'text-xs')} aria-label="Compare the haul against">
              {COMPARE.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-medium">{COMPARE.find((c) => c.key === s.compare)?.label}</span>
          )}
          <span>· pit at</span>
          {isManager ? (
            <select value={s.pit} onChange={(e) => choose('silage_haul_pit', e.target.value)} className={cn(input, 'text-xs')} aria-label="Where the pit is">
              {pit && <option value={pitKey}>{PIT_LABEL.pit}</option>}
              <option value={binsKey}>{PIT_LABEL.bins}</option>
              <option value={shopKey}>{PIT_LABEL.shop}</option>
            </select>
          ) : (
            <span className="font-medium">{PIT_LABEL[s.pit]}</span>
          )}
        </div>
        {s.pit === pitKey && (
          <p className="-mt-2 mb-3 text-xs text-gray-500">
            {pit ? `${pit.label}${pit.note ? ` — ${pit.note}` : ''}. ` : 'The pit has no pin yet. '}
            Move it by dragging the P pin on the{' '}
            <Link to="/hauling?tab=distances" className="text-brand-700 underline">
              Distances map
            </Link>
            ; distances from a new spot follow on the next route check.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <dl className="space-y-1 text-sm">
            <Row k="Limit" v={limit > 0 ? `${money(limit, 2)}/t as fed (${limitText})` : `none — ${limitText}, so buying is cheaper at any distance`} />
            <Row
              k="Break-even, one way"
              v={be.beyond ? `beyond ${n0(be.km)} km` : limit > 0 && be.km > 0 ? `${n1(be.km)} km by road` : '0 km — not even next door'}
              strong
            />
            <Row
              k="At"
              v={
                <span className="flex items-center gap-1">
                  <input inputMode="decimal" value={atKm} onChange={(e) => setAtKm(e.target.value)} className={cn(input, 'w-16 text-right text-xs')} aria-label="One-way km" />
                  <span className="text-xs text-gray-500">km one way</span>
                </span>
              }
            />
            <Row
              k="Haul a tonne"
              v={
                <span className={cn(at.perT.total > limit ? 'text-red-700' : 'text-green-800')}>
                  {money(at.perT.total, 2)} as fed · {money(at.perTDm, 2)} a tonne of dry matter · {n0(at.shareOfValue)}% of its value
                </span>
              }
              strong
            />
            <Row k="Made of" v={`diesel ${money(at.perT.fuel, 2)}, drivers and trucks ${money(at.perT.time, 2)}`} />
            <Row k="A round" v={`${n0(at.cycleMin)} min`} />
            <Row
              k="Trucks to keep up"
              v={
                <span className={cn(at.chopperWaits && 'text-amber-700')}>
                  {at.trucksNeeded} — {i.trucks} running moves {n0(at.tonnesPerHour)} t/h
                  {at.chopperWaits ? ` and the chopper waits (it cuts ${n0(i.chopperTph)})` : ''}
                </span>
              }
            />
          </dl>
          <div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={curve} margin={{ top: 8, right: 12, bottom: 14, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="km" type="number" domain={[0, chartTo]} tick={{ fontSize: 11 }} label={{ value: 'km one way', position: 'insideBottom', offset: -8, style: { fontSize: 11 } }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} width={44} />
                <Tooltip
                  labelFormatter={(v) => `${v} km one way`}
                  formatter={(v, name) => [`$${Number(v).toFixed(2)}/t`, name as string]}
                />
                {limit > 0 && (
                  <ReferenceLine y={limit} stroke="#b91c1c" strokeDasharray="4 3" label={{ value: `limit ${money(limit, 2)}`, fontSize: 10, fill: '#b91c1c', position: 'insideTopLeft' }} />
                )}
                {!be.beyond && be.km > 0 && <ReferenceLine x={Math.round(be.km * 10) / 10} stroke="#b91c1c" strokeDasharray="4 3" />}
                <Line type="monotone" dataKey="perT" name="As fed" stroke="#0369a1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="perTDm" name="Dry matter" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <HelpNote
          className="mt-2"
          summary={`Diesel $${b.dieselPerL.toFixed(2)}/L and drivers $${b.wage.toFixed(2)}/h from the top; “default” numbers are a typical silage box, not yet ours.`}
          title="How the silage haul is costed"
        >
          A round is the minutes under the chopper (never fewer than the chopper takes to fill the load), the drive out loaded, dumping at the pit
          and the drive back empty. Trucks to keep up = the round ÷ the minutes under the chopper, rounded up. Every truck running is paid by the
          hour — driver plus truck — whether it is driving or waiting its turn, so the time cost a tonne is the fleet's hourly cost ÷ the tonnes an
          hour actually moved (the chopper's rate, or less when the trucks cannot keep up). Diesel is the round trip km × L/km ÷ the load. The
          chopper itself and the pit work are the same at any distance, so they are left out. Break-even is where the $ a tonne reaches the limit:
          either the share of value chosen, or the price of buying silage near the pit less what ours is worth.
        </HelpNote>
        <div className="mt-4">
          <SettingsGroup settingKey="silage_haul" fields={FIELDS} values={i} defaults={s.defaults} isManager={isManager} />
          <p className="mt-1 text-[11px] text-gray-400">
            Value default: {s.valueSource ?? 'a round $68.25/t'}. Dry matter default: {s.dmSource ?? 'a typical 35%'}.
          </p>
        </div>
      </Card>

      <Card
        title={onlySilage ? `Silage fields, ${year}` : `Every field — no silage on the ${year} plan`}
        right={<span className="text-xs text-gray-500">from {PIT_LABEL[s.pit]} by road</span>}
      >
        <Sources
          sources={[
            { label: 'Silage fields: the crop plan', to: '/plan' },
            { label: 'Distances: the Distances tab', to: '/hauling?tab=distances' },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-1 font-medium">Field</th>
                {onlySilage && <th className="px-2 py-1 text-right font-medium">Tonnes</th>}
                <th className="px-2 py-1 text-right font-medium">One way</th>
                <th className="hidden px-2 py-1 text-right font-medium md:table-cell">Round</th>
                <th className="px-2 py-1 text-right font-medium">Trucks</th>
                <th className="px-2 py-1 text-right font-medium">$/t as fed</th>
                <th className="hidden px-2 py-1 text-right font-medium md:table-cell">$/t DM</th>
                {onlySilage && <th className="hidden px-2 py-1 text-right font-medium md:table-cell">Haul $</th>}
                <th className="px-2 py-1 font-medium">Pays?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ f, sf, t, c }) => {
                const ok = c ? c.perT.total <= limit : null
                return (
                  <tr key={f.id}>
                    <td className="px-2 py-1 text-gray-800">
                      <FieldLink id={f.id} name={f.name} to="work" />
                    </td>
                    {onlySilage && <td className="px-2 py-1 text-right tabular-nums">{sf?.tonnes != null ? n0(sf.tonnes) : '—'}</td>}
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                      {t ? `${n1(t.km)} km` : '—'}
                      {t?.note && <span className="block text-[10px] text-amber-700">estimate</span>}
                    </td>
                    <td className="hidden px-2 py-1 text-right tabular-nums text-gray-600 md:table-cell">{c ? `${n0(c.cycleMin)} min` : '—'}</td>
                    <td className={cn('px-2 py-1 text-right tabular-nums', c?.chopperWaits && 'text-amber-700')}>{c ? c.trucksNeeded : '—'}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{c ? money(c.perT.total, 2) : '—'}</td>
                    <td className="hidden px-2 py-1 text-right tabular-nums text-gray-600 md:table-cell">{c ? money(c.perTDm, 2) : '—'}</td>
                    {onlySilage && (
                      <td className="hidden px-2 py-1 text-right tabular-nums md:table-cell">{c && sf?.tonnes != null ? money(c.perT.total * sf.tonnes) : '—'}</td>
                    )}
                    <td className={cn('px-2 py-1', ok == null ? 'text-gray-300' : ok ? 'text-green-800' : 'text-red-700')}>
                      {ok == null ? 'no distance' : ok ? 'yes' : 'no'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Trucks in amber: fewer are running than it takes to keep the chopper going at that distance.</p>
      </Card>
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 text-xs text-gray-500">{k}</dt>
      <dd className={cn('min-w-0 flex-1 text-gray-900', strong && 'font-semibold')}>{v}</dd>
    </div>
  )
}
