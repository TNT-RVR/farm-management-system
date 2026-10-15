import type { SupabaseClient } from '@supabase/supabase-js'
import { GRAZING_CROP_KEYS, grazingKeys, type GrazingKind } from '../../src/lib/grazing-restrictions.ts'

/**
 * Grazing and feeding restrictions, read off a product's label into rules a
 * date can be worked out from.
 *
 * The label extraction already keeps the grazing sentence as text
 * (chemical_labels.grazing_restriction), but "Do not graze or feed crop to
 * livestock within 60 days" and "DO NOT graze treated wheat… within 25 days;
 * perennial ryegrass… 7 days" are not something a date can come from. This
 * sends that sentence and the label passages about grazing, feeding, hay,
 * forage, slaughter and dairy to Claude and records one rule per kind, per
 * crop. Some labels say "the interval in the crop table" — the table's
 * passages go along for that.
 */

export type ExtractedGrazingRule = {
  crop: string | null
  crop_key: string | null
  kind: GrazingKind
  days: number | null
  never: boolean
  condition: string | null
  quote: string | null
}

const WORDS = /(graz|livestock|forage|\bhay\b|silage|green ?feed|fodder|straw|aftermath|screenings|slaughter|dairy|feed(?:ing)? (?:the )?treated|fed to)/gi

/** The label's passages about grazing and feed, merged, capped at 30k chars. */
export function grazingPassages(text: string): string {
  const spans: [number, number][] = []
  for (const m of text.matchAll(WORDS)) {
    const at = m.index ?? 0
    spans.push([Math.max(0, at - 600), Math.min(text.length, at + 900)])
  }
  if (!spans.length) return ''
  spans.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else merged.push([...s])
  }
  let out = ''
  for (const [a, b] of merged) {
    out += text.slice(a, b) + '\n…\n'
    if (out.length > 30_000) break
  }
  return out.slice(0, 30_000)
}

/** Keys the model may use: ours, plus "other" for a named crop we do not grow. */
const KEYS = [...GRAZING_CROP_KEYS, 'other'] as const

const TOOL = {
  name: 'record_grazing',
  description: 'Record the grazing, livestock-feeding, slaughter and dairy restrictions this label gives.',
  input_schema: {
    type: 'object',
    properties: {
      has_restrictions: { type: 'boolean', description: 'False if the label says nothing about grazing, feeding the crop to livestock, slaughter or dairy animals.' },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            crop: { type: ['string', 'null'], description: 'The crop exactly as the label names it; null when the line covers every crop on the label.' },
            crop_key: { type: ['string', 'null'], enum: [...KEYS, null] },
            kind: { type: 'string', enum: ['graze', 'feed', 'slaughter', 'dairy'] },
            days: { type: ['number', 'null'], description: 'Days after application. 0 when the label says there is no restriction. Null with never.' },
            never: { type: 'boolean', description: 'True when the label says not at all for the treated crop (no day count).' },
            condition: { type: ['string', 'null'], description: 'Number of applications, rate, grown-for-seed, winter vs spring, or other condition, in a short phrase.' },
            quote: { type: ['string', 'null'], description: 'The label sentence this came from, verbatim, under 300 characters.' },
          },
          required: ['crop', 'crop_key', 'kind', 'days', 'never', 'condition', 'quote'],
        },
      },
    },
    required: ['has_restrictions', 'rules'],
  },
} as const

