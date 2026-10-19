import type { SupabaseClient } from '@supabase/supabase-js'
import { anydoAccessToken, anydoSession, appUrl } from '../functions/_anydo.mts'
import { hasMarker, stripMarker } from './anydo-marker.ts'

/**
 * Any.do two-way task sync, per connected person (stage 2, 14 Oct 2026).
 *
 * - Their open app tasks (task_assignees) go into their Any.do list (Sam's
 *   "Work") with the marker in the title ("#RVR" — Any.do's connector has no
 *   tags), a link back in the note.
 * - Tasks in that list whose title carries the marker come into the app,
 *   assigned to them, marker stripped.
 * - A tick (or un-tick) in Any.do is carried to the app. The other way is
 *   impossible: Any.do refuses every change to an existing task unless a
 *   person confirms it in its own preview (14 Oct 2026: "This action can
 *   only be confirmed from the Any.do preview"). So a task finished in the app
 *   stays open in Any.do until it is ticked there.
 *
 * anydo_task_links pairs the two and remembers each side's state, so a change
 * is seen once and nothing is copied twice. A linked task that is not in the
 * open list read is read on its own (get_task) to learn whether it was ticked.
 */

type Session = Awaited<ReturnType<typeof anydoSession>>
type AnydoTask = { task_id: string; list_id?: string; title?: string; note?: string; status?: string; task_type?: string }

/** A tool's answer: MCP's text block (JSON), else its structured form. */
async function tool<T>(s: Session, name: string, args: Record<string, unknown>): Promise<T> {
  const r = (await s.tool(name, args)) as { content?: { type?: string; text?: string }[]; structuredContent?: unknown; isError?: boolean } | null
  const text = r?.content?.find((c) => c.type === 'text')?.text ?? ''
  if (r?.isError) throw new Error(`Any.do ${name}: ${text.slice(0, 200)}`)
  // The text block is the clean answer (JSON); structuredContent wraps the
  // same as { message, data: { result } }.
  try {
    return JSON.parse(text) as T
  } catch {
    const sc = r?.structuredContent as { data?: { result?: unknown } } | undefined
    return (sc?.data?.result ?? sc ?? text) as T
  }
}

const listOf = <T>(v: unknown, key: string): T[] => (Array.isArray(v) ? (v as T[]) : Array.isArray((v as Record<string, unknown>)?.[key]) ? ((v as Record<string, unknown>)[key] as T[]) : [])
const isDone = (status: string | undefined) => status === 'checked' || status === 'done'
/** The app task an Any.do task came from: its note starts with the task's link. */
const appTaskOf = (note: string | undefined) => (note ?? '').match(/\/tasks\/([0-9a-f-]{36})/)?.[1] ?? null
/**
 * Any.do ignores the task_id it is given and assigns its own (14 Oct 2026),
 * so the created task's real id is read from create_personal_tasks' answer.
 */
const createdId = (r: unknown): string | null => {
  const rows = listOf<AnydoTask>(r, 'tasks')
  return rows[0]?.task_id ?? (r as AnydoTask | null)?.task_id ?? null
}

/**
 * Every open task in one list. get_tasks returns at most 20 and its search
 * is fuzzy (14 Oct 2026: "#RVR" found nothing, "Island" 20 unrelated), so
 * the list is read in date slices, halved until each holds fewer than 20,
 * plus one plain read for tasks with no date.
 */
async function readList(s: Session, listId: string): Promise<AnydoTask[]> {
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19)
  const all = new Map<string, AnydoTask>()
  const take = (rows: AnydoTask[]) => rows.forEach((t) => t?.task_id && all.set(t.task_id, t))
  const slice = async (from: number, to: number, depth: number): Promise<void> => {
    const rows = listOf<AnydoTask>(await tool(s, 'get_tasks', { list_id: listId, from_datetime: fmt(from), to_datetime: fmt(to) }), 'tasks')
    take(rows)
    if (rows.length >= 20 && depth < 10 && to - from > 3_600_000) {
      const mid = from + Math.floor((to - from) / 2)
      await slice(from, mid, depth + 1)
      await slice(mid + 1000, to, depth + 1)
    }
  }
  await slice(Date.UTC(2010, 0, 1), Date.now() + 5 * 365 * 86_400_000, 0)
  take(listOf<AnydoTask>(await tool(s, 'get_tasks', { list_id: listId }), 'tasks'))
  return [...all.values()]
}

export type SyncResult = { user: string; sent: number; received: number; ticked: number; error?: string }

