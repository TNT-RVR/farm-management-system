import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * The report backup to Google Drive (Sam, 7 Oct 2026): "a Google Drive
 * folder called RVR Management App, sub folders for each category of report,
 * a sub folder for each report with a CSV and a PDF inside, kept up to date".
 *
 *   RVR Management App/
 *     Crops & fields/
 *       Field list/
 *         Field list.csv
 *         Field list.pdf
 *
 * The files are made in the app by the Reports page's own code, so a backup
 * never differs from a download, and uploaded straight to Drive with a
 * short-lived token from /api/google-drive-token. Each file keeps its Drive
 * id (drive_backup_items) and is overwritten in place on the next run, so
 * Drive's version history holds the earlier copies.
 *
 * Finance-only: the backup includes the money reports.
 */
const db = supabase as unknown as SupabaseClient

export const ROOT_FOLDER = 'RVR Management App'
/** A run starts when the last good one is older than this and someone with the books has the app open. */
export const BACKUP_EVERY_HOURS = 6
/** A run still marked running after this long has died (the tab closed). */
export const RUN_STALE_MIN = 45

const FOLDER = 'application/vnd.google-apps.folder'
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

async function authed(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...(init?.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body
}

/** Start the Google sign-in; `from: 'setup'` comes back to Farm setup's keys card. */
export async function googleDriveConnect(from?: 'setup'): Promise<string> {
  const body = (await authed(`/api/google-drive-connect${from ? `?from=${from}` : ''}`)) as { authorizeUrl: string }
  return body.authorizeUrl
}

/** A Drive access token, asked of the server and reused until a couple of minutes before it runs out. */
export function tokenSource(): () => Promise<string> {
  let held: { token: string; until: number } | null = null
  return async () => {
    if (held && held.until - Date.now() > 120_000) return held.token
    const r = (await authed('/api/google-drive-token')) as { token: string; expiresAt: string }
    held = { token: r.token, until: new Date(r.expiresAt).getTime() }
    return r.token
  }
}

/** A Drive name: no slashes (they read as paths in Drive's own downloads). */
export const driveName = (s: string) => s.replace(/[\\/]+/g, '–').replace(/\s+/g, ' ').trim()

export type BackupItem = { key: string; drive_id: string; name: string; parent_key: string | null }

/** Writes the backup's folders and files, remembering each one's Drive id. */
export class DriveWriter {
  private items = new Map<string, BackupItem>()
  constructor(private token: () => Promise<string>) {}

  async load() {
    const { data, error } = await db.from('drive_backup_items').select('key, drive_id, name, parent_key')
    if (error) throw error
    this.items = new Map(((data ?? []) as BackupItem[]).map((i) => [i.key, i]))
  }

  private async drive(url: string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...(init.headers ?? {}) } })
    return res
  }

  private async remember(item: BackupItem & { bytes?: number; rows?: number }) {
    this.items.set(item.key, item)
    const { error } = await db.from('drive_backup_items').upsert({ ...item, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
  }

  /** Forget a folder and everything under it (deleted or trashed in Drive). */
  private async forget(key: string) {
    const gone = [...this.items.values()].filter((i) => i.key === key || i.parent_key === key || this.under(i, key)).map((i) => i.key)
    for (const k of gone) this.items.delete(k)
    if (gone.length) await db.from('drive_backup_items').delete().in('key', gone)
  }

  private under(i: BackupItem, key: string): boolean {
    for (let p = i.parent_key; p; p = this.items.get(p)?.parent_key ?? null) if (p === key) return true
    return false
  }

  /** The top folder: checked once a run, made again if somebody deleted it. */
  async root(): Promise<string> {
    const r = this.items.get('root')
    if (r) {
      const res = await this.drive(`${API}/${r.drive_id}?fields=id,trashed`, {})
      const j = res.ok ? ((await res.json()) as { trashed?: boolean }) : null
      if (j && !j.trashed) return r.drive_id
      await this.forget('root')
      for (const k of [...this.items.keys()]) this.items.delete(k)
      await db.from('drive_backup_items').delete().neq('key', '')
    }
    return this.folder('root', ROOT_FOLDER, null)
  }

  async folder(key: string, name: string, parentKey: string | null): Promise<string> {
    const have = this.items.get(key)
    if (have) {
      if (have.name !== name) {
        await this.drive(`${API}/${have.drive_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
        await this.remember({ ...have, name })
      }
      return have.drive_id
    }
    const parent = parentKey ? this.items.get(parentKey)?.drive_id : null
    const res = await this.drive(`${API}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    })
    if (!res.ok) throw new Error(`Drive would not make the folder “${name}” (${res.status}): ${(await res.text()).slice(0, 200)}`)
    const { id } = (await res.json()) as { id: string }
    await this.remember({ key, drive_id: id, name, parent_key: parentKey })
    return id
  }

  /** Overwrite the file in place, or make it the first time (or when it was deleted in Drive). */
  async file(key: string, name: string, parentKey: string, blob: Blob, mime: string, rows?: number) {
    const have = this.items.get(key)
    if (have) {
      const res = await this.drive(`${UPLOAD}/${have.drive_id}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: blob })
      if (res.ok) {
        if (have.name !== name) await this.drive(`${API}/${have.drive_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
        await this.remember({ ...have, name, bytes: blob.size, rows })
        return
      }
      if (res.status !== 404) throw new Error(`Drive would not update “${name}” (${res.status}): ${(await res.text()).slice(0, 200)}`)
      this.items.delete(key)
    }
    const parent = this.items.get(parentKey)?.drive_id
    if (!parent) throw new Error(`No folder for “${name}”`)
    const boundary = `rvr${Math.random().toString(36).slice(2)}`
    const body = new Blob(
      [
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n`,
        `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` },
    )
    const res = await this.drive(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
    if (!res.ok) throw new Error(`Drive would not save “${name}” (${res.status}): ${(await res.text()).slice(0, 200)}`)
    const { id } = (await res.json()) as { id: string }
    await this.remember({ key, drive_id: id, name, parent_key: parentKey, bytes: blob.size, rows })
  }

  rootId(): string | null {
    return this.items.get('root')?.drive_id ?? null
  }
}

export type BackupRun = {
  id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'done' | 'error'
  made: number
  skipped: { report: string; why: string }[]
  errors: { report: string; why: string }[]
}

/** The latest runs, newest first. */
export async function latestRuns(n = 5): Promise<BackupRun[]> {
  const { data, error } = await db.from('drive_backup_runs').select('*').order('started_at', { ascending: false }).limit(n)
  if (error) throw error
  return (data ?? []) as BackupRun[]
}

/** The top folder's Drive id, for the "Open in Drive" link. */
export async function rootFolderId(): Promise<string | null> {
  const { data } = await db.from('drive_backup_items').select('drive_id').eq('key', 'root').maybeSingle()
  return (data?.drive_id as string | undefined) ?? null
}

/**
 * Whether a run is due: none has ever finished, or the last good one is older
 * than BACKUP_EVERY_HOURS — and none is running now (one started less than
 * RUN_STALE_MIN ago counts as running; an older one died with its tab).
 */
export function backupDue(runs: Pick<BackupRun, 'status' | 'started_at' | 'finished_at'>[], now = Date.now()): boolean {
  const running = runs.find((r) => r.status === 'running' && now - new Date(r.started_at).getTime() < RUN_STALE_MIN * 60_000)
  if (running) return false
  const good = runs.find((r) => r.status === 'done' && r.finished_at)
  return !good || now - new Date(good.finished_at!).getTime() > BACKUP_EVERY_HOURS * 3_600_000
}

export async function startRun(userId: string): Promise<string> {
  const { data, error } = await db.from('drive_backup_runs').insert({ run_by: userId }).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function finishRun(id: string, r: { status: 'done' | 'error'; made: number; skipped: BackupRun['skipped']; errors: BackupRun['errors'] }) {
  const { error } = await db.rpc('drive_backup_finished', { p_run: id, p_status: r.status, p_made: r.made, p_skipped: r.skipped, p_errors: r.errors })
  if (error) throw error
}
