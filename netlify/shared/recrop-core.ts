/**
 * Re-cropping (following crop) restrictions, read off a product's label text.
 *
 * The label's crop table says where a product can be SPRAYED; this reads the
 * other direction — what may be PLANTED afterwards, how many months later,
 * under what rainfall or pH conditions, and where a bioassay is needed. Only
 * the passages that talk about rotation are sent, so a 50-page label costs a
 * few thousand tokens rather than fifty thousand.
 */

export const RECROP_KEYS = [
  'canola', 'clearfield_canola', 'corn', 'potato', 'dry_bean', 'wheat', 'durum', 'barley', 'oats', 'pea',
  'alfalfa', 'carrot', 'spinach', 'sugar_beet', 'soybean', 'lentil', 'flax', 'chickpea', 'mustard', 'sunflower', 'any_other',
] as const

export type RecropRule = {
  following_crop: string
  crop_key: string | null
  months: number | null
  status: 'ok' | 'wait' | 'second_season' | 'bioassay' | 'not_listed' | 'do_not'
  condition: string | null
  quote: string | null
}

const WORDS = /(rotation|rotational|re-?crop|following crop|succeeding crop|plant(?:ed)? back|replant|may be (?:seeded|planted|grown)|following (?:season|year|spring)|bioassay|crops? (?:not listed|listed)|seeded to|months? after (?:application|treatment))/gi

/** The label's passages about what may follow, merged, capped at 40k chars. */
export function recropPassages(text: string): string {
  const spans: [number, number][] = []
  for (const m of text.matchAll(WORDS)) {
    const at = m.index ?? 0
    spans.push([Math.max(0, at - 1200), Math.min(text.length, at + 1800)])
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
    if (out.length > 40_000) break
  }
  return out.slice(0, 40_000)
}

const TOOL = {
  name: 'record_recrop',
  description: 'Record the re-cropping (following crop) restrictions this label gives.',
  input_schema: {
    type: 'object',
    properties: {
      has_restrictions: { type: 'boolean', description: 'False if the text gives no following-crop information at all.' },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            following_crop: { type: 'string', description: 'The crop exactly as the label names it.' },
            crop_key: { type: ['string', 'null'], enum: [...RECROP_KEYS, null] },
            months: { type: ['number', 'null'], description: 'Months after application before it may be planted, when the label gives months. Null otherwise.' },
            status: { type: 'string', enum: ['ok', 'wait', 'second_season', 'bioassay', 'not_listed', 'do_not'] },
            condition: { type: ['string', 'null'], description: 'Rainfall, soil zone, pH, organic matter or other condition attached, in a short phrase.' },
            quote: { type: ['string', 'null'], description: 'The label sentence this came from, verbatim, under 300 characters.' },
          },
          required: ['following_crop', 'crop_key', 'months', 'status', 'condition', 'quote'],
        },
      },
    },
    required: ['has_restrictions', 'rules'],
  },
} as const

const PROMPT = `These are the passages of a Canadian pesticide label that mention rotation or following crops.
Record every following-crop restriction the label gives, one rule per crop (or crop group) per condition.

status:
- "ok": may be planted the next season (or any time) with no stated wait — also use when a month count ≤ 11 is given (then fill months).
- "wait": a stated number of months (fill months) longer than 11.
- "second_season": "the second year/season after application" or similar with no month count.
- "bioassay": plant only after a field bioassay, or "crops not listed require a bioassay".
- "not_listed": the label says crops not on its list should not be planted (without offering a bioassay).
- "do_not": explicitly must not be planted (e.g. "Do not rotate to any crop other than X for 12 months" → every other crop is do_not with months 12, or put one rule with crop_key "any_other").

crop_key maps the label's crop to one of: ${RECROP_KEYS.join(', ')}. Use "clearfield_canola" only for Clearfield/imidazolinone-tolerant canola; plain "canola" otherwise. Use "any_other" for "all other crops", "crops not listed" and similar catch-alls. Use null if nothing fits.
When one label line lists several crops, record one rule per crop, each with its own crop_key (same months, status and quote).
Put rainfall, soil zone, pH, organic matter, irrigation or product-rate conditions in "condition". Quote the label sentence.
If the passages give no following-crop information, set has_restrictions false and rules [].`