export async function syncOnePerson(sb: SupabaseClient, conn: { user_id: string; list_id: string | null; list_name: string | null; marker: string }): Promise<SyncResult> {
  // One run per person at a time: another run still busy means skip, never double-send.
  const { data: claimed } = await sb.rpc('anydo_claim_sync', { p_user: conn.user_id })
  if (!claimed) return { user: conn.user_id, sent: 0, received: 0, ticked: 0, error: 'already syncing' }
  try {
    return await syncPerson(sb, conn)
  } finally {
    await sb.from('anydo_connections').update({ sync_lock_until: null }).eq('user_id', conn.user_id)
  }
}

async function syncPerson(sb: SupabaseClient, conn: { user_id: string; list_id: string | null; list_name: string | null; marker: string }): Promise<SyncResult> {
  const user = conn.user_id
  // Blank: a dedicated list, where every task is the app's and titles stay clean.
  const marker = conn.marker ?? ''
  const out: SyncResult = { user, sent: 0, received: 0, ticked: 0 }
  const s = await anydoSession(await anydoAccessToken(sb, user))

  // The list: found by name once, then by id.
  let listId = conn.list_id
  if (!listId) {
    const lists = listOf<{ id?: string; list_id?: string; name?: string; title?: string }>(await tool(s, 'get_lists', {}), 'lists')
    const want = (conn.list_name ?? 'Work').toLowerCase()
    const hit = lists.find((l) => (l.name ?? l.title ?? '').toLowerCase() === want)
    if (!hit) throw new Error(`No "${conn.list_name ?? 'Work'}" list in Any.do`)
    listId = (hit.id ?? hit.list_id)!
    await sb.from('anydo_connections').update({ list_id: listId }).eq('user_id', user)
  }

  // The list's open tasks; the marked ones, and those the app made (known by
  // the app link in their note, even if a link row was lost).
  const listed = await readList(s, listId)
  const marked = listed.filter((t) => hasMarker(t.title, marker))
  const markedById = new Map(marked.map((t) => [t.task_id, t]))
  const madeByApp = new Map<string, AnydoTask>()
  for (const t of listed) {
    const appId = appTaskOf(t.note)
    if (appId && !madeByApp.has(appId)) madeByApp.set(appId, t)
  }

  const { data: linkRows, error: linkErr } = await sb.from('anydo_task_links').select('*').eq('user_id', user).eq('gone', false)
  if (linkErr) throw linkErr
  const links = (linkRows ?? []) as { id: string; task_id: string | null; anydo_task_id: string; app_done: boolean; anydo_done: boolean }[]
  const linkedAnydo = new Set(links.map((l) => l.anydo_task_id))
  const linkedTasks = new Set(links.map((l) => l.task_id).filter(Boolean) as string[])

  // 1. Open app tasks assigned to them, not yet in Any.do.
  const { data: mine } = await sb.from('task_assignees').select('task_id, tasks!inner(id, title, description_md, status)').eq('user_id', user).eq('tasks.status', 'open')
  const toSend = ((mine ?? []) as unknown as { tasks: { id: string; title: string; description_md: string | null } }[])
    .map((r) => r.tasks)
    .filter((t) => !linkedTasks.has(t.id))
  for (const app of toSend) {
    // Already in Any.do (a link row was lost): pair it up, never send twice.
    const there = madeByApp.get(app.id)
    let anydoId = there?.task_id ?? null
    if (!anydoId) {
      const r = await tool<unknown>(s, 'create_personal_tasks', {
        tasks: [
          {
            task_id: crypto.randomUUID(),
            list_id: listId,
            title: marker ? `${app.title} ${marker}` : app.title,
            status: 'unchecked',
            note: `${appUrl()}/tasks/${app.id}${app.description_md ? `\n\n${app.description_md.slice(0, 500)}` : ''}`,
          },
        ],
      })
      anydoId = createdId(r)
      // No id back: stop rather than risk sending it again next time.
      if (!anydoId) throw new Error(`Any.do made a task but gave no id back: ${JSON.stringify(r).slice(0, 160)}`)
      out.sent++
    }
    const { error } = await sb
      .from('anydo_task_links')
      .upsert({ user_id: user, task_id: app.id, anydo_task_id: anydoId, origin: 'app', gone: false, updated_at: new Date().toISOString() }, { onConflict: 'user_id,anydo_task_id' })
    if (error) throw error
    linkedAnydo.add(anydoId)
  }

  // 2. Marked Any.do tasks not yet in the app.
  for (const t of marked.filter((m) => !linkedAnydo.has(m.task_id) && !appTaskOf(m.note))) {
    const title = stripMarker(t.title ?? '', marker) || 'Task from Any.do'
    const { data: task, error } = await sb
      .from('tasks')
      // tasks.source_ref is a uuid and Any.do's ids are not (every save failed
      // from 15 Oct). The Any.do id lives on the link row below instead.
      .insert({ title, description_md: t.note?.trim() || null, created_by: user, status: 'open', source: 'anydo' })
      .select('id')
      .single()
    if (error) throw error
    await sb.from('task_assignees').insert({ task_id: task.id, user_id: user })
    await sb.from('anydo_task_links').insert({ user_id: user, task_id: task.id, anydo_task_id: t.task_id, origin: 'anydo' })
    out.received++
  }

  // 3. Ticks, both ways, for the links that were already there.
  if (links.length) {
    const ids = links.map((l) => l.task_id).filter(Boolean) as string[]
    const { data: appRows } = ids.length ? await sb.from('tasks').select('id, status').in('id', ids) : { data: [] }
    const appDoneById = new Map((appRows ?? []).map((r) => [r.id as string, r.status === 'done']))
    for (const l of links) {
      if (!l.task_id || !appDoneById.has(l.task_id)) {
        await sb.from('anydo_task_links').update({ gone: true, updated_at: new Date().toISOString() }).eq('id', l.id)
        continue
      }
      const appDone = appDoneById.get(l.task_id)!
      // Finished in the app: Any.do cannot be ticked from here, so there is
      // nothing more to carry. Note it once and stop reading it.
      if (appDone) {
        if (!l.app_done) await sb.from('anydo_task_links').update({ app_done: true, updated_at: new Date().toISOString() }).eq('id', l.id)
        continue
      }
      // Open and still marked: seen in the list. Otherwise read it on its own.
      let adDone: boolean
      const seen = markedById.get(l.anydo_task_id)
      if (seen) adDone = isDone(seen.status)
      else {
        let one: AnydoTask | null
        try {
          const r = await tool<unknown>(s, 'get_task', { task_id: l.anydo_task_id, task_type: 'personal_task' })
          one = ((r as { task?: AnydoTask })?.task ?? r) as AnydoTask
        } catch {
          // A failed read is not a deletion (14 Oct: Any.do answered 500 for
          // a wrong id and every pair was dropped, then sent again).
          continue
        }
        if (one?.status === 'deleted') {
          await sb.from('anydo_task_links').update({ gone: true, updated_at: new Date().toISOString() }).eq('id', l.id)
          continue
        }
        adDone = isDone(one.status)
      }
      const adChanged = adDone !== l.anydo_done
      let nextApp = appDone
      const nextAd = adDone
      if (adChanged && adDone !== appDone) {
        await sb
          .from('tasks')
          .update(adDone ? { status: 'done', completed_at: new Date().toISOString(), completed_by: user } : { status: 'open', completed_at: null, completed_by: null })
          .eq('id', l.task_id)
        nextApp = adDone
        out.ticked++
      }
      if (nextApp !== l.app_done || nextAd !== l.anydo_done) {
        await sb.from('anydo_task_links').update({ app_done: nextApp, anydo_done: nextAd, updated_at: new Date().toISOString() }).eq('id', l.id)
      }
    }
  }
  return out
}

