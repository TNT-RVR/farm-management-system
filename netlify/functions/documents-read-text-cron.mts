import { hydrateSecrets } from '../shared/secrets.ts'

// Nightly, so a PDF that arrived on any screen during the day is searchable
// by its contents by morning. The reader itself does the work and starts
// another run if it runs out of time; this only wakes it.
export const config = { schedule: '20 9 * * *' }

export default async () => {
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) return new Response('Not configured', { status: 500 })
  await fetch(`${site}/.netlify/functions/documents-read-text-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
  }).catch(() => {})
  return new Response(JSON.stringify({ ok: true, woke: 'documents-read-text-background' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
