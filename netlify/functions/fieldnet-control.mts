import {
  admin,
  fieldnetAccessToken,
  fieldnetGet,
  fieldnetPatch,
  json,
  listFrom,
  requireManager,
} from './_fieldnet.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// FieldNET capability + control endpoint.
//
// GET  → which policies Lindsay has granted this app, and what each unlocks.
//        Manager-only, read-only. This replaces guessing/assuming: the
//        Integrations page reads it so the granted set is always visible.
//
// POST → pivot control. Blocked on the equipment-configure POLICY, not on the
//        API's capabilities. The docs claim PATCH /irrigation-controllers/{id}
//        "allows the note to be updated"; that prose is stale. The capability
//        probe (2026-08-04) showed the endpoint recognises direction, speed,
//        service_stop, is_service_stop_repeat_on, is_auto_reverse_on,
//        is_auto_restart_on, target_angle and is_water_on — each returned a 400
//        type-validation error, which only happens for fields the write model
//        knows. `note` was the one probe whose value was type-VALID, so it alone
//        reached the authorization check, and it returned 403. Prairie Creek holds
//        equipment-monitor / equipment-report / organization-view only.
//        See docs/DECISIONS.md.
//
// So: once Lindsay grants equipment-configure, implement the actions here using
// the field names above, writing a pivot_control_log row per command. The local
// gates (FIELDNET_CONTROL_ENABLED env + farms.fieldnet_control_enabled +
// manager/can_control_pivots) and the audit table are already in place.

// What each FieldNET policy unlocks for us, in our terms.
const POLICY_MEANING: Record<string, string> = {
  'equipment-monitor': 'Live pivot status, position and settings (read)',
  'equipment-report': 'As-applied irrigation history',
  'equipment-configure': 'Panel note, load-management schedule, sectional adjustments',
  'equipment-control': 'Endgun tables',
  'equipment-plan': 'Create, edit and delete irrigation plans',
  'equipment-manage': 'Add and remove equipment',
  'equipment-service': 'Service-level equipment access',
  'equipment-load-control': 'Utility demand-response curtailment (not operator control)',
  'organization-view': 'Read the organization and its equipment list',
  'organization-manage': 'Manage the organization',
  'organization-grant': 'Grant policies to other applications',
  'advisor-run': 'Run the Advisor soil-moisture model',
  'advisor-report': 'Advisor recommendations and reports',
  'advisor-configure': 'Configure Advisor fields',
  'advisor-weather': 'Advisor weather and satellite imagery',
  'rtu-monitor': 'Read RTU status',
  'rtu-configure': 'Configure RTUs',
}

/** Distinct policy names granted to our access token, alphabetically. */
async function grantedPolicies(token: string): Promise<string[]> {
  const seen = new Set<string>()
  for (let page = 1; page <= 20; page++) {
    const body = await fieldnetGet(token, `/policy-assignments?page=${page}&page-size=300`)
    const items = listFrom(body) as { policy?: string }[]
    for (const a of items) if (a.policy) seen.add(a.policy)
    if (items.length < 300) break
  }
  return [...seen].sort()
}

async function handleGet(req: Request) {
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can read FieldNET capabilities' }, 403)
  }
  const token = await fieldnetAccessToken(sb)
  const policies = await grantedPolicies(token)
  const has = (p: string) => policies.includes(p)
  return json({
    policies: policies.map((p) => ({ policy: p, grants: POLICY_MEANING[p] ?? null })),
    capabilities: {
      monitor: has('equipment-monitor'),
      appliedIrrigation: has('equipment-report'),
      plans: has('equipment-plan'),
      endgunTables: has('equipment-control'),
      advisor: has('advisor-report') || has('advisor-run'),
      satelliteImagery: has('advisor-weather'),
      // Proven by the capability probe on 2026-08-04: the panel PATCH really does
      // accept direction/speed/service_stop/auto-reverse/auto-restart/target_angle.
      // The docs' "note only" prose is stale. All that's missing is the policy.
      remoteStartStop: has('equipment-configure'),
    },
    remoteControlNote: has('equipment-configure')
      ? 'equipment-configure is granted and the panel PATCH accepts the motion fields — ' +
        'remote control can be built.'
      : 'The panel PATCH does accept direction, speed, auto-stop angle and auto-reverse — ' +
        'confirmed by the capability probe. What is missing is the equipment-configure ' +
        'policy: the one probe that passed type validation (note) came back 403. Ask ' +
        'Lindsay to grant equipment-configure on this equipment.',
  })
}

type ControlBody = { action?: string; equipmentId?: string }