export async function extractRecrop(passages: string, apiKey: string, model: string): Promise<{ has: boolean; rules: RecropRule[] }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: `${PROMPT}\n\n--- LABEL PASSAGES ---\n${passages}` }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const payload = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[]; stop_reason?: string }
  if (payload.stop_reason === 'max_tokens') throw new Error('Too many rules to record in one reply')
  const call = (payload.content ?? []).find((c) => c.type === 'tool_use' && c.name === TOOL.name)
  const input = (call?.input ?? {}) as { has_restrictions?: boolean; rules?: RecropRule[] }
  const keys = new Set<string>(RECROP_KEYS)
  const rules = (input.rules ?? [])
    .filter((r) => r && typeof r.following_crop === 'string' && r.following_crop.trim())
    .map((r) => ({
      following_crop: r.following_crop.trim().slice(0, 200),
      crop_key: r.crop_key && keys.has(r.crop_key) ? r.crop_key : null,
      months: typeof r.months === 'number' && Number.isFinite(r.months) && r.months >= 0 && r.months < 240 ? r.months : null,
      status: (['ok', 'wait', 'second_season', 'bioassay', 'not_listed', 'do_not'] as const).includes(r.status) ? r.status : 'bioassay',
      condition: r.condition ? String(r.condition).slice(0, 400) : null,
      quote: r.quote ? String(r.quote).slice(0, 400) : null,
    }))
  const expanded = rules.flatMap((r) => {
    const found = cropKeysIn(r.following_crop)
    return found.length > 1 ? found.map((k) => ({ ...r, crop_key: k })) : [r]
  })
  const seen = new Set<string>()
  const unique = expanded.filter((r) => {
    const id = [r.crop_key, r.months, r.status, r.condition, r.following_crop].join('|')
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  return { has: Boolean(input.has_restrictions) && unique.length > 0, rules: unique }
}

/**
 * Every crop a label line names. "Canola, Lentils, Peas, Dry Beans … 22
 * months" came back keyed to canola alone, so beans after Muster matched only
 * the catch-all; a line naming several crops becomes one rule per crop.
 */
export function cropKeysIn(text: string): string[] {
  const keys = new Set<string>()
  for (const raw of text.toLowerCase().split(/,|;|\/| and | or /)) {
    // "wheat (excluding durum)" names wheat, not durum.
    const p = raw.replace(/\([^)]*\)/g, '').split(/except|excluding/)[0].trim()
    if (!p) continue
    if (p.includes('all other') || p.includes('other crops') || p.includes('not listed')) keys.add('any_other')
    else if (p.includes('clearfield')) keys.add('clearfield_canola')
    else if (p.includes('canola') || p.includes('rapeseed')) keys.add('canola')
    else if (p.includes('durum')) keys.add('durum')
    else if (p.includes('wheat') && !p.includes('buckwheat')) keys.add('wheat')
    else if (p.includes('barley')) keys.add('barley')
    else if (p.includes('oat')) keys.add('oats')
    else if (p.includes('corn') || p.includes('maize')) keys.add('corn')
    else if (p.includes('potato')) keys.add('potato')
    else if (p.includes('soy')) keys.add('soybean')
    else if (p.includes('bean') && !p.includes('faba')) keys.add('dry_bean')
    else if (p.includes('chickpea')) keys.add('chickpea')
    else if (p.includes('pea') && !p.includes('peanut')) keys.add('pea')
    else if (p.includes('lentil')) keys.add('lentil')
    else if (p.includes('flax')) keys.add('flax')
    else if (p.includes('mustard')) keys.add('mustard')
    else if (p.includes('sunflower')) keys.add('sunflower')
    else if (p.includes('alfalfa')) keys.add('alfalfa')
    else if (p.includes('carrot')) keys.add('carrot')
    else if (p.includes('spinach')) keys.add('spinach')
    else if (p.includes('sugar beet') || p.includes('sugarbeet')) keys.add('sugar_beet')
  }
  return [...keys]
}
