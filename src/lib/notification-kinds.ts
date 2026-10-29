/**
 * Every kind of notification, filed under the headings My account →
 * Notifications shows them in. One switch per label: kinds that read the same
 * in the list (two allotment kinds, two fertilizer-price kinds) share a
 * switch, and a kind's switch covers all of them. Pure, so the settings card
 * and the tests share one copy. A new kind goes in KIND_LABELS and one group
 * here; a test fails if it is missing from either.
 */
import { KIND_DESCRIPTIONS, KIND_LABELS } from './notification-format'

export const NOTIFICATION_GROUPS = [
  { key: 'tasks', label: 'Tasks', kinds: ['task_assigned', 'task_completed', 'task_reminder', 'service_due', 'truck_inspection', 'monday_brief'] },
  {
    key: 'water',
    label: 'Irrigation & water',
    kinds: [
      'irrigation',
      'fieldnet_fault',
      'fieldnet_behind',
      'fieldnet_offline',
      'aimm_change',
      'river_release',
      'water_allotment',
      'smrid_allotment',
      'smrid_rate',
      'water_quality',
      'water_quality_request',
    ],
  },
  { key: 'weather', label: 'Weather & frost', kinds: ['crop_weather', 'winterizing_freeze'] },
  { key: 'crops', label: 'Crops & fields', kinds: ['spray_rotation_conflict', 'jd_boundary', 'combine_out_of_date', 'lease'] },
  { key: 'bins', label: 'Bins', kinds: ['bin_needs_air', 'seed_bin_check'] },
  { key: 'cattle', label: 'Cattle & grazing', kinds: ['grazing_restriction', 'grazing_conflict', 'pasture_move', 'stock_return'] },
  {
    key: 'markets',
    label: 'Markets & prices',
    kinds: ['market_alert', 'fert_buy_window', 'n_ratio_moved', 'fert_deadline', 'ab_input_prices', 'grant_new'],
  },
  { key: 'app', label: 'Integrations & app', kinds: ['integration_alert', 'fuel_gauge_silent', 'app_notice', 'fixer_stuck'] },
] as const satisfies readonly { key: string; label: string; kinds: readonly string[] }[]

/**
 * Kinds whose silence can cost something: switching one off is allowed, but
 * the switch carries this warning.
 */
export const SAFETY_WARNINGS: Record<string, string> = {
  fieldnet_fault: "You won't hear about pivot faults",
  integration_alert: "You won't hear when a data feed stops",
  winterizing_freeze: "You won't hear about a hard freeze before winterizing is done",
}

/** Never switched off: the "send test" button's own kind. */
export const ALWAYS_SENT = ['test']

/**
 * Pushed the moment they happen, through quiet hours and never into the daily
 * digest: their whole point is the timing. The database keeps the same list
 * (fn_notification_urgent, 20261016030000_quiet_hours_digest.sql); a test
 * fails if the two differ.
 */
export const URGENT_KINDS = ['winterizing_freeze', 'fieldnet_fault', 'crop_weather', 'grazing_conflict']

/** The morning digest's own notification: raised by the digest job, never a switch of its own. */
export const DIGEST_KIND = 'digest'

/**
 * Non-urgent kinds offered for the digest by the "Use for…" button: price
 * reports, grants and data-feed problems. Only a suggestion; every kind
 * starts as right away.
 */
export const DIGEST_SUGGESTED = ['fert_buy_window', 'n_ratio_moved', 'ab_input_prices', 'smrid_rate', 'grant_new', 'integration_alert']

export type Delivery = 'now' | 'digest'
export type PrefRow = { kind: string; in_app: boolean; push: boolean; delivery: Delivery }
export type Channel = 'in_app' | 'push'

export const isUrgent = (kind: string): boolean => URGENT_KINDS.includes(kind)

/** One switch: a label in a group, and every kind it covers. */
export type PrefSwitch = { label: string; description: string | null; kinds: string[]; warning: string | null; urgent: boolean }

/** A group's switches, one per distinct label, in the group's order. */
export function groupSwitches(kinds: readonly string[]): PrefSwitch[] {
  const byLabel = new Map<string, PrefSwitch>()
  for (const kind of kinds) {
    const label = KIND_LABELS[kind] ?? kind
    const s = byLabel.get(label) ?? { label, description: KIND_DESCRIPTIONS[kind] ?? null, kinds: [], warning: null, urgent: false }
    s.kinds.push(kind)
    s.warning ??= SAFETY_WARNINGS[kind] ?? null
    s.urgent ||= isUrgent(kind)
    byLabel.set(label, s)
  }
  return [...byLabel.values()]
}

/**
 * Whether a person gets `kind` on `channel`. No row is on: nobody stops
 * getting an alert because they never opened settings. Push needs the
 * notification itself, so in-app off is push off too (the database skips the
 * row, and with it the push).
 */
export function prefOn(prefs: readonly PrefRow[] | undefined, kind: string, channel: Channel): boolean {
  if (ALWAYS_SENT.includes(kind)) return true
  const row = prefs?.find((p) => p.kind === kind)
  if (!row) return true
  if (!row.in_app) return false
  return channel === 'in_app' ? true : row.push
}

/** A switch covering several kinds reads on only when every one of them is. */
export function switchOn(prefs: readonly PrefRow[] | undefined, kinds: readonly string[], channel: Channel): boolean {
  return kinds.every((k) => prefOn(prefs, k, channel))
}

/**
 * The rows to save when a switch flips: one per kind, keeping the other
 * channel as it was. Turning in-app back on leaves push as it was saved.
 */
export function rowsFor(
  prefs: readonly PrefRow[] | undefined,
  kinds: readonly string[],
  channel: Channel,
  on: boolean,
): PrefRow[] {
  return kinds.map((kind) => {
    const row = prefs?.find((p) => p.kind === kind)
    const current: PrefRow = { kind, in_app: row?.in_app ?? true, push: row?.push ?? true, delivery: row?.delivery ?? 'now' }
    return { ...current, [channel]: on }
  })
}

/** How a kind's push arrives: right away (no row, or urgent) or in the daily digest. */
export function deliveryOf(prefs: readonly PrefRow[] | undefined, kind: string): Delivery {
  if (isUrgent(kind) || ALWAYS_SENT.includes(kind)) return 'now'
  return prefs?.find((p) => p.kind === kind)?.delivery ?? 'now'
}

/** A switch covering several kinds reads "digest" only when every one of them is. */
export function switchDelivery(prefs: readonly PrefRow[] | undefined, kinds: readonly string[]): Delivery {
  return kinds.every((k) => deliveryOf(prefs, k) === 'digest') ? 'digest' : 'now'
}

/** The rows to save when a delivery choice changes, keeping both switches. Urgent kinds stay right away. */
export function rowsForDelivery(prefs: readonly PrefRow[] | undefined, kinds: readonly string[], delivery: Delivery): PrefRow[] {
  return kinds
    .filter((k) => !isUrgent(k))
    .map((kind) => {
      const row = prefs?.find((p) => p.kind === kind)
      return { kind, in_app: row?.in_app ?? true, push: row?.push ?? true, delivery }
    })
}

/** Every kind with a switch. */
export const SWITCHED_KINDS: string[] = NOTIFICATION_GROUPS.flatMap((g) => [...g.kinds])
