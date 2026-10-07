import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MultiPolygon } from 'geojson'
import { AlertTriangle, CircleHelp, MapPin, X } from 'lucide-react'
import { useRecentApplications } from '@/components/ReentryWarning'
import { byField, describeWait } from '@/lib/reentry'
import { fieldAt, movedEnough } from '@/lib/geofence'
import { boundariesForYear, useAllBoundaries } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import { cn } from '@/lib/utils'

/**
 * A warning when you walk into a field that is still inside its re-entry
 * interval.
 *
 * What this is NOT, and the limits are the point: it runs only while the app is
 * open, so a phone in a pocket warns nobody; handset GPS is good to some tens
 * of metres, so a boundary line is approximate; and location is asked for, not
 * assumed. It is a reminder at a gate, not a fence, and the copy says so.
 *
 * Nothing happens until somebody turns it on. A page that asks for location the
 * moment it loads gets the permission denied once and then never again, which
 * would leave the feature permanently off for the people who most need it.
 */
const STORAGE_KEY = 'rvr.fieldEntryAlert'

export function FieldEntryAlert() {
  const [enabled, setEnabled] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'on',
  )
  const [denied, setDenied] = useState(false)
  const [here, setHere] = useState<{ lng: number; lat: number } | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const lastChecked = useRef<{ lng: number; lat: number } | null>(null)

  const { cropYear } = useCropYear()
  const { data: allBoundaries } = useAllBoundaries()
  const { data: applications } = useRecentApplications()

  const shapes = useMemo(
    () =>
      allBoundaries
        ? boundariesForYear(allBoundaries, cropYear).map((b) => ({
            fieldId: b.field_id,
            boundary: b.geometry as unknown as MultiPolygon,
          }))
        : [],
    [allBoundaries, cropYear],
  )

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lng: pos.coords.longitude, lat: pos.coords.latitude }
        // A stationary phone reports a slightly different fix every few
        // seconds; without this the warning flickers on a boundary line.
        if (!movedEnough(lastChecked.current, next)) return
        lastChecked.current = next
        setHere(next)
      },
      () => setDenied(true),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [enabled])

  const inFieldId = here ? fieldAt(here.lng, here.lat, shapes) : null
  const entry = inFieldId
    ? byField(applications ?? []).find((f) => f.fieldId === inFieldId)
    : undefined

  // Only ever interrupts for a field that is restricted or unread. Standing in
  // a field that is clear is not news, and a popup for it would teach people to
  // dismiss this one without reading it.
  const shouldWarn = entry && entry.state !== 'clear' && dismissed !== entry.fieldId

  if (!enabled)
    return (
      <button
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, 'on')
          setEnabled(true)
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <MapPin className="h-3.5 w-3.5" /> Warn me when I enter a sprayed field
      </button>
    )

  if (denied)
    return (
      <p className="text-xs text-gray-500">
        Location is blocked for this site, so the in-field warning cannot run. Allow it in your
        browser settings, or check a field&rsquo;s page before going in.
      </p>
    )

  if (!shouldWarn)
    return (
      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        <MapPin className="h-3.5 w-3.5 text-green-600" />
        Watching your location.{' '}
        {here
          ? inFieldId
            ? 'You are in a field with nothing outstanding on it.'
            : 'Not in a field.'
          : 'Waiting for a fix…'}{' '}
        <button
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY)
            setEnabled(false)
          }}
          className="underline hover:text-gray-700"
        >
          Turn off
        </button>
      </p>
    )

  const restricted = entry.state === 'restricted'

  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-lg border-2 border-red-500 bg-white p-4 shadow-2xl md:inset-x-auto md:right-4"
    >
      <div className="flex items-start gap-2">
        {restricted ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        ) : (
          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-bold', restricted ? 'text-red-900' : 'text-amber-900')}>
            {restricted
              ? `You are in ${entry.fieldName} — do not enter the crop`
              : `You are in ${entry.fieldName} — sprayed recently`}
          </p>
          <p className="mt-0.5 text-xs text-gray-700">
            {restricted ? (
              <>
                {entry.worst?.productName} has {describeWait(entry.status.hoursLeft)} left on its
                re-entry interval.
              </>
            ) : (
              <>
                {entry.worst?.productName} was applied here and no re-entry interval is on file.
                Unknown is not the same as safe.
              </>
            )}
          </p>
          <Link
            to={`/fields/${entry.fieldId}`}
            className="mt-1 inline-block text-xs font-medium text-brand-700 underline"
          >
            What was applied
          </Link>
        </div>
        <button
          onClick={() => setDismissed(entry.fieldId)}
          aria-label="Dismiss"
          className="rounded p-1 text-gray-400 hover:bg-gray-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
