/**
 * Save files straight into a folder the person picks (Sam, 19 Oct 2026):
 * "Save to USB stick" opens the browser's folder chooser, they pick the
 * stick, and the files land on it unzipped, ready for the combine display.
 *
 * Chrome and Edge on a computer have the chooser (the File System Access
 * API); Firefox, Safari and phones do not, and the caller falls back to a ZIP
 * download there. Nothing is ever deleted: files of the same name are
 * replaced, anything else in the folder is left alone.
 */

export type FolderFile = { name: string; data: Uint8Array }

type WritableLike = { write(data: Uint8Array): Promise<void>; close(): Promise<void> }
type FileHandleLike = { createWritable(): Promise<WritableLike> }
export type DirHandleLike = {
  name: string
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>
  values?(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>
}
type PickerWindow = Window & { showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirHandleLike> }

/** Can this browser write into a folder the person picks? */
export function canSaveToFolder(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as PickerWindow
  // Android Chrome has the function but no real folder chooser for removable drives.
  const touchOnly = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent)
  return typeof w.showDirectoryPicker === 'function' && !touchOnly
}

/** The picked folder, or null when the person closed the chooser. */
export async function pickFolder(id: string): Promise<DirHandleLike | null> {
  const w = window as PickerWindow
  if (!w.showDirectoryPicker) throw new Error('This browser can’t save into a folder. Use Chrome or Edge on a computer, or download the ZIP.')
  try {
    return await w.showDirectoryPicker({ id, mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/** Names of the entries at the top of a folder (to warn about a stray .cn1 or a picked sub-folder). */
export async function topLevelNames(dir: DirHandleLike): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = []
  const folders: string[] = []
  if (!dir.values) return { files, folders }
  for await (const e of dir.values()) (e.kind === 'directory' ? folders : files).push(e.name)
  return { files, folders }
}

/** Write each file at its path ("Shapefile/a.shp") under the folder, making sub-folders as needed. Returns how many files were written. */
export async function writeFilesToFolder(dir: DirHandleLike, files: FolderFile[]): Promise<number> {
  let written = 0
  for (const f of files) {
    const parts = f.name.split('/').filter(Boolean)
    if (!parts.length) continue
    const isFolder = f.name.endsWith('/')
    let here = dir
    for (const p of isFolder ? parts : parts.slice(0, -1)) here = await here.getDirectoryHandle(p, { create: true })
    if (isFolder) continue
    const handle = await here.getFileHandle(parts[parts.length - 1], { create: true })
    const w = await handle.createWritable()
    await w.write(f.data)
    await w.close()
    written++
  }
  return written
}
