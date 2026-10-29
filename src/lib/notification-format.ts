/**
 * How a notification reads in a list: a short label for its kind, when it
 * arrived, and where tapping it goes. Pure, so the bell, the Notifications page and
 * the tests share one copy.
 */

/** Where the bell's and the Notifications page's settings buttons go: My account → Notifications. */
export const NOTIFICATION_SETTINGS_PATH = '/settings/account?tab=notifications'

/** Short labels, the grey "<what kind> · <date>" line under each item. */
export const KIND_LABELS: Record<string, string> = {
  integration_alert: 'Data feed problem',
  aimm_change: 'AIMM data changed',
  fieldnet_fault: 'Pivot fault',
  fieldnet_behind: 'Uneven watering',
  fieldnet_offline: 'Pivot offline',
  irrigation: 'SMRID contact change',
  river_release: 'River flow change',
  water_allotment: 'Water allotment',
  smrid_allotment: 'Water allotment',
  smrid_rate: 'SMRID water rates',
  water_quality: 'Water test results',
  water_quality_request: 'Water sample due',
  crop_weather: 'Frost or heat',
  bin_needs_air: 'Bin needs air',
  seed_bin_check: 'Bin temperatures due',
  truck_inspection: 'Truck inspection due',
  fuel_gauge_silent: 'Fuel gauge silent',
  fert_buy_window: 'Fertilizer prices',
  n_ratio_moved: 'Fertilizer prices',
  fert_deadline: 'Fertilizer deadline',
  ab_input_prices: 'AB input prices',
  market_alert: 'Price alert',
  grant_new: 'New grant',
  lease: 'Lease due date',
  stock_return: 'Stock return due',
  monday_brief: 'Monday brief',
  spray_rotation_conflict: 'Herbicide carryover',
  grazing_restriction: 'Grazing restriction',
  grazing_conflict: 'Cattle on no-graze',
  pasture_move: 'Move a herd',
  jd_boundary: 'Deere boundaries',
  combine_out_of_date: 'Combine out of date',
  task_assigned: 'Task assigned',
  task_completed: 'Task done',
  task_reminder: 'Task due',
  service_due: 'Service due',
  winterizing_freeze: 'Freeze: winterize',
  app_notice: 'App problem update',
  fixer_stuck: 'Fixer stuck',
}

/**
 * One plain line on what each notification is about, shown under its switch
 * on My account → Notifications (Sam, 15 Oct 2026: names like "Carryover"
 * or "App fix" didn't say what they were). Keyed by kind; kinds that share a
 * label share the first kind's line.
 */
export const KIND_DESCRIPTIONS: Record<string, string> = {
  integration_alert: 'A connection like John Deere, QuickBooks or the weather stopped sending data or hit an error.',
  aimm_change: 'The AIMM irrigation model data changed and is worth a check.',
  fieldnet_fault: 'A pivot stopped or reported a fault in FieldNET.',
  fieldnet_behind: 'A pivot is putting on water unevenly around the circle.',
  fieldnet_offline: 'A pivot panel has stopped reporting to FieldNET.',
  irrigation: 'SMRID changed the water coordinator for one of your areas.',
  river_release: 'The Oldman dam release changed, so the river at your pumps will rise or drop.',
  water_allotment: 'Reminders and changes about your SMRID water allotment for the year.',
  smrid_rate: 'SMRID posted new water rates.',
  water_quality: 'New irrigation water quality results came in.',
  water_quality_request: 'Time to send in an irrigation water sample.',
  crop_weather: 'Frost or heat in the forecast while crops are in the field.',
  bin_needs_air: "A bin's readings say it's time to run the aeration fans.",
  seed_bin_check: "A seed company's bin temperature record is due: weekly for a month after harvest, then every second Monday until shipped.",
  truck_inspection: 'Mondays in January: the semi trucks with no yearly inspection signed off yet this year.',
  fuel_gauge_silent: 'A TELUS fuel gauge has not reported for a day, so its tank level on the Fuel page is going stale.',
  fert_buy_window: 'Fertilizer prices, or the nitrogen-to-crop price ratio, moved enough to change the best rate or time to buy.',
  fert_deadline: 'A fertilizer pre-order or price deadline is coming up.',
  ab_input_prices: "Alberta's monthly farm input price report was updated.",
  market_alert: 'A crop or cattle price reached a level you set a watch on.',
  grant_new: 'A new farm or cattle grant you may qualify for was found.',
  lease: 'A lease notice date is 30 days away, or rent is coming due or overdue.',
  stock_return: 'Grazing leases still need their yearly Stewardship Stock Return (due 31 January).',
  monday_brief: 'The weekly summary for the Monday meeting.',
  spray_rotation_conflict: "A crop planned for a field can't safely follow a herbicide sprayed there (the label's re-cropping rule).",
  grazing_restriction: 'A field was sprayed with a product that means no grazing until a set date.',
  grazing_conflict: 'Cattle are on a field that is still under a grazing restriction.',
  pasture_move: 'A herd is due to move off its pasture.',
  jd_boundary: 'Field boundaries were updated from John Deere, or that update had a problem.',
  combine_out_of_date: "A combine's display is missing new fields, boundaries or names since it was last loaded.",
  task_assigned: 'Someone gave you a task.',
  task_completed: 'A task you made was marked done.',
  task_reminder: 'A task of yours is due soon or overdue.',
  service_due: "A machine's service is coming due by engine hours or date, and a task was made for it.",
  winterizing_freeze: 'A hard freeze is forecast: time to winterize equipment and water lines.',
  app_notice: 'Claude fixed a problem in the app, or needs you to do something to fix it.',
  fixer_stuck: 'Claude got stuck partway through fixing an app problem for over two hours.',
}

