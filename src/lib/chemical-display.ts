/**
 * Making the pesticide registry readable, and narrowing it to this farm.
 *
 * Health Canada publishes every name, ingredient, pest and site in capitals —
 * "ROUNDUP WEATHERMAX WITH TRANSORB 2 TECHNOLOGY LIQUID HERBICIDE", "WILD OATS,
 * GREEN FOXTAIL, KOCHIA". A screen of that reads as shouting and is slow to
 * scan, so it is put back into ordinary case for display. The stored text is
 * untouched; this only changes how it is drawn.
 */

import { cropMatches, normaliseCrop } from '@/lib/cropLabelMatch'
import { cropKey, type CropKey } from '@/lib/rotation-engine'

/**
 * Tokens that stay in capitals: company names, formulation codes and units
 * that are written that way on the jug. Anything else in a shouting string is
 * lowered.
 */
const KEEP_UPPER = new Set([
  'BASF', 'FMC', 'UPL', 'ADAMA', 'AMVAC', 'NUFARM', 'DOW', 'CPC', 'PMRA', 'USA',
  'EC', 'SC', 'SE', 'SL', 'SN', 'CS', 'ME', 'WG', 'WDG', 'WP', 'DF', 'DG', 'GR',
  'EW', 'OD', 'FS', 'XL', 'XC', 'MX', 'LV', 'HL', 'II', 'III', 'IV', 'VI',
  'MCPA', 'MCPB', 'MCPP', '2,4-D', '2,4-DB', 'UAN', 'AMS', 'NIS', 'MSO', 'ULV',
  'PHI', 'REI', 'L', 'G', 'N', 'P', 'K',
])

/** Mostly capitals: the registry's shouting, not someone's deliberate acronym. */
const isShouting = (s: string) => {
  const letters = s.replace(/[^A-Za-z]/g, '')
  if (letters.length < 4) return false
  const upper = letters.replace(/[^A-Z]/g, '').length
  return upper / letters.length > 0.8
}

const fixToken = (word: string, lowerIt: (w: string) => string) => {
  const bare = word.replace(/[^A-Za-z0-9,-]/g, '')
  if (KEEP_UPPER.has(bare.toUpperCase()) && bare === bare.toUpperCase()) return word
  // A token with a digit in it ("2", "480", "B2") is a code, not a word.
  if (/\d/.test(bare) && bare.length <= 4) return word
  return lowerIt(word)
}

/**
 * A product name in title case: "Roundup Weathermax With Transorb 2 Technology
 * Liquid Herbicide" rather than capitals. Small joining words stay lower.
 */
export function productName(name: string | null | undefined): string {
  if (!name) return ''
  if (!isShouting(name)) return name
  const small = new Set(['and', 'or', 'with', 'for', 'of', 'the', 'in', 'on', 'a', 'an', 'to'])
  return name
    .split(/(\s+)/)
    .map((w, i) =>
      /^\s+$/.test(w)
        ? w
        : fixToken(w, (t) => {
            const lower = t.toLowerCase()
            if (i > 0 && small.has(lower)) return lower
            return lower.replace(/(^|[-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase())
          }),
    )
    .join('')
}

/**
 * Running text — ingredients, pests, sites — in sentence case: "Wild oats,
 * green foxtail, kochia". Only the first letter is raised, so a list reads
 * as a list rather than as a row of headings.
 */
export function readable(text: string | null | undefined): string {
  if (!text) return ''
  if (!isShouting(text)) return text
  const lowered = text
    .split(/(\s+)/)
    .map((w) => (/^\s+$/.test(w) ? w : fixToken(w, (t) => t.toLowerCase())))
    .join('')
  return lowered.replace(/^(\s*\W*)([a-z])/, (_, p, c) => p + c.toUpperCase())
}

const HA_PER_AC = 0.40468564224

/** Three significant figures, no trailing zeros: 0.405, 4.05, 40.5, 405. */
const sig = (n: number) => {
  if (n === 0) return '0'
  const p = n >= 100 ? Math.round(n).toString() : Number(n.toPrecision(3)).toString()
  return p
}

/**
 * A label rate in per-acre terms: "0.5 – 1.0 L/ha" reads "0.2 – 0.405 L/ac".
 *
 * Labels are registered in metric, per hectare; this farm thinks per acre.
 * Only the display changes — the stored text is the label's own. Every
 * amount "per hectare" is converted, ranges included, in L, mL, g, kg or lb.
 * Text that already gives a per-acre figure is left exactly as written, as
 * is anything per something else ("L per 100 L of water"), which is a mixing
 * ratio, not a rate on the ground.
 */
export function perAcre(text: string | null | undefined): string {
  if (!text) return ''
  if (/\/\s*ac\b|per\s+acre|\bacres?\b/i.test(text)) return text
  const num = String.raw`(\d+(?:[.,]\d+)?)`
  const re = new RegExp(
    String.raw`${num}(?:\s*(?:-|–|to)\s*${num})?\s*(mL|ml|L|l|kg|g|lb|oz)\s*(?:\/|per\s+)\s*(?:ha|hectare)\b`,
    'g',
  )
  return text.replace(re, (_m, a: string, b: string | undefined, unit: string) => {
    const conv = (s: string) => sig(Number(s.replace(',', '.')) * HA_PER_AC)
    const u = unit === 'ml' ? 'mL' : unit === 'l' ? 'L' : unit
    return b ? `${conv(a)} – ${conv(b)} ${u}/ac` : `${conv(a)} ${u}/ac`
  })
}

/**
 * The Deere crop code each kind of crop is known by, so the careful label
 * matcher in cropLabelMatch can be used for the crops it knows. That matcher
 * keeps sweet corn off field corn's interval; reusing it means the "your
 * crops" view can never put one crop's numbers under another's name.
 */
const DEERE_CODE: Partial<Record<CropKey, string>> = {
  canola: 'CANOLA',
  seed_canola: 'CANOLA',
  corn: 'CORN_WET',
  potato: 'POTATOES_FOR_RETAIL',
  dry_bean: 'EDIBLE_BEANS',
  durum: 'WHEAT_DURUM',
  wheat: 'WHEAT_SPRING',
  barley: 'BARLEY',
  alfalfa: 'ALFALFA',
  carrot: 'CARROTS',
}

/** Same word, singular or plural: "pea" and "peas", "oat" and "oats". */
const stem = (s: string) => s.replace(/(es|s)$/, '')

/**
 * Which of the farm's crops a label row is about, or null.
 *
 * Crops the label matcher knows go through it. The rest (oats, peas, spinach,
 * sainfoin…) match only when the label names the crop itself, word for word
 * allowing a plural — never a near miss. A crop that cannot be matched simply
 * stays under "everything else"; nothing is hidden, only reordered.
 */
export function farmCropFor(labelCrop: string, farmCrops: string[]): string | null {
  for (const crop of farmCrops) {
    const code = DEERE_CODE[cropKey(crop)]
    if (code) {
      if (cropMatches(code, labelCrop)) return crop
      continue
    }
    const label = normaliseCrop(labelCrop)
    const mine = normaliseCrop(crop)
    if (!label || !mine) continue
    if (stem(label) === stem(mine) || label.startsWith(mine + ' ')) return crop
  }
  return null
}