const PROMPT = `This is a Canadian pesticide label's grazing restriction as summarised earlier, followed by the label passages that mention grazing, livestock, forage, hay, silage, straw, slaughter or dairy animals.
Record every restriction on animals eating the treated crop, one rule per kind per crop (or crop group) per condition.

kind:
- "graze": animals grazing the treated crop or treated area.
- "feed": cutting or harvesting the treated crop to feed livestock — hay, forage, green feed, green chop, silage, fodder, straw, screenings, aftermath — or "do not feed the treated crop to livestock". A grain pre-harvest interval is NOT a feed rule unless the label ties it to feeding livestock.
- "slaughter": "withdraw meat animals from treated fields N days before slaughter" (days N).
- "dairy": lactating dairy animals kept off treated fields (days N).

days / never:
- "within 60 days of application", "until 30 days after", "may be grazed 7 days following" → days.
- "allow 3 to 5 days before grazing" → the longer figure (5).
- "do not graze the treated crop or cut for hay" (no day count, or "sufficient data are not available") → never true, days null.
- an explicit "no restriction" / "can be grazed or fed immediately" / "0 days" → days 0, never false.
"Do not graze or feed within 60 days" is TWO rules (graze 60 and feed 60). "Do not graze or cut for hay" is graze never + feed never.

crops: crop null and crop_key null only when the line covers every crop on the label. Otherwise name the crop and map crop_key to one of: ${KEYS.join(', ')}.
Use "grass" for forage grasses, pasture, rangeland and grass grown for seed; "other" for a named crop not in the list (peanuts, ryegrass…). When one line lists several crops, record one rule per crop with its own crop_key.
Exceptions: "Except for alfalfa, do not graze…" is a general never rule plus an alfalfa rule (with the label's own interval for alfalfa if given, else days 0).
When the label says to observe "the interval in the crop table", read each crop's grazing/feeding interval from the passages and record it per crop.
Put the number of applications, rate, winter vs spring, grown-for-seed or other conditions in "condition". Quote the label sentence.
If nothing in the text restricts grazing or feeding, set has_restrictions false and rules [].`

/** Every crop key a label line names ("wheat, triticale and barley" → three). */
export function grazingKeysIn(text: string): string[] {
  const keys = new Set<string>()
  for (const part of text.toLowerCase().split(/,|;|\/| and | or /)) {
    const p = part.replace(/\([^)]*\)/g, '').split(/except|excluding/)[0].trim()
    if (p) for (const k of grazingKeys(p)) keys.add(k)
  }
  return [...keys]
}

const ALL_CROPS = /^(all|any|every)\b|all crops|crops? on (this|the) label/i

export async function extractGrazingRules(summary: string, passages: string, apiKey: string, model: string): Promise<{ has: boolean; rules: ExtractedGrazingRule[] }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: `${PROMPT}\n\n--- GRAZING RESTRICTION (summary) ---\n${summary || '(none recorded)'}\n\n--- LABEL PASSAGES ---\n${passages || '(none)'}` }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const payload = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[]; stop_reason?: string }
  if (payload.stop_reason === 'max_tokens') throw new Error('Too many rules to record in one reply')
  const call = (payload.content ?? []).find((c) => c.type === 'tool_use' && c.name === TOOL.name)
  const input = (call?.input ?? {}) as { has_restrictions?: boolean; rules?: ExtractedGrazingRule[] | string }
  // The model now and then hands the list back as a JSON string rather than
  // an array (23 of 92 labels on the first read); take either.
  let rules: unknown = input.rules ?? []
  if (typeof rules === 'string') {
    try {
      rules = JSON.parse(rules)
    } catch {
      throw new Error('The rules came back as text that is not a list')
    }
  }
  return { has: Boolean(input.has_restrictions), rules: cleanRules(Array.isArray(rules) ? (rules as ExtractedGrazingRule[]) : []) }
}

