import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Position } from 'geojson'
import { ArrowDown, ArrowUp, CalendarRange, DoorOpen, History, Info, Trash2, TriangleAlert, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { YearSelect } from '@/components/YearSelect'
import { DateField } from '@/components/DateField'
import { Fold } from '@/components/Fold'
import { InfoPopover } from '@/components/InfoPopover'
import { CardList, RowCard } from '@/components/RowCards'
import { askConfirm } from '@/components/askConfirm'
import { computePasture, computePastures, grazingRain, useGrazingHerd, useGrazingPastures, usePastureFieldContext, usePastureSeasonFactors, useRanchPrecip } from '@/lib/grazing'
import { usePastures } from '@/lib/pastures'
import { mobClass } from '@/lib/pasture-move'
import type { Ranch } from '@/lib/ranches'
import { n0 } from '@/lib/format'
import { TABLE_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'
import {
  addDays,
  auDays,
  grassAumsFromAuDays,
  auDaysByPasture,
  estimateDays,
  eventsToStays,
  gateNotes,
  leaseUse,
  nextStart,
  pairKey,
  restIssues,
  stayDays,
  type CountedStay,
  type GateNote,
} from '@/lib/grazing-plan'
import {
  useActualGrazing,
  useGateMutations,
  useGrazingPlan,
  useLeaseLimits,
  usePastureGates,
  usePastureNeighbours,
  usePastureRest,
  usePlanMutations,
  type PlanRow,
} from '@/lib/grazing-plan-data'
import { PlanMap, type PlanGate, type PlanMove, type PlanStop } from './plan/PlanMap'
import { shortName, stayMonths, type PlanMapPasture } from './plan/plan-geo'
import { PlanTimeline, type TimelineBar } from './plan/PlanTimeline'

const ALL = 'all'
const PALETTE = ['#16a34a', '#2563eb', '#d97706', '#9333ea', '#db2777', '#0891b2', '#65a30d']
const DISMISS_KEY = 'grazing_plan_gate_dismissed'
const CALVES_KEY = 'grazing_plan_calves_at_side'

const readSet = (k: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(k) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
const writeSet = (k: string, s: Set<string>) => {
  try {
    localStorage.setItem(k, JSON.stringify([...s]))
  } catch {
    // Blocked storage: the dismissal lasts until the page is reloaded.
  }
}

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * The grazing planner (Sam, 2 Nov 2026): tap a pasture to add it as the
 * group's next stay; it starts the day the last one ends and runs as long as
 * its grass lasts the group, which is only an estimate and is edited freely.
 * Lease days, rest periods and missing gates are checked as the plan grows —
 * as heads-ups, never as blocks.
 */
export function GrazingPlanner({ isManager, ranch }: { isManager: boolean; ranch: Ranch }) {
  const navigate = useNavigate()
  const thisYear = new Date().getFullYear()
  // From August on, the season worth planning is next year's.
  const [year, setYear] = useState(() => (new Date().getMonth() >= 7 ? thisYear + 1 : thisYear))
  // What actually happened: the plan year once it has started, else this year.
  const actualYear = Math.min(year, thisYear)

  const { data: gps } = useGrazingPastures(ranch.id)
  const { data: herd } = useGrazingHerd(ranch.id)
  const { data: measured } = useRanchPrecip(ranch)
  const { data: mapPastures } = usePastures()
  const { data: rows } = useGrazingPlan(ranch.id, year)
  const { data: gateRows } = usePastureGates()
  const { data: neighbours } = usePastureNeighbours()
  const { data: restDays } = usePastureRest()
  const { data: leases } = useLeaseLimits(ranch.id)
  const { data: actualRows } = useActualGrazing(actualYear)
  const planM = usePlanMutations()
  const gateM = useGateMutations()

  /* ---------------------------------------------------------- pastures */

  const rain = grazingRain(ranch, measured)
  const utilization = ranch.grazing_utilization_rate ?? 0.8
  /*
   * AUDs each pasture grows, crop fields counted for the plan year's season
   * (stubble once harvested).
   *
   * Planning THIS year reads the season as the Grazing tab does: its projected
   * rain, with a paddock's own measured growth in place of it where there is
   * one. Planning another year has no measurement to read and no rain yet, so
   * it goes back to the normal season — which is the right figure for a year
   * that has not happened.
   */
  const { data: factors } = usePastureSeasonFactors(ranch.id)
  const planRain = useMemo(
    () => (year === thisYear ? rain : { forecastMm: rain.forecastMm, projectedMm: null }),
    [year, thisYear, rain],
  )
  const thisYearFactors = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of factors ?? []) if (f.factor != null) m.set(f.grazing_pasture_id, f.factor)
    return m
  }, [factors])
  const factorFor = useMemo(
    () => (year === thisYear ? thisYearFactors : new Map<string, number>()),
    [thisYearFactors, year, thisYear],
  )
  const fieldCtx = usePastureFieldContext(ranch.id, herd)
  const capacity = useMemo(() => {
    const m = new Map<string, number>()
    const season = fieldCtx.season
    const ctx = fieldCtx.ctx({ from: `${year}${season.from.slice(4)}`, to: `${year}${season.to.slice(4)}` })
    for (const c of computePastures(gps ?? [], planRain, utilization, ctx, factorFor)) {
      const pid = (c as unknown as { pasture_id: string | null }).pasture_id
      if (pid) m.set(pid, c.auds)
    }
    return m
  }, [gps, planRain, utilization, fieldCtx, year, factorFor])
  // The Grazing tab's land capacity exactly (this year's season and crops),
  // shown beside a plan for another year: its fields grow other crops (2027's
  // sainfoin grazes all season), so its total differs for a known reason.
  const grazingTabAud = useMemo(
    () =>
      year === thisYear
        ? null
        : computePastures(gps ?? [], rain, utilization, fieldCtx.ctx(), thisYearFactors)
            .reduce((a, c) => a + c.auds, 0),
    [gps, rain, utilization, fieldCtx, year, thisYear, thisYearFactors],
  )
  // The same, for a stay that starts on `start`: a crop field gives only what
  // is there on the day the cattle go in — nothing from a growing corn field
  // in June, its stubble in November.
  const capacityOn = useCallback(
    (pastureId: string, start: string) => {
      const g = (gps ?? []).find((x) => (x as unknown as { pasture_id: string | null }).pasture_id === pastureId)
      if (!g) return capacity.get(pastureId) ?? 0
      return computePasture(
        g,
        factorFor.has(g.id) ? planRain.forecastMm : (planRain.projectedMm ?? planRain.forecastMm),
        utilization,
        fieldCtx.ctx({ from: start, to: start }),
        factorFor.get(g.id) ?? null,
      ).auds
    },
    [gps, planRain, utilization, fieldCtx, capacity, factorFor],
  )

  const pastures = useMemo<PlanMapPasture[]>(
    () =>
      (mapPastures ?? [])
        .filter((p) => capacity.has(p.id) && p.geojson)
        .map((p) => ({ id: p.id, name: p.name, geojson: p.geojson }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en-CA', { numeric: true })),
    [mapPastures, capacity],
  )
  const nameOf = useCallback(
    (id: string) => shortName(pastures.find((p) => p.id === id)?.name ?? (mapPastures ?? []).find((p) => p.id === id)?.name ?? '?'),
    [pastures, mapPastures],
  )

  /* ------------------------------------------------------------ groups */

  const groups = useMemo(() => (herd ?? []).filter((h) => h.head_count > 0), [herd])
  const calves = groups.find((g) => /calf|calves/i.test(g.class_name)) ?? null
  const totalHead = groups.reduce((s, g) => s + g.head_count, 0)
  const totalAU = groups.reduce((s, g) => s + g.head_count * g.au_equivalent, 0)
  const [groupPick, setGroupPick] = useState<string | null>(null)
  const defaultGroup =
    groups.find((g) => /^cows?$/i.test(g.class_name))?.id ??
    [...groups].sort((a, b) => b.head_count * b.au_equivalent - a.head_count * a.au_equivalent)[0]?.id ??
    ALL
  const groupKey = groupPick && (groupPick === ALL || groups.some((g) => g.id === groupPick)) ? groupPick : defaultGroup
  const group = groups.find((g) => g.id === groupKey) ?? null
  const groupId = groupKey === ALL ? null : groupKey

  const [calvesOn, setCalvesOn] = useState(() => {
    try {
      return localStorage.getItem(CALVES_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggleCalves = () =>
    setCalvesOn((v) => {
      try {
        localStorage.setItem(CALVES_KEY, v ? '0' : '1')
      } catch {
        // Blocked storage: the switch still works for this visit.
      }
      return !v
    })

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const isCows = (g: { class_name: string } | null | undefined) => !!g && /cow/i.test(g.class_name)
  // Calves at side graze with the cows but are their own group on the Herd
  // tab; their AUs ride along with a cow stay when the switch is on.
  const calfAuPerCow = (cows: { head_count: number }) =>
    calvesOn && calves && cows.head_count > 0 ? (calves.head_count * calves.au_equivalent) / cows.head_count : 0

  /** Head and AUs per head for a planned stay. */
  const stayFigures = useCallback(
    (r: Pick<PlanRow, 'herd_count_id' | 'head_count'>) => {
      const g = r.herd_count_id ? groupById.get(r.herd_count_id) : null
      const baseHead = g ? g.head_count : totalHead
      const head = r.head_count ?? baseHead
      const au = g ? g.au_equivalent + (isCows(g) ? calfAuPerCow(g) : 0) : totalHead > 0 ? totalAU / totalHead : 0
      return { head, au }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupById, totalHead, totalAU, calvesOn, calves],
  )

  /* -------------------------------------------------------------- plan */

  const allRows = useMemo(() => rows ?? [], [rows])
  const steps = useMemo(
    () =>
      allRows
        .filter((r) => (r.herd_count_id ?? null) === groupId)
        .sort((a, b) => a.sort_order - b.sort_order || a.start_date.localeCompare(b.start_date)),
    [allRows, groupId],
  )
  const counted = useMemo<(CountedStay & { id: string })[]>(
    () =>
      allRows.map((r) => {
        const f = stayFigures(r)
        return { id: r.id, pasture_id: r.pasture_id, start_date: r.start_date, end_date: r.end_date, head: f.head, au_per_head: f.au }
      }),
    [allRows, stayFigures],
  )
  const plannedAud = useMemo(() => auDaysByPasture(counted), [counted])

  const turnoutDefault = group?.graze_start ? `${year}${group.graze_start.slice(4, 10)}` : `${year}-05-01`
  const [turnoutPick, setTurnoutPick] = useState<string | null>(null)
  const turnout = steps[0]?.start_date ?? (turnoutPick?.startsWith(String(year)) ? turnoutPick : turnoutDefault)

  const newStayAu = stayFigures({ herd_count_id: groupId, head_count: null })
  const [selected, setSelected] = useState<string | null>(null)

  const addStay = (pastureId: string) => {
    setSelected(pastureId)
    if (!isManager) return
    const start = nextStart(steps, turnout)
    const left = capacityOn(pastureId, start) - (plannedAud.get(pastureId) ?? 0)
    const days = estimateDays(left, newStayAu.head * newStayAu.au) ?? 14
    planM.add.mutate([
      {
        ranch_id: ranch.id,
        plan_year: year,
        herd_count_id: groupId,
        pasture_id: pastureId,
        start_date: start,
        end_date: addDays(start, days),
        sort_order: (steps.at(-1)?.sort_order ?? 0) + 1,
      },
    ])
  }

  const patch = (changes: { id: string; patch: Partial<PlanRow> }[]) => {
    if (changes.length) planM.update.mutate(changes)
  }
  const setEnd = (r: PlanRow, v: string) => {
    if (v && v >= r.start_date && v !== r.end_date) patch([{ id: r.id, patch: { end_date: v } }])
  }
  const setStart = (r: PlanRow, v: string) => {
    if (!v || v === r.start_date) return
    patch([{ id: r.id, patch: { start_date: v, end_date: addDays(v, stayDays(r)) } }])
  }
  /** Close every gap after stay `i`, keeping each stay's length. */
  const shiftFrom = (i: number) => {
    const out: { id: string; patch: Partial<PlanRow> }[] = []
    let prevEnd = steps[i].end_date
    for (let j = i + 1; j < steps.length; j++) {
      const s = steps[j]
      const end = addDays(prevEnd, stayDays(s))
      if (s.start_date !== prevEnd || s.end_date !== end) out.push({ id: s.id, patch: { start_date: prevEnd, end_date: end } })
      prevEnd = end
    }
    patch(out)
  }
  /** Swap a stay with its neighbour; the dates follow the new order from the first start. */
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const order = [...steps]
    ;[order[i], order[j]] = [order[j], order[i]]
    let start = steps[0].start_date
    const out: { id: string; patch: Partial<PlanRow> }[] = []
    order.forEach((s, k) => {
      const end = addDays(start, stayDays(s))
      out.push({ id: s.id, patch: { sort_order: k + 1, start_date: start, end_date: end } })
      start = end
    })
    patch(out)
  }
  const remove = (r: PlanRow) => planM.remove.mutate([r.id])
  const setHead = (r: PlanRow, v: string) => {
    const base = stayFigures({ herd_count_id: r.herd_count_id, head_count: null }).head
    const n = v === '' ? null : Math.max(0, Math.round(Number(v)))
    const next = n == null || n === base ? null : n
    if (next !== r.head_count) patch([{ id: r.id, patch: { head_count: next } }])
  }
  const clearPlan = async () => {
    if (await askConfirm(`Clear the ${year} plan for ${group?.class_name ?? 'the whole herd'}? ${steps.length} stays.`, { confirmLabel: 'Clear' }))
      planM.remove.mutate(steps.map((s) => s.id))
  }

  /* ---------------------------------------------------------- checks */

  const gateSet = useMemo(() => new Set((gateRows ?? []).map((g) => pairKey(g.pasture_a, g.pasture_b))), [gateRows])
  const [dismissed, setDismissed] = useState(() => readSet(DISMISS_KEY))
  const dismiss = (k: string) => {
    const s = new Set(dismissed)
    s.add(k)
    writeSet(DISMISS_KEY, s)
    setDismissed(s)
  }
  const gateByIndex = useMemo(() => {
    const m = new Map<number, GateNote>()
    for (const n of gateNotes(
      steps.map((s) => s.pasture_id),
      gateSet,
      neighbours ?? new Set(),
    ))
      if (!dismissed.has(pairKey(n.from, n.to))) m.set(n.index, n)
    return m
  }, [steps, gateSet, neighbours, dismissed])
  const addGate = (a: string, b: string, at?: Position) =>
    gateM.add.mutate({ a, b, at: at ? [at[0], at[1]] : null, note: 'Marked on the grazing planner' })

  const rest = useMemo(() => restIssues(allRows, (id) => restDays?.get(id) ?? 0), [allRows, restDays])

  const leaseOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of leases ?? []) for (const p of l.pasture_ids) m.set(p, l.disposition_no)
    return m
  }, [leases])

  /* ------------------------------------------------------- actual use */

  const ranchPastures = useMemo(() => new Set(capacity.keys()), [capacity])
  const actual = useMemo(() => (actualRows ?? []).filter((r) => ranchPastures.has(r.pasture_id)), [actualRows, ranchPastures])
  const actualCounted = useMemo<CountedStay[]>(() => {
    const byClass = new Map(groups.map((g) => [g.class_name.toLowerCase(), g]))
    return actual.map((r) => {
      const cls = r.mob ? mobClass(r.mob) : null
      const g = cls ? byClass.get(cls.toLowerCase()) : undefined
      const au = g
        ? g.au_equivalent + (isCows(g) ? calfAuPerCow(g) : 0)
        : r.avg_animal_weight_lb
          ? r.avg_animal_weight_lb / 1000
          : 1
      return {
        pasture_id: r.pasture_id,
        start_date: r.turned_in_on,
        end_date: r.moved_out_on ?? r.turned_in_on,
        head: r.head_count ?? 0,
        au_per_head: au,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual, groups, calvesOn, calves])
  const actualAud = useMemo(() => auDaysByPasture(actualCounted), [actualCounted])

  const leaseRows = useMemo(
    () =>
      (leases ?? [])
        .filter((l) => l.pasture_ids.length)
        .map((l) => ({ plan: leaseUse(l, counted, year), actual: leaseUse(l, actualCounted, actualYear) })),
    [leases, counted, actualCounted, year, actualYear],
  )
  const unlinkedLeases = (leases ?? []).filter((l) => !l.pasture_ids.length).length

  /** This group's moves last year (or this year), ready to copy into the plan. */
  const copyable = useMemo(() => {
    const want = group ? group.class_name.toLowerCase() : 'cows'
    const mine = actual.filter((r) => r.mob && mobClass(r.mob).toLowerCase() === want)
    return eventsToStays(mine)
  }, [actual, group])
  const copyActual = () => {
    const shift = (d: string) => `${year}${d.slice(4)}`
    planM.add.mutate(
      copyable.map((s, i) => ({
        ranch_id: ranch.id,
        plan_year: year,
        herd_count_id: groupId,
        pasture_id: s.pasture_id,
        start_date: shift(s.start_date),
        end_date: shift(s.end_date) < shift(s.start_date) ? shift(s.start_date) : shift(s.end_date),
        sort_order: i + 1,
        notes: `From ${actualYear}'s moves`,
      })),
    )
  }

  /* ----------------------------------------------------------- display */

  // What goes on each pasture: its step number and the month the cattle are
  // in it, so the route round the farm reads off the map, not off the chart.
  const stops = useMemo(() => {
    const m = new Map<string, PlanStop[]>()
    steps.forEach((s, i) =>
      m.set(s.pasture_id, [...(m.get(s.pasture_id) ?? []), { step: i + 1, months: stayMonths(s.start_date, s.end_date) }]),
    )
    return m
  }, [steps])
  /** Where each recorded gate is, by pasture pair. */
  const gateAt = useMemo(() => {
    const m = new Map<string, Position>()
    for (const g of gateRows ?? []) {
      const c = (g.gate_geom as { coordinates?: number[] } | null)?.coordinates
      if (c) m.set(pairKey(g.pasture_a, g.pasture_b), [c[0], c[1]])
    }
    return m
  }, [gateRows])
  /** Each move, and the gate it goes through where one is recorded. */
  const moves = useMemo<PlanMove[]>(
    () =>
      steps
        .slice(1)
        .map((s, i) => ({ from: steps[i].pasture_id, to: s.pasture_id, via: gateAt.get(pairKey(steps[i].pasture_id, s.pasture_id)) ?? null }))
        .filter((m) => m.from !== m.to),
    [steps, gateAt],
  )
  /** Step numbers each gate is used to reach: 'to 4', 'to 4 · 7'. */
  const gateMoves = useMemo(() => {
    const m = new Map<string, number[]>()
    steps.slice(1).forEach((s, i) => {
      const from = steps[i].pasture_id
      if (from === s.pasture_id) return
      const k = pairKey(from, s.pasture_id)
      if (gateAt.has(k)) m.set(k, [...(m.get(k) ?? []), i + 2])
    })
    return m
  }, [steps, gateAt])
  const gatePins = useMemo<PlanGate[]>(
    () =>
      (gateRows ?? [])
        .map((g) => {
          const c = (g.gate_geom as { coordinates?: number[] } | null)?.coordinates
          if (!c) return null
          const used = gateMoves.get(pairKey(g.pasture_a, g.pasture_b))
          return { at: [c[0], c[1]] as Position, label: g.note ?? '', used: !!used, move: used ? `to ${used.join(' · ')}` : '' }
        })
        .filter((g): g is PlanGate => !!g),
    [gateRows, gateMoves],
  )
  /** Moves whose line had to run straight across the fence: no gate position. */
  const gatelessMoves = useMemo(() => moves.filter((m) => !m.via), [moves])
  const colourOf = (id: string | null) => {
    if (!id) return PALETTE[0]
    const i = groups.findIndex((g) => g.id === id)
    return PALETTE[(i + 1) % PALETTE.length]
  }
  const groupName = (id: string | null) => (id ? (groupById.get(id)?.class_name ?? 'Group') : 'Whole herd')
  const bars: TimelineBar[] = allRows.map((r) => ({
    pasture_id: r.pasture_id,
    start_date: r.start_date,
    end_date: r.end_date,
    colour: colourOf(r.herd_count_id),
    title: `${groupName(r.herd_count_id)} in ${nameOf(r.pasture_id)}: ${fmt(r.start_date)} to ${fmt(r.end_date)} (${stayDays(r)} days)`,
    strong: (r.herd_count_id ?? null) === groupId,
  }))
  const timelineRows = pastures.map((p) => ({ id: p.id, name: shortName(p.name), min_rest_days: restDays?.get(p.id) ?? 0 }))
  const actualBars = actual
    .filter((a) => a.turned_in_on.startsWith(String(year)))
    .map((a) => ({ pasture_id: a.pasture_id, start_date: a.turned_in_on, end_date: a.moved_out_on ?? a.turned_in_on }))

  const totalDays = steps.length ? Math.max(0, stayDays({ start_date: steps[0].start_date, end_date: steps.at(-1)!.end_date })) : 0
  const groupAuDay = newStayAu.head * newStayAu.au
  const [gateMode, setGateMode] = useState(false)
  const pickFence = async (pair: [string, string], at: Position) => {
    if (gateSet.has(pairKey(pair[0], pair[1]))) {
      await askConfirm(`${nameOf(pair[0])} and ${nameOf(pair[1])} already have a gate recorded.`, { confirmLabel: 'OK', title: 'Gate' })
      return
    }
    if (await askConfirm(`Add a gate between ${nameOf(pair[0])} and ${nameOf(pair[1])} here?`, { confirmLabel: 'Add gate', title: 'Mark a gate' }))
      addGate(pair[0], pair[1], at)
  }

  const yearOptions = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2]
  const groupOptions = [
    ...groups.map((g) => ({ value: g.id, label: `${g.class_name} (${n0(g.head_count)})` })),
    { value: ALL, label: `Whole herd (${n0(totalHead)})` },
  ]

  if (gps && capacity.size === 0)
    return (
      <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
        {ranch.name} has no pastures drawn yet. Draw them on the Map tab, then plan here.
      </p>
    )

  return (
    <div className="space-y-4">
      {/* Pickers */}
      <div className="flex flex-wrap items-center gap-2">
        <YearSelect value={year} years={yearOptions} onChange={setYear} size="sm" className="w-24" ariaLabel="Plan year" />
        <Select
          value={groupKey}
          options={groupOptions}
          onChange={setGroupPick}
          size="sm"
          className="w-52"
          ariaLabel="Herd group"
        />
        {isCows(group) && calves && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={calvesOn} onChange={toggleCalves} />
            calves at side
          </label>
        )}
        {!steps.length && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Turnout
            <DateField value={turnout} onChange={(v) => v && setTurnoutPick(v)} ariaLabel="Turnout date" className="w-36" />
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isManager && (
            <button
              onClick={() => setGateMode((g) => !g)}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium',
                gateMode ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              )}
              aria-pressed={gateMode}
            >
              <DoorOpen className="h-3.5 w-3.5" /> {gateMode ? 'Tap a fence…' : 'Mark a gate'}
            </button>
          )}
          <InfoPopover title="How the planner works">
            <p>Tap a pasture to add it as the group&apos;s next stay. It starts the day the last stay ends.</p>
            <p>
              The end date is an estimate: the grass the pasture grows in a normal season (the Grazing tab&apos;s AUDs, less
              what earlier stays this year eat) divided by the group&apos;s animal units a day. Change it to whatever you
              intend; regrowth is not counted.
            </p>
            <p>
              Lease days count each day cattle are on a lease once, whichever groups. Lease AUMs are head × AU × days ÷ 30.4.
              Allowed days and the season are set per lease on the Grazing leases tab.
            </p>
            <p>
              Orange dots are gates; the yellow ones are the gates this plan goes through, labelled with the stay they lead to, and the
              move line runs through them. A move between pastures with no gate recorded gets a heads-up only — it never blocks.
            </p>
            <p>
              On the season chart the hatched band after a stay is the pasture&apos;s minimum rest — the days it is too soon to graze
              again. It is the rest each pasture is recorded as wanting, not a scheduled state — going back in before it ends turns the
              bar red.
            </p>
          </InfoPopover>
        </div>
      </div>

      {/* Lease limits: the one thing that can actually cost money. */}
      {(leaseRows.length > 0 || unlinkedLeases > 0) && (
        <div className="flex flex-wrap gap-2">
          {leaseRows.map(({ plan: u }) => {
            const over = u.over_days || u.over_aums
            const cap = u.lease.capacity_aum ?? u.lease.billable_aum
            return (
              <div
                key={u.lease.id}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs',
                  over ? 'border-red-200 bg-red-50 text-red-900' : u.outside_season.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-700',
                )}
              >
                <p className="font-semibold">
                  Lease {u.lease.disposition_no}:{' '}
                  {u.lease.max_grazing_days != null ? (
                    <>
                      {u.days} of {u.lease.max_grazing_days} allowed days
                      <span className="font-normal">
                        {' '}
                        · {u.remaining_days! >= 0 ? `${u.remaining_days} left` : `${-u.remaining_days!} over`}
                      </span>
                    </>
                  ) : (
                    <>{u.days} days planned</>
                  )}
                </p>
                <p className="mt-0.5">
                  {n0(u.aums)}
                  {cap != null ? ` of ${n0(cap)}` : ''} animal-unit months (AUM)
                  {u.outside_season.length > 0 && ` · ${u.outside_season.length} stay${u.outside_season.length === 1 ? '' : 's'} outside the season`}
                </p>
              </div>
            )
          })}
          {unlinkedLeases > 0 && (
            <button
              onClick={() => navigate('/cattle-markets?tab=leases')}
              className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-left text-xs text-gray-500 hover:border-brand-300 hover:text-brand-700"
            >
              {unlinkedLeases} lease{unlinkedLeases === 1 ? ' has' : 's have'} no pastures linked — set them up
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Map */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <PlanMap
            pastures={pastures}
            stops={stops}
            selectedPasture={selected}
            gates={gatePins}
            moves={moves}
            gateMode={gateMode}
            onPickPasture={addStay}
            onPickFence={(pair, at) => void pickFence(pair, at)}
            className="h-[340px] w-full sm:h-[460px] lg:h-[560px]"
          />
          <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
            {gateMode
              ? 'Tap the fence between two pastures to record a gate there.'
              : isManager
                ? `Tap a pasture to add it as stay ${steps.length + 1}, from ${fmt(nextStart(steps, turnout))}.`
                : 'Each pasture shows its step number and the month the cattle are in it.'}
          </p>
          {gatelessMoves.length > 0 && (
            <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-amber-800">
              Drawn straight across the fence, no gate marked:{' '}
              {gatelessMoves.map((m) => `${nameOf(m.from)}→${nameOf(m.to)}`).join(', ')}.
            </p>
          )}
        </div>

        {/* The stays, in order */}
        <section className="rounded-lg border border-gray-200 bg-white lg:flex lg:max-h-[600px] lg:flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-1 border-b border-gray-100 px-3 py-2">
            <h2 className="text-sm font-semibold text-gray-900">
              {group?.class_name ?? 'Whole herd'} · {year}
            </h2>
            <span className="text-[11px] text-gray-500">
              {steps.length
                ? `${steps.length} stay${steps.length === 1 ? '' : 's'} · ${fmt(steps[0].start_date)} – ${fmt(steps.at(-1)!.end_date)} · ${totalDays} days`
                : `${n0(groupAuDay)} AU a day`}
            </span>
          </div>
          <ol className="divide-y divide-gray-100 lg:flex-1 lg:overflow-y-auto">
            {steps.length === 0 && (
              <li className="space-y-2 px-3 py-6 text-center text-sm text-gray-400">
                <p>No stays yet. Tap a pasture on the map to start.</p>
                {isManager && copyable.length > 0 && (
                  <button
                    onClick={copyActual}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <History className="h-3.5 w-3.5" /> Start from {actualYear}&apos;s moves ({copyable.length})
                  </button>
                )}
              </li>
            )}
            {steps.map((s, i) => {
              const f = stayFigures(s)
              const days = stayDays(s)
              const used = auDays(f.head, f.au, days)
              const cap = capacity.get(s.pasture_id) ?? 0
              const plannedHere = plannedAud.get(s.pasture_id) ?? 0
              const est = estimateDays(capacityOn(s.pasture_id, s.start_date) - (plannedHere - used), f.head * f.au)
              const gate = gateByIndex.get(i)
              const restHit = rest.find((r) => r.pasture_id === s.pasture_id && r.back_on === s.start_date)
              const next = steps[i + 1]
              const gapAfter = next && next.start_date !== s.end_date
              const lease = leaseOf.get(s.pasture_id)
              const overGrass = plannedHere > cap * 1.0001 && cap > 0
              return (
                <li key={s.id} className={cn('px-3 py-2.5', selected === s.pasture_id && 'bg-yellow-50/60')}>
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => setSelected(s.pasture_id)}
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: colourOf(s.herd_count_id) }}
                      aria-label={`Show ${nameOf(s.pasture_id)} on the map`}
                    >
                      {i + 1}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-semibold text-gray-900">{nameOf(s.pasture_id)}</span>
                        <span className="text-xs tabular-nums text-gray-600">{days} days</span>
                        {est != null && est !== days && (
                          <span className="text-[11px] text-gray-400" title="Days the grass would last this group, an estimate">
                            grass for ~{est}
                          </span>
                        )}
                        {lease && (
                          <span className="rounded bg-sky-50 px-1.5 text-[10px] font-medium text-sky-700">Lease {lease}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {isManager ? (
                          <>
                            <DateField value={s.start_date} onChange={(v) => setStart(s, v)} ariaLabel={`Stay ${i + 1} start`} className="w-[8.5rem]" />
                            <span className="text-gray-400">→</span>
                            <DateField
                              value={s.end_date}
                              onChange={(v) => setEnd(s, v)}
                              min={s.start_date}
                              ariaLabel={`Stay ${i + 1} end`}
                              className="w-[8.5rem]"
                            />
                            <label className="flex items-center gap-1 text-[11px] text-gray-500">
                              head
                              <input
                                key={`${s.id}-${s.head_count}`}
                                type="number"
                                min="0"
                                inputMode="numeric"
                                defaultValue={s.head_count ?? ''}
                                placeholder={String(stayFigures({ herd_count_id: s.herd_count_id, head_count: null }).head)}
                                onBlur={(e) => setHead(s, e.target.value)}
                                className="w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right text-xs tabular-nums"
                                aria-label={`Stay ${i + 1} head`}
                              />
                            </label>
                          </>
                        ) : (
                          <span className="text-xs text-gray-600">
                            {fmt(s.start_date)} → {fmt(s.end_date)} · {n0(f.head)} head
                          </span>
                        )}
                      </div>
                      <p className={cn('mt-1 text-[11px]', overGrass ? 'font-medium text-red-700' : 'text-gray-500')}>
                        Uses {n0(grassAumsFromAuDays(used))} AUM · pasture {n0(grassAumsFromAuDays(plannedHere))} of {n0(grassAumsFromAuDays(cap))} planned
                      </p>
                      {restHit && (
                        <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-red-700">
                          <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                          Back after {restHit.rest_days} days&apos; rest — {nameOf(s.pasture_id)} wants {restHit.min_rest_days}.
                        </p>
                      )}
                      {gate && (
                        <div
                          className={cn(
                            'mt-1 flex items-start gap-1.5 rounded-md px-2 py-1 text-[11px]',
                            gate.kind === 'no-gate' ? 'bg-amber-50 text-amber-900' : 'bg-sky-50 text-sky-900',
                          )}
                        >
                          {gate.kind === 'no-gate' ? <DoorOpen className="mt-px h-3 w-3 shrink-0" /> : <Info className="mt-px h-3 w-3 shrink-0" />}
                          <span className="flex-1">
                            {gate.kind === 'no-gate'
                              ? `No gate recorded between ${nameOf(gate.from)} and ${nameOf(gate.to)}.`
                              : `${nameOf(gate.from)} and ${nameOf(gate.to)} don't touch — moving across other pastures?`}
                          </span>
                          {gate.kind === 'no-gate' && isManager && (
                            <button onClick={() => addGate(gate.from, gate.to)} className="font-semibold underline">
                              Add gate
                            </button>
                          )}
                          <button onClick={() => dismiss(pairKey(gate.from, gate.to))} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    {isManager && (
                      <div className="flex shrink-0 flex-col items-center">
                        <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30" aria-label={`Move stay ${i + 1} up`}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30" aria-label={`Move stay ${i + 1} down`}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => remove(s)} className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600" aria-label={`Remove stay ${i + 1}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  {gapAfter && isManager && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
                      <CalendarRange className="h-3.5 w-3.5 text-gray-400" />
                      <span className="flex-1">
                        Next stay starts {fmt(next.start_date)}, not {fmt(s.end_date)}.
                      </span>
                      <button onClick={() => shiftFrom(i)} className="rounded border border-brand-200 bg-white px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-50">
                        Shift the rest
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
          {isManager && steps.length > 0 && (
            <div className="flex justify-end border-t border-gray-100 px-3 py-1.5">
              <button onClick={() => void clearPlan()} className="text-[11px] font-medium text-gray-400 hover:text-red-600">
                Clear this plan
              </button>
            </div>
          )}
        </section>
      </div>

      {/* The season */}
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
          <h2 className="text-sm font-semibold text-gray-900">Season {year}</h2>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            {[...new Set(allRows.map((r) => r.herd_count_id ?? null))].map((id) => (
              <span key={id ?? 'all'} className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colourOf(id) }} />
                {groupName(id)}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(45deg,#d1d5db_0_3px,transparent_3px_6px)]" /> too
              soon to graze again
            </span>
            {actualBars.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-1 w-4 rounded-full bg-gray-500" /> grazed
              </span>
            )}
          </span>
        </div>
        {rest.length > 0 && (
          <p className="mb-2 flex items-center gap-1 text-xs font-medium text-red-700">
            <TriangleAlert className="h-3.5 w-3.5" />
            {rest.map((r) => `${nameOf(r.pasture_id)} back on ${fmt(r.back_on)} after ${r.rest_days} of ${r.min_rest_days} days' rest`).join(' · ')}
          </p>
        )}
        <PlanTimeline year={year} rows={timelineRows} bars={bars} actual={actualBars} rest={rest} />
      </section>

      {/* Grass used vs grown — a check, not a daily screen. */}
      <Fold
        title="Grass used vs available"
        summary={
          `Planned ${n0(grassAumsFromAuDays([...plannedAud.values()].reduce((a, b) => a + b, 0)))} of ${n0(grassAumsFromAuDays([...capacity.values()].reduce((a, b) => a + b, 0)))} animal-unit months` +
          (grazingTabAud != null ? ` on ${year}'s crops · ${n0(grassAumsFromAuDays(grazingTabAud))} on ${thisYear}'s, as on Grazing` : '')
        }
        storageKey="grazing-plan-grass"
      >
        <GrassTable
          pastures={pastures.map((p) => ({
            id: p.id,
            name: shortName(p.name),
            available: grassAumsFromAuDays(capacity.get(p.id) ?? 0),
            planned: grassAumsFromAuDays(plannedAud.get(p.id) ?? 0),
            grazed: grassAumsFromAuDays(actualAud.get(p.id) ?? 0),
            lease: leaseOf.get(p.id) ?? null,
          }))}
          leases={leaseRows.map((l) => ({
            id: l.plan.lease.id,
            name: l.plan.lease.disposition_no,
            capacity: l.plan.lease.capacity_aum,
            billable: l.plan.lease.billable_aum,
            planned: l.plan.aums,
            grazed: l.actual.aums,
          }))}
          year={year}
          actualYear={actualYear}
        />
      </Fold>
    </div>
  )
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '')

function GrassTable({
  pastures,
  leases,
  year,
  actualYear,
}: {
  pastures: { id: string; name: string; available: number; planned: number; grazed: number; lease: string | null }[]
  leases: { id: string; name: string; capacity: number | null; billable: number | null; planned: number; grazed: number }[]
  year: number
  actualYear: number
}) {
  const used = (a: number, of: number) => (
    <span className={cn('tabular-nums', of > 0 && a > of ? 'font-semibold text-red-700' : '')}>
      {n0(a)} <span className="text-gray-400">{pct(a, of)}</span>
    </span>
  )
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="hidden w-full text-sm sm:table">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-2 py-2 font-medium">Pasture</th>
              <th className="px-2 py-2 text-right font-medium" title="A normal season's grass after utilization">Grows, AUM</th>
              <th className="px-2 py-2 text-right font-medium">Planned {year}</th>
              <th className="px-2 py-2 text-right font-medium">Grazed {actualYear}</th>
            </tr>
          </thead>
          <tbody>
            {pastures.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0">
                <td className="px-2 py-1.5 font-medium text-gray-800">
                  {p.name}
                  {p.lease && <span className="ml-1.5 text-[10px] font-normal text-sky-700">{p.lease}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{n0(p.available)}</td>
                <td className="px-2 py-1.5 text-right">{used(p.planned, p.available)}</td>
                <td className="px-2 py-1.5 text-right">{used(p.grazed, p.available)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <CardList>
          {pastures.map((p) => (
            <RowCard
              key={p.id}
              heading={
                <>
                  {p.name}
                  {p.lease && <span className="ml-1.5 text-[10px] font-normal text-sky-700">{p.lease}</span>}
                </>
              }
              facts={[
                { label: 'Grows, AUM', node: n0(p.available) },
                { label: `Planned ${year}`, node: used(p.planned, p.available) },
                { label: `Grazed ${actualYear}`, node: used(p.grazed, p.available) },
              ]}
            />
          ))}
        </CardList>
      </div>
      {leases.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="hidden w-full text-sm sm:table">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-2 py-2 font-medium">Lease</th>
                <th className="px-2 py-2 text-right font-medium">Capacity AUM</th>
                <th className="px-2 py-2 text-right font-medium">Billable AUM</th>
                <th className="px-2 py-2 text-right font-medium">Planned {year}</th>
                <th className="px-2 py-2 text-right font-medium">Grazed {actualYear}</th>
              </tr>
            </thead>
            <tbody>
              {leases.map((l) => (
                <tr key={l.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-1.5 font-medium text-gray-800">{l.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(l.capacity)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(l.billable)}</td>
                  <td className="px-2 py-1.5 text-right">{used(l.planned, l.capacity ?? l.billable ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right">{used(l.grazed, l.capacity ?? l.billable ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <CardList>
            {leases.map((l) => (
              <RowCard
                key={l.id}
                heading={l.name}
                facts={[
                  { label: 'Capacity AUM', node: n0(l.capacity) },
                  { label: 'Billable AUM', node: n0(l.billable) },
                  { label: `Planned ${year}`, node: used(l.planned, l.capacity ?? l.billable ?? 0) },
                  { label: `Grazed ${actualYear}`, node: used(l.grazed, l.capacity ?? l.billable ?? 0) },
                ]}
              />
            ))}
          </CardList>
        </div>
      )}
    </div>
  )
}
