/**
 * Reading a Messages API reply in a function the person waits on.
 *
 * The model thinks before it answers unless told not to, and a short
 * max_tokens can go entirely on thinking: HTTP 200, no text, and the page
 * says nothing useful. These calls send `thinking: { type: 'disabled' }`, and
 * any reply that is empty, cut off or declined comes back as an error naming
 * the stop reason and what was in it.
 */
export type MessagesReply = {
  content?: { type: string; text?: string }[]
  stop_reason?: string | null
}

/**
 * The model for advice worth waiting for: rotation plans and soil write-ups.
 * Both run as background jobs, so a slower, stronger model costs no one a
 * spinner. Compared on real farm data on 29 Sep 2026: Opus 5.5 was the only
 * one with no factual slips on the rotation plans.
 */
export const advisorModel = () => process.env.ANTHROPIC_ADVISOR_MODEL ?? 'claude-opus-5-5'

/**
 * Opus 5.5, Fable and Mythos always think. They refuse `thinking: disabled`
 * and a forced tool_choice, so a call to them names its tool in the prompt and
 * sets effort instead — and gets max_tokens with room for the thinking.
 */
export const alwaysThinks = (model: string) => /^claude-(opus-5-5|fable|mythos)/.test(model)

/** The text blocks of a reply, joined. */
export const replyText = (reply: MessagesReply, sep = '') =>
  (reply.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join(sep)
    .trim()

/** Why a reply can't be used — declined, empty or cut off — or null if it can. */
export function replyProblem(reply: MessagesReply, text: string): string | null {
  const why = `stop: ${reply.stop_reason ?? '?'}; blocks: ${(reply.content ?? []).map((c) => c.type).join(', ') || 'none'}`
  if (reply.stop_reason === 'refusal') return `The model declined to answer (${why})`
  if (!text) return `The model returned no text (${why})`
  if (reply.stop_reason === 'max_tokens') return `The answer was cut off at the length limit (${why})`
  return null
}
