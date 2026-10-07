/**
 * eShepherd's cycling model, read as a pregnancy call.
 *
 * The collars detect heats. eShepherd's model reports what it saw — heats, or
 * their absence — and says plainly that it never claims a cause. We turn that
 * into the simple call a rancher wants, and say how sure it is:
 *
 *   Pregnant (likely)  no heat for about two and a half cycles — the collar's
 *                      pregnancy signal. Illness, poor condition or a collar
 *                      fault look the same, so preg-check to confirm.
 *   Not pregnant       she is cycling.
 *   Unsure             anything in between, or not enough data to say.
 *
 * Due date: counted from her last detected heat, taken as the breeding date.
 * Angus gestation averages about 283 days (the usual range 276–290). If the
 * collar missed the heat she actually caught on, she calves about three weeks
 * later than the date shown — which is why it is a range.
 */

export type ReproState =
  | 'NO_DATA'
  | 'NOT_ENOUGH_HISTORY'
  | 'NO_CYCLING_SEEN_YET'
  | 'CYCLING'
  | 'CYCLING_RESUMED'
  | 'OVERDUE'
  | 'LIKELY_NOT_CYCLING'
  | 'NO_CYCLING_DETECTED'
  | 'POSSIBLE_RETURN'

export type Call = 'pregnant' | 'open' | 'unsure'

/** eShepherd's own labels and explanations (their dashboard, model 2.0.0). */
export const REPRO_STATES: Record<ReproState, { label: string; note: string; call: Call; leaning?: string }> = {
  NO_DATA: { label: 'No data', call: 'unsure', note: 'The collar reported fewer than 8 of the last 21 nights, so no call is made. Check the collar.' },
  NOT_ENOUGH_HISTORY: { label: 'Not enough history', call: 'unsure', note: 'Fewer than 30 nights of data so far. Not assessed yet — this is not a result.' },
  NO_CYCLING_SEEN_YET: { label: 'No cycling seen yet', call: 'unsure', note: 'No heat detected since monitoring began. Common for heifers before puberty and cows soon after calving.' },
  CYCLING: { label: 'Cycling', call: 'open', note: 'A heat was detected recently.' },
  CYCLING_RESUMED: { label: 'Cycling resumed', call: 'open', note: 'After a long stretch with no heats she has shown three in a row, so she is cycling again.' },
  OVERDUE: { label: 'Overdue', call: 'unsure', leaning: 'maybe bred', note: 'About one cycle since her last detected heat. A cycling animal passes through here for a few days before her next heat — watch, don’t act yet.' },
  LIKELY_NOT_CYCLING: { label: 'Likely not cycling', call: 'unsure', leaning: 'leaning pregnant', note: 'About seven weeks with no heat detected — a few days short of “No cycling detected”.' },
  NO_CYCLING_DETECTED: { label: 'No cycling detected', call: 'pregnant', note: 'No heat detected for about two and a half cycles. Pregnancy is one explanation; illness, poor condition, anoestrus or a collar problem look the same, so confirm before acting.' },
  POSSIBLE_RETURN: { label: 'Possible return to cycling', call: 'unsure', leaning: 'may have lost it', note: 'Heat activity after a long stretch without any — one or two of the three heats needed to confirm a return. Worth a vet check.' },
}

export const CALL_LABEL: Record<Call, string> = { pregnant: 'Pregnant', open: 'Not pregnant', unsure: 'Unsure' }

export function stateInfo(state: string) {
  return REPRO_STATES[state as ReproState] ?? { label: state, note: 'A status this page doesn’t know yet.', call: 'unsure' as Call }
}

/** Days from breeding to calving for Angus cattle: mean and the usual range. */
export const GESTATION = { mean: 283, early: 276, late: 290 }

const addDays = (iso: string, d: number) => {
  const t = new Date(iso + 'T12:00:00')
  t.setDate(t.getDate() + d)
  return t.toISOString().slice(0, 10)
}

/**
 * Due date from the last detected heat. Only where the model is pointing at
 * pregnancy (pregnant, or unsure but leaning that way) — for a cycling cow the
 * last heat is simply her last heat.
 */
