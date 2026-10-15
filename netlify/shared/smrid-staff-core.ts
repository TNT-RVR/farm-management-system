import type { SupabaseClient } from '@supabase/supabase-js'

// Confirms who the SMRID water coordinator is for each area, against the public
// staff directory. SMRID reshuffles areas between seasons, so a name that was
// right last year may not be right this year — and phoning the wrong coordinator
// about water is a wasted morning.
//
// Deliberately defensive: this scrapes HTML, which will change without warning.
// If parsing yields nothing, or yields fewer areas than we already know about,
// it records an error and CHANGES NOTHING. Wiping real phone numbers because a
// page redesign broke a regex would be far worse than stale data.

export const SMRID_DIRECTORY_URL = 'https://smrid.com/smrid-about/staff-directory/'

export type ParsedCoordinator = { area: number; name: string; phone: string }

/**
 * Pull (area, name, phone) triples out of the directory HTML.
 *
 * The page lists coordinators in tables of Name / Area / Phone. Rather than
 * depend on a specific table structure, this strips tags and looks for the
 * repeating shape: a person's name, then a bare area number, then a phone.
 */
export function parseDirectory(html: string): ParsedCoordinator[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const NAME = /^[A-Z][A-Za-z'’.-]+(?: [A-Z][A-Za-z'’.-]+){1,3}$/
  const AREA = /^(\d{1,3})$/
  const PHONE = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
  // Column headings look exactly like two-word names ("Contact Person"), and
  // would otherwise swallow the first real row beneath them.
  const HEADING =
    /\b(contact|person|area|phone|name|coordinator|director|manager|staff|directory|email|title|position|water)\b/i

  const isName = (v: string) => NAME.test(v) && !HEADING.test(v)

  const out: ParsedCoordinator[] = []
  for (let i = 0; i < text.length; i++) {
    if (!isName(text[i])) continue
    // Look ahead for this person's area then phone. Stop at the next name —
    // without that, a heading reaches past its own row and steals the values
    // belonging to the person below it.
    let area: number | null = null
    let phone: string | null = null
    for (let j = i + 1; j < Math.min(i + 6, text.length); j++) {
      if (isName(text[j])) break
      if (area == null && AREA.test(text[j])) {
        area = Number(text[j])
        continue
      }
      if (area != null) {
        const m = text[j].match(PHONE)
        if (m) {
          phone = m[0]
          break
        }
      }
    }
    if (area != null && phone) out.push({ area, name: text[i], phone })
  }

  // One row per area; first occurrence wins (some areas list a second contact).
  const seen = new Set<number>()
  return out.filter((c) => (seen.has(c.area) ? false : (seen.add(c.area), true)))
}

export type StaffCheckResult = {
  ok: boolean
  parsed: number
  changed: { area: number; from: string; to: string }[]
  detail: string
}

export async function runSmridStaffCheck(sb: SupabaseClient): Promise<StaffCheckResult> {
  const { data: existing } = await sb
    .from('smrid_areas')
    .select('area_number, coordinator_name, coordinator_phone')
  const known = existing ?? []

  let html: string
  try {
    const res = await fetch(SMRID_DIRECTORY_URL, {
      // A polite scraper says who it is; the contact is the farm's own (Farm setup).
      headers: { 'User-Agent': `RVR-Management/1.0 (farm management app${process.env.FARM_SUPPORT_EMAIL ? `; contact ${process.env.FARM_SUPPORT_EMAIL}` : ''})` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
  } catch (e) {
    return { ok: false, parsed: 0, changed: [], detail: `Could not fetch the directory: ${(e as Error).message}` }
  }

  const parsed = parseDirectory(html)

  // Guard: never let a broken parse overwrite good data.
  if (parsed.length === 0) {
    return { ok: false, parsed: 0, changed: [], detail: 'Fetched the page but parsed no coordinators — the layout has probably changed. Nothing was updated.' }
  }
  if (known.length > 0 && parsed.length < known.length / 2) {
    return {
      ok: false,
      parsed: parsed.length,
      changed: [],
      detail: `Only parsed ${parsed.length} coordinators but we already know ${known.length}. Refusing to update on a partial read.`,
    }
  }

  const byArea = new Map(known.map((k) => [k.area_number as number, k]))
  const changed: StaffCheckResult['changed'] = []
  const now = new Date().toISOString()

  for (const c of parsed) {
    const prev = byArea.get(c.area)
    const prevStr = prev ? `${prev.coordinator_name ?? '—'} ${prev.coordinator_phone ?? ''}`.trim() : '(new)'
    const nextStr = `${c.name} ${c.phone}`
    if (!prev || prev.coordinator_name !== c.name || prev.coordinator_phone !== c.phone) {
      changed.push({ area: c.area, from: prevStr, to: nextStr })
    }
    await sb.from('smrid_areas').upsert(
      {
        area_number: c.area,
        coordinator_name: c.name,
        coordinator_phone: c.phone,
        checked_at: now,
        source_url: SMRID_DIRECTORY_URL,
        updated_at: now,
      },
      { onConflict: 'area_number' },
    )
  }

  // Only shout about areas we actually farm — a reshuffle in Area 105 is noise.
  const { data: used } = await sb.from('field_pivots').select('smrid_area').not('smrid_area', 'is', null)
  const ourAreas = new Set((used ?? []).map((u) => u.smrid_area as number))
  const relevant = changed.filter((c) => ourAreas.has(c.area))

  if (relevant.length > 0) {
    await sb.rpc('fn_notify_managers', {
      p_kind: 'irrigation',
      p_title: 'SMRID water coordinator changed',
      p_body: relevant.map((c) => `Area ${c.area}: ${c.from} → ${c.to}`).join('; '),
      p_link: '/irrigation-info',
    })
  }

  const detail =
    relevant.length > 0
      ? `${relevant.length} coordinator change(s) on areas we farm.`
      : `Checked ${parsed.length} areas — no change on the areas we farm.`

  // Heartbeat for the integration-health monitor, so a scrape that quietly stops
  // working shows up as stale rather than going unnoticed until someone needs a
  // phone number.
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'smrid_staff',
    p_detail: detail,
    p_data_at: null,
  })

  return { ok: true, parsed: parsed.length, changed, detail }
}
