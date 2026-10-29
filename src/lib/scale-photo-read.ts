import { supabase } from './supabase'
import { shrinkForReading } from './shrink-image'

/**
 * The weight read off the photo of the scale (Sam, 27 Oct 2026). The photo
 * is taken and kept either way; this only saves typing the number in, and
 * whoever is at the scale sees it in the box before anything is saved.
 */
export type ScaleRead = {
  /** The number as the scale showed it, in `unit`. */
  weight: number | null
  unit: 'kg' | 'lb' | 't' | 'unknown'
  /** The same weight in kilograms, which is what a load is stored in. */
  kg: number | null
  /**
   * The photo was read twice, by two models, and they came out the same.
   * Only an agreed weight is ever put in the box for somebody: a glare across
   * a seven-segment digit turns 8 into 0, and one read is sure of itself when
   * it is wrong.
   */
  agreed: boolean
  /** What each read made of it, for saying how they differed. */
  reads: (number | null)[]
  shows: 'live' | 'gross' | 'tare' | 'net' | 'unknown'
  kind: string
  confidence: 'high' | 'medium' | 'low'
  note: string
}

/**
 * A weight nobody would see on a farm scale is not filled in on its own: a
 * misread digit that turns 21,090 into 210,900 would otherwise go in as a
 * load. Outside this, the number is offered to tap instead.
 */
export const SENSIBLE_KG = { min: 500, max: 120_000 }
export const sensibleWeight = (kg: number | null | undefined): boolean =>
  kg != null && Number.isFinite(kg) && kg >= SENSIBLE_KG.min && kg <= SENSIBLE_KG.max

/** A weight is filled in only when both reads agree and it could be real. */
export const usableRead = (r: ScaleRead): boolean => r.agreed && sensibleWeight(r.kg)

/** Send a photo of the scale to be read. The photo itself is not stored by this. */
export async function readScalePhoto(file: Blob): Promise<ScaleRead> {
  // Bigger than a screenshot is shrunk to: the digits are a small part of the
  // frame, and detail lost here is a misread digit.
  const img = await shrinkForReading(file, 2000)
  const type = img.type || 'image/jpeg'
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/read-scale-photo', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': type, 'x-media-type': type },
    body: img,
  })
  const body = (await res.json().catch(() => ({}))) as ScaleRead & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `Could not read the photo (${res.status})`)
  return body
}
