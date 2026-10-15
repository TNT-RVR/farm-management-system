import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { BUILD_SHA, BUILD_TIME, buildAgeDays, describeBuild } from '@/lib/buildInfo'
import { Fold } from '@/components/Fold'
import { InfoPopover } from '@/components/InfoPopover'

/**
 * Which build this device is running, and a way to make it take a newer one.
 *
 * Both halves come from the same fault. A phone kept showing a three-day-old
 * forecast for a week after the fix shipped, and every diagnosis was wrong
 * because the one fact that would have settled it — which build the phone was
 * actually running — was not visible anywhere. An installed PWA is opened,
 * used and backgrounded without ever navigating, and a browser only looks for a
 * new service worker on a navigation or roughly once a day, so the app can sit
 * on an old bundle indefinitely while every deploy goes out on time.
 *
 * The app now asks for a new build whenever it is brought to the foreground, so
 * this should rarely be needed. It is here for the device that is already stuck
 * — which is the one case the automatic check cannot fix, because the automatic
 * check is in the build it has not got.
 */

/** Caches that are the app itself, as opposed to things somebody saved. */
const APP_CACHE = /^workbox-|^rvr-precache|precache/i

type State = 'idle' | 'checking' | 'current' | 'failed'

export function AppVersionCard() {
  const [state, setState] = useState<State>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const age = buildAgeDays()

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  // If a newer build exists it takes over and the page reloads under us — see
  // appUpdate.ts — so "checking" resolving to "current" is the only outcome
  // this component ever gets to render.
  async function check() {
    setState('checking')
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      if (!reg) {
        setState('failed')
        return
      }
      await reg.update()
      timer.current = setTimeout(() => setState('current'), 4000)
    } catch {
      setState('failed')
    }
  }

  /**
   * The escape hatch: throw away the app shell and fetch it fresh.
   *
   * Deliberately leaves the map tiles and saved files alone. Somebody stood in
   * a field having downloaded a township of imagery should not lose it to a
   * button about versions.
   */
  async function reinstall() {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => APP_CACHE.test(k)).map((k) => caches.delete(k)))
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.unregister()
    } catch {
      // Whatever failed, the reload is still worth doing.
    }
    window.location.reload()
  }

  // The everyday line is the build's date. The hash means nothing to most
  // readers, so it sits in Advanced with the escape hatch, for whoever is
  // asked to quote it.
  const builtAt = BUILD_TIME ? new Date(BUILD_TIME) : null
  const built =
    builtAt && !Number.isNaN(builtAt.getTime())
      ? builtAt.toLocaleDateString('en-CA', { day: 'numeric', month: 'short' })
      : BUILD_SHA

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          Version {built}
          <InfoPopover title="App version">
            <p>
              Which build this device is running. Quote it if something looks wrong — it says
              whether the fix has arrived here yet. The full build code is under Advanced.
            </p>
          </InfoPopover>
        </h2>
        <button
          onClick={() => void check()}
          disabled={state === 'checking'}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${state === 'checking' ? 'animate-spin' : ''}`} />
          {state === 'checking' ? 'Checking…' : 'Check for update'}
        </button>
      </div>

      {age != null && age >= 3 && BUILD_SHA !== 'dev' && (
        <p className="mt-1 text-xs text-amber-700">
          Built {age} days ago. If that seems old, check for an update.
        </p>
      )}
      {state === 'current' && (
        <p className="mt-2 text-xs text-gray-500">
          This is the latest build. A newer one would have loaded itself.
        </p>
      )}
      {state === 'failed' && (
        <p className="mt-2 text-xs text-gray-500">
          No service worker is running here, so there is nothing cached to update — this is already
          the live build.
        </p>
      )}

      {/* Folded but not admin-only: a phone that will not take a new build
          belongs to whoever is holding it, and they need the code to quote and
          the button to clear it. */}
      <Fold title="Advanced" className="mt-3 border-gray-100">
        <p className="font-mono text-sm text-gray-900">{describeBuild()}</p>
        <button
          onClick={() => void reinstall()}
          className="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Force a fresh copy
        </button>
        <p className="mt-2 text-[11px] text-gray-400">
          Force a fresh copy re-downloads the app. Saved map tiles and files are kept.
        </p>
      </Fold>
    </div>
  )
}