/** The label a kind files under (the Notifications page's kind filter). Unknown kinds read as themselves. */
export function kindGroupLabel(kind: string): string {
  // The morning digest (DIGEST_KIND) has no switch, so no entry in KIND_LABELS.
  if (kind === 'digest') return 'Daily digest'
  const known = KIND_LABELS[kind]
  if (known) return known
  const words = kind.replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Notification'
}

/**
 * The label shown on an item. Crop weather covers both frost and heat, so the
 * title picks which.
 */
export function kindLabel(kind: string, title?: string | null): string {
  if (kind === 'crop_weather' && title) {
    if (/frost|freez/i.test(title)) return 'Frost warning'
    if (/heat/i.test(title)) return 'Heat warning'
  }
  return kindGroupLabel(kind)
}

/** Every kind filed under a filter value: a label's kinds, or the value itself as a raw kind. */
export function kindsForFilter(value: string): string[] {
  const kinds = Object.keys(KIND_LABELS).filter((k) => KIND_LABELS[k] === value)
  return kinds.length ? kinds : [value]
}

/** The value a kind contributes to the kind filter (its label when known, else the raw kind). */
export function filterValueFor(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "Just now", "5m ago", "3h ago", "Yesterday", "4d ago" within a week; a date after that. */
export function formatWhen(at: string | Date, now: Date = new Date()): string {
  const t = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(t.getTime())) return ''
  const diff = now.getTime() - t.getTime()
  if (diff < MINUTE) return 'Just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY)
    return days === 1 ? 'Yesterday' : `${days}d ago`
  }
  const date = `${MONTHS[t.getMonth()]} ${t.getDate()}`
  return t.getFullYear() === now.getFullYear() ? date : `${date}, ${t.getFullYear()}`
}

export type LinkTarget = { type: 'internal'; to: string } | { type: 'external'; href: string }

/**
 * Where a notification's link goes: an in-app route for react-router, or an
 * outside address for a new tab. A full URL on this app's own origin is an
 * in-app route. Anything else (empty, mailto:, junk) is no link.
 */
export function linkTarget(link: string | null | undefined, origin: string): LinkTarget | null {
  const l = link?.trim()
  if (!l) return null
  if (l.startsWith('/') && !l.startsWith('//')) return { type: 'internal', to: l }
  if (!/^https?:\/\//i.test(l)) return null
  try {
    const u = new URL(l)
    if (u.origin === origin) return { type: 'internal', to: `${u.pathname}${u.search}${u.hash}` }
    return { type: 'external', href: u.href }
  } catch {
    return null
  }
}
