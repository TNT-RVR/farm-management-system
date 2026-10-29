/**
 * The phone's own voice: listening (Web Speech recognition) for the say-it
 * boxes, and speaking (speech synthesis) for answers read aloud. Both are the
 * browser's, so nothing is sent anywhere to hear or to speak. Where a phone
 * has neither, the boxes still take typing and the answer is still written.
 */

export type Recognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

export function makeRecognizer(continuous = true): Recognizer | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = 'en-CA'
  r.continuous = continuous
  r.interimResults = true
  return r
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * Called from the tap that asks: iPhones only let a page speak after a tap,
 * and the answer arrives later, from a poll. An empty utterance on the tap
 * opens the way.
 */
export function unlockSpeech() {
  if (!canSpeak()) return
  try {
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))
  } catch {
    /* not on this phone */
  }
}

/** The answer as it should sound: no markdown, links read by their names, bullets as pauses. */
export function plainForSpeech(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[*_`#>]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?:;]$/.test(l) ? l : `${l}.`))
    .join(' ')
}

export function speak(md: string, onEnd?: () => void) {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(plainForSpeech(md))
  u.lang = 'en-CA'
  const voice = synth.getVoices().find((v) => v.lang === 'en-CA') ?? synth.getVoices().find((v) => v.lang.startsWith('en'))
  if (voice) u.voice = voice
  if (onEnd) u.onend = onEnd
  synth.speak(u)
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel()
}