export function dueRange(state: string, lastHeat: string | null): { likely: string; from: string; to: string; tentative: boolean } | null {
  if (!lastHeat) return null
  const s = state as ReproState
  if (s !== 'NO_CYCLING_DETECTED' && s !== 'LIKELY_NOT_CYCLING' && s !== 'OVERDUE') return null
  return { likely: addDays(lastHeat, GESTATION.mean), from: addDays(lastHeat, GESTATION.early), to: addDays(lastHeat, GESTATION.late), tentative: s !== 'NO_CYCLING_DETECTED' }
}

/** Mobs named for a ranch belong to it; bull mobs and the water-trough collars are left out. */
export function mobRanch(mob: string, ranches: { id: string; name: string }[]): { ranchId: string | null; skip: boolean } {
  const m = mob.toLowerCase()
  if (m.includes('bull') || m.includes('water trough')) return { ranchId: null, skip: true }
  const r = ranches.find((x) => m.includes(x.name.toLowerCase()))
  return { ranchId: r?.id ?? null, skip: false }
}

/**
 * The call, read against the breeding season. eShepherd can only say "No
 * cycling detected" about 53 days after the heat she was bred on, so for the
 * first two months after the bulls go in most bred cows still read "Cycling"
 * or "Overdue". With the bull date known:
 *
 *   stopped cycling, last heat after the bulls went in  → pregnant
 *   stopped cycling, last heat BEFORE the bulls         → unsure: she wasn't
 *                                                         bred by these bulls
 *   one heat since the bulls, none after it             → unsure: likely bred
 *                                                         then, too early to tell
 *   two or more heats since the bulls, cycling          → not pregnant (yet):
 *                                                         she came back
 */
export type Reading = { call: Call; why: string; due: ReturnType<typeof dueRange>; tooEarlyUntil: string | null }

export function readAnimal(a: { state: string; last_heat: string | null; heats: string[] }, bullsIn: string | null, asOf: string): Reading {
  const info = stateInfo(a.state)
  const s = a.state as ReproState
  const plain: Reading = { call: info.call, why: info.leaning ?? '', due: dueRange(a.state, a.last_heat), tooEarlyUntil: null }
  if (!bullsIn) return plain
  const since = a.heats.filter((h) => h >= bullsIn)
  const bredHeat = a.last_heat && a.last_heat >= bullsIn ? a.last_heat : null
  const sure = bredHeat ? addDays(bredHeat, 53) : null
  const fmt = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  const due = (tentative: boolean) => (bredHeat ? { ...dueRange('NO_CYCLING_DETECTED', bredHeat)!, tentative } : null)

  if (s === 'NO_CYCLING_DETECTED' || s === 'LIKELY_NOT_CYCLING') {
    if (bredHeat) return { call: s === 'NO_CYCLING_DETECTED' ? 'pregnant' : 'unsure', why: s === 'NO_CYCLING_DETECTED' ? `bred ${fmt(bredHeat)}` : `bred ${fmt(bredHeat)}? no heat since`, due: due(s !== 'NO_CYCLING_DETECTED'), tooEarlyUntil: null }
    return { call: 'unsure', why: a.last_heat ? `stopped cycling ${fmt(a.last_heat)}, before the bulls went in — not bred by them; check her` : 'no heat seen since her collar went on — check her', due: null, tooEarlyUntil: null }
  }
  if (s === 'CYCLING' || s === 'CYCLING_RESUMED' || s === 'OVERDUE') {
    if (since.length >= 2 && s !== 'OVERDUE') return { call: 'open', why: `came back into heat after the bulls went in (${since.map(fmt).join(', ')})`, due: null, tooEarlyUntil: null }
    if (bredHeat) {
      const early = sure != null && sure > asOf
      return {
        call: 'unsure',
        why: `heat ${fmt(bredHeat)} — likely bred then${since.length >= 2 ? ' (second time)' : ''}; ${early ? `too early to tell until about ${fmt(sure!)}` : 'watch for a return'}`,
        due: due(true),
        tooEarlyUntil: early ? sure : null,
      }
    }
  }
  return plain
}
