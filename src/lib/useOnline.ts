import { useEffect, useState } from 'react'

/**
 * Whether the browser thinks it has a connection.
 *
 * navigator.onLine is a low bar — it means "attached to a network", not "can
 * reach Supabase", so it reads true on a truck laptop tethered to a phone with
 * no bars. It is right about the case that matters here, though: when it says
 * offline, it is offline. A false "online" costs a failed request and the
 * cached data is already on screen; a false "offline" would hide live data
 * that was actually available, which is the worse mistake.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