// ---- Capability probe ------------------------------------------------------
// The docs contradict themselves: the prose for PATCH /irrigation-controllers/{id}
// says "allows the note to be updated", but the JSON schema on the same page marks
// only id/subtype/operational_status/communication_status/runtimes as readOnly and
// leaves direction, speed, service_stop, is_auto_reverse_on, is_auto_restart_on and
// target_angle unmarked — i.e. writable. Rather than guess either way, ask the API.
//
// SAFETY: every probe value below is deliberately the WRONG TYPE (a string where a
// number, boolean or enum is required). A type-invalid value cannot be coerced into
// a real setting, so no probe can start, stop, turn or re-aim a machine no matter
// how the server behaves. Do not put a valid value in this table.
const PROBE_VALUE = '__rvr_probe__'
const PROBES: { field: string; payload: Record<string, unknown>; why: string }[] = [
  // Control probe first: if an unknown field errors identically to a real one, the
  // server validates everything blindly and the other results mean nothing.
  {
    field: 'zzz_not_a_real_field',
    payload: { zzz_not_a_real_field: PROBE_VALUE },
    why: 'Baseline — how the API treats a field that certainly does not exist',
  },
  { field: 'note', payload: { note: PROBE_VALUE }, why: 'Known-writable control (documented)' },
  { field: 'direction', payload: { direction: PROBE_VALUE }, why: 'Forward / reverse' },
  { field: 'speed', payload: { speed: PROBE_VALUE }, why: 'Percent timer' },
  { field: 'service_stop', payload: { service_stop: PROBE_VALUE }, why: 'Auto-stop angle' },
  {
    field: 'is_service_stop_repeat_on',
    payload: { is_service_stop_repeat_on: PROBE_VALUE },
    why: 'Repeat the auto-stop each pass',
  },
  {
    field: 'is_auto_reverse_on',
    payload: { is_auto_reverse_on: PROBE_VALUE },
    why: 'Auto-reverse at barrier',
  },
  {
    field: 'is_auto_restart_on',
    payload: { is_auto_restart_on: PROBE_VALUE },
    why: 'Auto-restart',
  },
  { field: 'target_angle', payload: { target_angle: PROBE_VALUE }, why: 'Go-to angle' },
  { field: 'is_water_on', payload: { is_water_on: PROBE_VALUE }, why: 'Water on/off' },
]

async function runProbe(req: Request, sb: ReturnType<typeof admin>, userId: string, id: string) {
  const { data: system } = await sb
    .from('fieldnet_systems')
    .select('fieldnet_id, name, operational_status')
    .eq('fieldnet_id', id)
    .single()
  if (!system) return json({ error: 'Unknown pivot' }, 404)

  const token = await fieldnetAccessToken(sb)
  const results: Record<string, unknown>[] = []
  for (const p of PROBES) {
    const res = await fieldnetPatch(token, `/irrigation-controllers/${id}`, p.payload)
    results.push({ field: p.field, why: p.why, status: res.status, response: res.body })
  }

  // A field is plausibly writable when the API rejects it *differently* from a
  // field that doesn't exist — i.e. it recognised the name and objected to the
  // type. Identical responses mean we learned nothing about that field.
  const baseline = results.find((r) => r.field === 'zzz_not_a_real_field')
  const baselineKey = `${baseline?.status}:${JSON.stringify(baseline?.response)}`
  const verdict = results
    .filter((r) => r.field !== 'zzz_not_a_real_field')
    .map((r) => ({
      field: r.field,
      why: r.why,
      status: r.status,
      differsFromUnknownField: `${r.status}:${JSON.stringify(r.response)}` !== baselineKey,
    }))

  await sb.from('pivot_control_log').insert({
    fieldnet_id: id,
    pivot_name: system.name,
    action: 'probe',
    params: { probes: PROBES.map((p) => p.field) },
    status: 'sent',
    detail: `Capability probe (type-invalid values only, nothing actuated). ${
      verdict.filter((v) => v.differsFromUnknownField).length
    }/${verdict.length} fields responded differently from an unknown field.`,
    acted_by: userId,
  })

  return json({
    pivot: { id, name: system.name, operational_status: system.operational_status },
    note: 'All probe values were deliberately the wrong type, so nothing was actuated.',
    verdict,
    raw: results,
  })
}

async function handlePost(req: Request) {
  const sb = admin()
  const userId = await requireManager(req, sb)
  if (!userId) return json({ error: 'Only active managers can control pivots' }, 403)

  const body = (await req.json().catch(() => ({}))) as ControlBody
  if (!body.equipmentId) return json({ error: 'equipmentId is required' }, 400)

  if (body.action === 'probe') return runProbe(req, sb, userId, body.equipmentId)

  return json(
    {
      error: 'Pivot control is not authorized yet',
      detail:
        'The FieldNET panel PATCH accepts direction/speed/service_stop, but this app ' +
        'is not granted the equipment-configure policy, so control calls are refused ' +
        'with 403. Ask Lindsay to grant equipment-configure on this equipment.',
    },
    501,
  )
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method === 'GET') return handleGet(req)
  if (req.method === 'POST') return handlePost(req)
  return json({ error: 'GET or POST only' }, 405)
}
