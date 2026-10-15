/**
 * The marker that says a task belongs to this app ("#RVR"), in any case. No
 * marker means the whole list is the app's (a dedicated "RVR" list).
 */
export const hasMarker = (title: string | undefined, marker: string) => !marker || (title ?? '').toLowerCase().includes(marker.toLowerCase())

/** The title without the marker, wherever it sat. */
export const stripMarker = (title: string, marker: string) =>
  !marker
    ? title.trim()
    : title.replace(new RegExp(`\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'ig'), ' ').replace(/\s+/g, ' ').trim()