/** Every connected person, then one heartbeat for the watchdog. */
export async function runAnydoSync(sb: SupabaseClient, deadline: number): Promise<SyncResult[]> {
  const { data: conns } = await sb.from('anydo_connections').select('user_id, list_id, list_name, marker').eq('status', 'connected')
  const results: SyncResult[] = []
  for (const c of (conns ?? []) as { user_id: string; list_id: string | null; list_name: string | null; marker: string }[]) {
    if (Date.now() > deadline) break
    try {
      const r = await syncOnePerson(sb, c)
      if (r.error === 'already syncing') continue
      results.push(r)
      await sb.from('anydo_connections').update({ last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('user_id', c.user_id)
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300)
      results.push({ user: c.user_id, sent: 0, received: 0, ticked: 0, error: msg })
      await sb.from('anydo_connections').update({ last_error: msg, updated_at: new Date().toISOString() }).eq('user_id', c.user_id)
    }
  }
  const failed = results.filter((r) => r.error)
  if (results.length && failed.length < results.length) {
    const t = results.reduce((a, r) => ({ sent: a.sent + r.sent, received: a.received + r.received, ticked: a.ticked + r.ticked }), { sent: 0, received: 0, ticked: 0 })
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'anydo_sync',
      p_detail: `${results.length - failed.length} of ${results.length} people synced · ${t.sent} sent, ${t.received} came in, ${t.ticked} ticked${failed.length ? ` · ${failed.length} failed` : ''}`,
      p_data_at: new Date().toISOString(),
    })
  }
  return results
}
