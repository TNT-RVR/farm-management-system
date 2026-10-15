import { createClient } from '@supabase/supabase-js'
import { extractRecrop, recropPassages } from '../shared/recrop-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Read every label's following-crop restrictions into chemical_recrop_rules.
 *
 * Works through the labels that have text and have not been read (or all of
 * them with ?force=1), one at a time within a 13-minute budget, then calls
 * itself again if any are left. Started from Chemicals → Registry by a
 * manager, or with the worker key.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

const BUDGET_MS = 13 * 60_000

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!url || !serviceKey || !apiKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  let allowed = byWorker
  if (!allowed) {
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (bearer) {
      const { data: au } = await getUserMfa(sb, bearer)
      if (au.user) {
        const { data: prof } = await sb.from('users').select('active, role').eq('id', au.user.id).single()
        allowed = Boolean(prof?.active) && ['manager', 'admin'].includes(String(prof?.role))
      }
    }
  }
  if (!allowed) return new Response('Not authorised', { status: 401 })

  const force = new URL(req.url).searchParams.get('force') === '1'
  const started = Date.now()
  let q = sb.from('chemical_labels').select('registration_number, label_text').not('label_text', 'is', null).order('registration_number')
  if (!force) q = q.is('recrop_extracted_at', null)
  const { data: labels, error } = await q.limit(200)
  if (error) return new Response(error.message, { status: 500 })

  let read = 0
  let failed = 0
  for (const l of labels ?? []) {
    if (Date.now() - started > BUDGET_MS) break
    const reg = l.registration_number as string
    try {
      const passages = recropPassages(String(l.label_text ?? ''))
      const got = passages ? await extractRecrop(passages, apiKey, model) : { has: false, rules: [] }
      await sb.from('chemical_recrop_rules').delete().eq('registration_number', reg).eq('source', 'label')
      if (got.rules.length) {
        const { error: insErr } = await sb.from('chemical_recrop_rules').insert(got.rules.map((r) => ({ ...r, registration_number: reg, source: 'label' })))
        if (insErr) throw insErr
      }
      await sb
        .from('chemical_labels')
        .update({ recrop_extracted_at: new Date().toISOString(), recrop_status: got.has ? 'read' : 'none_on_label', recrop_note: null })
        .eq('registration_number', reg)
      read++
    } catch (e) {
      failed++
      await sb
        .from('chemical_labels')
        .update({ recrop_status: 'failed', recrop_note: (e as Error).message.slice(0, 300), recrop_extracted_at: new Date().toISOString() })
        .eq('registration_number', reg)
    }
  }

  // More to do: start another run rather than stop half way.
  const { count } = await sb.from('chemical_labels').select('registration_number', { count: 'exact', head: true }).not('label_text', 'is', null).is('recrop_extracted_at', null)
  if ((count ?? 0) > 0 && !force && workerKey && process.env.URL) {
    await fetch(`${process.env.URL}/.netlify/functions/recrop-extract-background`, { method: 'POST', headers: { 'x-worker-key': workerKey } }).catch(() => {})
  }
  console.log('recrop extract:', JSON.stringify({ read, failed, remaining: count }))
  return new Response(JSON.stringify({ read, failed, remaining: count }))
}
