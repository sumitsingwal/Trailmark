/**
 * URL redaction.
 *
 * Masking form fields is not sufficient on its own. A GET form puts everything the
 * user typed straight into the next URL, and OAuth-style flows carry tokens in the
 * query string or fragment. Those URLs are then recorded as navigation steps and end
 * up in an exported clickpath that gets mailed around, so they are redacted before a
 * step is ever emitted.
 *
 * Detection is by parameter name. A value cannot be judged sensitive on its own, and
 * the plaintext the user typed never reaches this side of the boundary to compare
 * against, so name matching is what is available. It errs toward redacting.
 */

export const REDACTED = '********'

/** Parameter names that are sensitive in full, where a substring match would over-match. */
const EXACT_NAMES = new Set([
  'code',
  'key',
  'sig',
  'signature',
  'state',
  'token',
  'jwt',
  'assertion'
])

const SUBSTRING =
  /pass|pwd|secret|credential|cvv|cvc|ssn|otp|card|auth|session|bearer|api[-_]?key|access[-_]?token|id[-_]?token|refresh/i

export function isSensitiveParam(name: string): boolean {
  const lower = name.toLowerCase()
  return EXACT_NAMES.has(lower) || SUBSTRING.test(lower)
}

function redactParams(
  search: string,
  sensitive: (name: string) => boolean
): { value: string; changed: boolean } {
  const params = new URLSearchParams(search)
  let changed = false
  for (const name of [...params.keys()]) {
    if (!sensitive(name)) continue
    params.set(name, REDACTED)
    changed = true
  }
  return { value: params.toString(), changed }
}

/**
 * Returns the URL with sensitive query and fragment parameters replaced. Anything
 * that does not parse as a URL is returned untouched — a malformed string is not
 * worth guessing at, and it cannot be a navigation target either.
 */
export function redactUrl(raw: string): string {
  return redactUrlWith(raw, isSensitiveParam)
}

/**
 * Redacts one named parameter, for a field the reviewer marked sensitive after the
 * fact. Its name matched none of the rules, so a GET form that submitted it left the
 * value sitting in the next URL.
 */
export function redactUrlParam(raw: string, name: string): string {
  return redactUrlWith(raw, (candidate) => candidate === name)
}

function redactUrlWith(raw: string, sensitive: (name: string) => boolean): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }

  if (url.search) {
    const { value, changed } = redactParams(url.search, sensitive)
    if (changed) url.search = value ? `?${value}` : ''
  }

  // Implicit-flow tokens arrive in the fragment: #access_token=…&token_type=…
  if (url.hash.includes('=')) {
    const { value, changed } = redactParams(url.hash.replace(/^#/, ''), sensitive)
    if (changed) url.hash = value ? `#${value}` : ''
  }

  return url.toString()
}
