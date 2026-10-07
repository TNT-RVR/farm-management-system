import { CloudOff } from 'lucide-react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useOnline } from '@/lib/useOnline'

/**
 * Says plainly that the screen is showing saved data.
 *
 * Without it the app looks normal offline, which is the failure mode worth
 * avoiding: records that are days old presented exactly like records fetched a
 * second ago. The point of saving the data is that it is there when you need
 * it, not that you cannot tell the difference.
 */
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900 print:hidden">
      <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        <b>No connection.</b> You are seeing what was saved on this device the last time you had
        signal. Records, plans, labels and history are all here. Live readings — pivots, the PLC,
        the river — are not, and nothing can be saved or sent until you are back on.
      </p>
    </div>
  )
}

/**
 * The in-page version, for a screen whose whole job is a live reading.
 *
 * A stale pivot angle is the one piece of cached data that can put somebody in
 * front of a machine they think is parked, so those screens show this instead
 * of the last known number.
 */
export function OfflineLive({ what }: { what: string }) {
  const online = useOnline()
  if (online) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
      <p>
        {what} needs a connection. The last reading is deliberately not shown — out here it would
        look exactly like a current one, and it is not.
      </p>
    </div>
  )
}

/**
 * For data that simply is not on this device.
 *
 * Different from OfflineLive, which withholds a reading on purpose. This one is
 * "we would show you if we had it", and saying so matters: the alternative is a
 * screen's ordinary empty state, which usually blames the records rather than
 * the signal and sends somebody off to fix a thing that is not broken.
 */
export function OfflineMissing({ what }: { what: string }) {
  const online = useOnline()
  if (online) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
      <p>
        {what} was not saved to this device, so it cannot be shown until you are back on. Settings →
        Offline access pulls the main records down before you leave.{' '}
        <SetupLink to={SETUP_LINKS.thisDevice()}>Offline access</SetupLink>
      </p>
    </div>
  )
}
