import { TriangleAlert } from 'lucide-react'
import {
  useNotificationOrder,
  useNotificationPrefs,
  useNotificationTiming,
  useSetNotificationOrder,
  useSetNotificationTiming,
  useSetPrefs,
} from '@/lib/notifications'
import {
  DIGEST_SUGGESTED,
  NOTIFICATION_GROUPS,
  deliveryOf,
  groupSwitches,
  prefOn,
  rowsFor,
  rowsForDelivery,
  switchDelivery,
  switchOn,
  type Channel,
  type Delivery,
  type PrefRow,
} from '@/lib/notification-kinds'
import { DEFAULT_TIMING, type NotificationTiming } from '@/lib/notification-schedule'
import { farmTz } from '@/lib/farm-context'
import { cn } from '@/lib/utils'

function Switch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
        on ? 'bg-brand-700' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function TimeInput({ value, label, disabled, onChange }: { value: string; label: string; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      step={900}
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="rounded border border-gray-300 px-1.5 py-0.5 text-sm text-gray-800 disabled:opacity-40"
    />
  )
}

/** Quiet hours and the digest time: when pushes reach my phone. Times are the farm's clock. */
function Timing({ prefs, onSuggest, busy }: { prefs: PrefRow[] | undefined; onSuggest: (kinds: string[]) => void; busy: boolean }) {
  const { data } = useNotificationTiming()
  const save = useSetNotificationTiming()
  const t: NotificationTiming = data ?? DEFAULT_TIMING
  const set = (patch: Partial<NotificationTiming>) => save.mutate({ ...t, ...patch })
  const tz = farmTz()
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const farmClock = browserTz && browserTz !== tz ? ` (${tz.replace(/_/g, ' ')} time)` : ''
  // Suggested kinds still pushed right away, among those that push at all.
  const suggest = DIGEST_SUGGESTED.filter((k) => prefOn(prefs, k, 'push') && deliveryOf(prefs, k) === 'now')
  const anyDigest = (prefs ?? []).some((p) => p.delivery === 'digest' && p.in_app && p.push)

  return (
    <section aria-label="When pushes arrive">
      <div className="border-b border-gray-100 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">When pushes arrive</h3>
      </div>
      {save.isError && <p className="text-xs text-red-600">Could not save: {(save.error as Error).message}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <span className="min-w-0 flex-1 text-sm text-gray-800">Quiet hours{farmClock}</span>
        {t.quiet_on && (
          <span className="order-last flex w-full items-center gap-1.5 text-sm text-gray-600 sm:order-none sm:w-auto">
            <TimeInput value={t.quiet_start} label="Quiet hours start" disabled={save.isPending} onChange={(v) => set({ quiet_start: v })} />
            <span aria-hidden>–</span>
            <TimeInput value={t.quiet_end} label="Quiet hours end" disabled={save.isPending} onChange={(v) => set({ quiet_end: v })} />
          </span>
        )}
        <Switch
          on={t.quiet_on}
          label="Quiet hours: hold pushes, then send one summary"
          disabled={save.isPending}
          // Off keeps the times; the first time on, they are the suggested 22:00–06:00.
          onChange={(on) => set({ quiet_on: on })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <span className="min-w-0 flex-1 text-sm text-gray-800">
          Daily digest at
          {!anyDigest && <span className="ml-1.5 text-xs text-gray-400">nothing in it yet</span>}
        </span>
        {suggest.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSuggest(suggest)}
            title="Put fertilizer and input price reports, SMRID rates, new grants and data feed problems in the digest"
            className="order-last rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-gray-50 disabled:text-gray-300 sm:order-none"
          >
            Use for prices, grants &amp; feed problems
          </button>
        )}
        <TimeInput value={t.digest_at} label="Daily digest time" disabled={save.isPending} onChange={(v) => set({ digest_at: v })} />
      </div>
    </section>
  )
}

/** The order of my bell's list and the Notifications page: unread at the top, or newest first. */
function ListOrder() {
  const { data } = useNotificationOrder()
  const save = useSetNotificationOrder()
  const unreadFirst = data ?? true
  return (
    <section aria-label="Notification list order">
      <div className="border-b border-gray-100 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">List order</h3>
      </div>
      {save.isError && <p className="text-xs text-red-600">Could not save: {(save.error as Error).message}</p>}
      <div className="flex items-center gap-3 py-2">
        <span className="min-w-0 flex-1 text-sm text-gray-800">
          Unread at the top
          <span className="block text-xs text-gray-500">
            {unreadFirst ? 'Unread first, then the rest, each newest first.' : 'Newest first, read or not.'} The bell and the Notifications page.
          </span>
        </span>
        <Switch on={unreadFirst} label="Unread notifications at the top" disabled={data === undefined || save.isPending} onChange={(on) => save.mutate(on)} />
      </div>
    </section>
  )
}