/** Tidy the model's rules: valid kinds and days, a named crop never read as "every crop", one rule per crop. */
export function cleanRules(raw: ExtractedGrazingRule[]): ExtractedGrazingRule[] {
  const keys = new Set<string>(KEYS)
  const rules = raw
    .filter((r) => r && (['graze', 'feed', 'slaughter', 'dairy'] as const).includes(r.kind))
    .map((r) => {
      const crop = r.crop && String(r.crop).trim() && !ALL_CROPS.test(String(r.crop)) ? String(r.crop).trim().slice(0, 200) : null
      const days = typeof r.days === 'number' && Number.isFinite(r.days) && r.days >= 0 && r.days < 3650 ? Math.ceil(r.days) : null
      const never = Boolean(r.never) && r.kind !== 'slaughter'
      // A crop the label names that we have no key for must not fall back to
      // "every crop" — that would put its interval on everything.
      const crop_key = crop ? (r.crop_key && keys.has(r.crop_key) ? r.crop_key : 'other') : null
      return {
        crop,
        crop_key,
        kind: r.kind,
        days: never ? null : days,
        never,
        condition: r.condition ? String(r.condition).slice(0, 400) : null,
        quote: r.quote ? String(r.quote).slice(0, 400) : null,
      }
    })
    // A rule with neither a day count nor "never" says nothing usable.
    .filter((r) => r.never || r.days != null)
  const expanded = rules.flatMap((r) => {
    if (!r.crop) return [r]
    const found = grazingKeysIn(r.crop)
    return found.length > 1 ? found.map((k) => ({ ...r, crop_key: k })) : [r]
  })
  const seen = new Set<string>()
  return expanded.filter((r) => {
    const id = [r.crop_key, r.kind, r.days, r.never, r.condition].join('|')
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

type LabelRow = {
  registration_number: string
  label_text: string | null
  grazing_restriction: string | null
  extracted_at: string | null
  updated_at: string | null
  manual_fields: string[] | null
  grazing_rules_extracted_at: string | null
}

/**
 * Labels whose grazing rules need reading: never read, re-read from a newer
 * label since, or the grazing sentence corrected by hand since.
 */
export function needsGrazingRead(l: LabelRow): boolean {
  if (!l.label_text && !l.grazing_restriction) return false
  const done = l.grazing_rules_extracted_at
  if (!done) return true
  if (l.extracted_at && l.extracted_at > done) return true
  return Boolean(l.manual_fields?.includes('grazing_restriction') && l.updated_at && l.updated_at > done)
}

/**
 * Read the grazing rules of every label that needs it (or all, with force),
 * within a time budget. Rules a person typed (source manual) are never touched.
 */
export async function extractPendingGrazingRules(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  opts: { force?: boolean; budgetMs: number },
): Promise<{ read: number; failed: number; remaining: number }> {
  const started = Date.now()
  const labels: LabelRow[] = []
  for (let from = 0; ; from += 200) {
    const { data, error } = await sb
      .from('chemical_labels')
      .select('registration_number, label_text, grazing_restriction, extracted_at, updated_at, manual_fields, grazing_rules_extracted_at')
      .order('registration_number')
      .range(from, from + 199)
    if (error) throw new Error(error.message)
    labels.push(...((data ?? []) as LabelRow[]))
    if ((data ?? []).length < 200) break
  }
  const todo = labels.filter((l) => (opts.force ? Boolean(l.label_text || l.grazing_restriction) : needsGrazingRead(l)))
  let read = 0
  let failed = 0
  for (const l of todo) {
    if (Date.now() - started > opts.budgetMs) break
    const reg = l.registration_number
    try {
      const passages = grazingPassages(String(l.label_text ?? ''))
      const got = passages || l.grazing_restriction ? await extractGrazingRules(String(l.grazing_restriction ?? ''), passages, apiKey, model) : { has: false, rules: [] }
      await sb.from('chemical_grazing_rules').delete().eq('registration_number', reg).eq('source', 'label')
      if (got.rules.length) {
        const { error: insErr } = await sb.from('chemical_grazing_rules').insert(got.rules.map((r) => ({ ...r, registration_number: reg, source: 'label' })))
        if (insErr) throw new Error(insErr.message)
      }
      await sb
        .from('chemical_labels')
        .update({ grazing_rules_extracted_at: new Date().toISOString(), grazing_rules_status: got.rules.length ? 'read' : 'none_on_label', grazing_rules_note: null })
        .eq('registration_number', reg)
      read++
    } catch (e) {
      failed++
      await sb
        .from('chemical_labels')
        .update({ grazing_rules_status: 'failed', grazing_rules_note: (e as Error).message.slice(0, 300), grazing_rules_extracted_at: new Date().toISOString() })
        .eq('registration_number', reg)
    }
  }
  const remaining = todo.length - read - failed
  return { read, failed, remaining }
}
