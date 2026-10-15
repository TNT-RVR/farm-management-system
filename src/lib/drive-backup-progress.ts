import { useSyncExternalStore } from 'react'

/** The Drive backup's progress, shared by the runner (components/DriveBackup.tsx) and the Farm setup card. */
export type Progress = { running: boolean; done: number; total: number; current: string | null }
let progress: Progress = { running: false, done: 0, total: 0, current: null }
const listeners = new Set<() => void>()
export const setProgress = (p: Partial<Progress>) => {
  progress = { ...progress, ...p }
  listeners.forEach((l) => l())
}
export function useBackupProgress(): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => progress,
  )
}

export const NOW_EVENT = 'rvr:drive-backup-now'
/** Start a backup straight away (the Farm setup card's button). */
export const backUpNow = () => window.dispatchEvent(new Event(NOW_EVENT))