/** Right away or in the morning digest, next to a push switch that is on. Urgent kinds have no choice. */
function DeliveryChoice({
  urgent,
  value,
  label,
  disabled,
  onChange,
}: {
  urgent: boolean
  value: Delivery
  label: string
  disabled?: boolean
  onChange: (d: Delivery) => void
}) {
  if (urgent) return <span className="text-[11px] text-gray-500">Always sent right away</span>
  return (
    <select
      value={value}
      aria-label={`${label}: when to push`}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Delivery)}
      className="rounded border border-gray-300 bg-white py-0.5 pl-1.5 pr-6 text-xs text-gray-700 disabled:opacity-40"
    >
      <option value="now">Right away</option>
      <option value="digest">Daily digest</option>
    </select>
  )
}

/** One switch per kind of notification, by heading: in the app, and pushed to my phone. */
export function NotificationSwitches() {
  const { data: prefs } = useNotificationPrefs()
  const save = useSetPrefs()
  const set = (kinds: readonly string[], channel: Channel, on: boolean) =>
    save.mutate(rowsFor(prefs, kinds, channel, on))
  const setDelivery = (kinds: readonly string[], d: Delivery) => save.mutate(rowsForDelivery(prefs, kinds, d))
  // "All on" turns both channels on; "All off" turns the notification off, which stops its push too.
  const setGroup = (kinds: readonly string[], on: boolean) => {
    const rows: PrefRow[] = rowsFor(prefs, kinds, 'in_app', on).map((r) => (on ? { ...r, push: true } : r))
    save.mutate(rows)
  }

  return (
    <div className="mt-3 space-y-4">
      <ListOrder />
      <Timing prefs={prefs} busy={save.isPending} onSuggest={(kinds) => setDelivery(kinds, 'digest')} />
      {save.isError && <p className="text-xs text-red-600">Could not save: {(save.error as Error).message}</p>}
      {NOTIFICATION_GROUPS.map((g) => {
        const switches = groupSwitches(g.kinds)
        const allOn = switchOn(prefs, g.kinds, 'in_app') && switchOn(prefs, g.kinds, 'push')
        const allOff = g.kinds.every((k) => !switchOn(prefs, [k], 'in_app'))
        return (
          <section key={g.key} aria-label={g.label}>
            <div className="flex items-center gap-2 border-b border-gray-100 pb-1">
              <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.label}</h3>
              <button
                type="button"
                disabled={allOn || save.isPending}
                onClick={() => setGroup(g.kinds, true)}
                className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-gray-50 disabled:text-gray-300"
              >
                All on
              </button>
              <button
                type="button"
                disabled={allOff || save.isPending}
                onClick={() => setGroup(g.kinds, false)}
                className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-gray-50 disabled:text-gray-300"
              >
                All off
              </button>
            </div>
            <div className="flex justify-end gap-3 pt-1 text-[11px] text-gray-400">
              <span className="w-11 text-center">In the app</span>
              <span className="w-11 text-center">Push</span>
            </div>
            <ul>
              {switches.map((s) => {
                const inApp = switchOn(prefs, s.kinds, 'in_app')
                const push = switchOn(prefs, s.kinds, 'push')
                return (
                  <li key={s.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm text-gray-800">
                        {s.label}
                        {s.warning && !inApp && (
                          <span title={s.warning} aria-label={s.warning} role="img" className="text-amber-600">
                            <TriangleAlert className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                      {s.description && <span className="block text-xs leading-snug text-gray-500">{s.description}</span>}
                    </span>
                    {/* Under the row on a phone, beside the push switch on a wider screen. */}
                    {inApp && push && (
                      <span className="order-last w-full sm:order-none sm:w-auto">
                        <DeliveryChoice
                          urgent={s.urgent}
                          value={switchDelivery(prefs, s.kinds)}
                          label={s.label}
                          disabled={save.isPending}
                          onChange={(d) => setDelivery(s.kinds, d)}
                        />
                      </span>
                    )}
                    <Switch
                      on={inApp}
                      label={`${s.label}: in the app`}
                      disabled={save.isPending}
                      onChange={(on) => set(s.kinds, 'in_app', on)}
                    />
                    <Switch
                      on={inApp && push}
                      label={`${s.label}: push to my phone`}
                      disabled={!inApp || save.isPending}
                      onChange={(on) => set(s.kinds, 'push', on)}
                    />
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
