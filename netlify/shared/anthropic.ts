/**
 * Calling the Claude Messages API from a function.
 *
 * One place for the endpoint, the API version and the key, so the twenty-odd
 * callers stop carrying their own copy. The request body is the caller's: the
 * named fields below are the common ones, and anything else (tool_choice,
 * output_config, a conditional max_tokens) passes through untouched. It
 * returns the raw Response, so each caller keeps its own handling of a non-OK
 * status, a timeout and the reply (see anthropic-reply.ts for reading one).
 *
 * The key is read when the call is made, not when the module loads: it may
 * only arrive with hydrateSecrets() (Farm setup), after import.
 */
export { advisorModel, alwaysThinks } from './anthropic-reply.ts'

export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'

// The models the functions name today. ANTHROPIC_MODEL / ANTHROPIC_FAST_MODEL /
// ANTHROPIC_ADVISOR_MODEL still override them where a caller reads those.
/** The default for most calls (advice, extraction, web-search pulls). */
export const SONNET_5 = 'claude-sonnet-5'
/** Label reading: the chemical-label jobs. */
export const SONNET_5_5 = 'claude-sonnet-5-5'
/** Cheap, fast reads of bills and invoices. */
export const HAIKU_4_5 = 'claude-haiku-4-5-20251001'
/** The advisor model's default (advisorModel()). */
export const OPUS_5_5 = 'claude-opus-5-5'

export type ClaudeRequest = {
  model: string
  messages: unknown[]
  system?: unknown
  /** Sent as max_tokens. A caller may instead put max_tokens in the body itself. */
  maxTokens?: number
  tools?: unknown[]
  thinking?: unknown
  /** Any other Messages API field, passed through as written. */
  [field: string]: unknown
}

export type ClaudeCallOptions = {
  /** Defaults to ANTHROPIC_API_KEY, read at call time. */
  apiKey?: string
  signal?: AbortSignal
  /** An anthropic-beta header value, for a call that needs one. */
  beta?: string
}

/** POST a Messages API request; the Response is returned as fetch gave it. */
export function callClaude(req: ClaudeRequest, opts: ClaudeCallOptions = {}): Promise<Response> {
  const { maxTokens, ...body } = req
  const headers: Record<string, string> = {
    'x-api-key': opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  }
  if (opts.beta) headers['anthropic-beta'] = opts.beta
  return fetch(MESSAGES_URL, {
    method: 'POST',
    headers,
    ...(opts.signal ? { signal: opts.signal } : {}),
    body: JSON.stringify(maxTokens == null ? body : { ...body, max_tokens: maxTokens }),
  })
}
