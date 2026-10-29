import { describe, expect, it } from 'vitest'
import { isSensitiveParam, redactUrl, redactUrlParam, REDACTED } from '../../src/recorder/redact.ts'

describe('isSensitiveParam', () => {
  it('matches credential-ish names regardless of case or separator', () => {
    for (const name of [
      'password',
      'Password',
      'user_pwd',
      'api-key',
      'apiKey',
      'access_token',
      'refreshToken',
      'sessionId',
      'cardNumber',
      'cvv',
      'authorization'
    ]) {
      expect(isSensitiveParam(name), name).toBe(true)
    }
  })

  it('matches short names only when they are the whole name', () => {
    expect(isSensitiveParam('code')).toBe(true)
    expect(isSensitiveParam('state')).toBe(true)
    // Would be over-redaction: these merely contain a sensitive-looking word.
    expect(isSensitiveParam('country_code')).toBe(false)
    expect(isSensitiveParam('postcode')).toBe(false)
    expect(isSensitiveParam('estate')).toBe(false)
  })

  it('leaves ordinary parameters alone', () => {
    for (const name of ['username', 'q', 'page', 'sort', 'orderId', 'lang']) {
      expect(isSensitiveParam(name), name).toBe(false)
    }
  })
})

describe('redactUrl', () => {
  it('redacts a GET form submission without touching the rest', () => {
    const url = redactUrl(
      'http://app/dashboard?username=user1&password=hunter2&card=4111111111111111'
    )
    expect(url).toContain('username=user1')
    expect(url).not.toContain('hunter2')
    expect(url).not.toContain('4111111111111111')
    expect(url).toContain(`password=${encodeURIComponent(REDACTED)}`)
  })

  it('redacts implicit-flow tokens carried in the fragment', () => {
    const url = redactUrl('http://app/cb#access_token=abc123&token_type=bearer&expires_in=3600')
    expect(url).not.toContain('abc123')
    expect(url).toContain('expires_in=3600')
  })

  it('preserves origin, path, and ordinary query parameters', () => {
    const url = redactUrl('https://app.example.com:8443/orders/42?sort=date&page=2')
    expect(url).toBe('https://app.example.com:8443/orders/42?sort=date&page=2')
  })

  it('leaves a URL with nothing sensitive byte-identical', () => {
    const raw = 'http://127.0.0.1:5173/form.html'
    expect(redactUrl(raw)).toBe(raw)
  })

  it('returns unparseable input unchanged rather than guessing', () => {
    expect(redactUrl('not a url at all')).toBe('not a url at all')
    expect(redactUrl('')).toBe('')
  })

  it('does not treat a bare fragment as parameters', () => {
    const raw = 'http://app/docs#section-3'
    expect(redactUrl(raw)).toBe(raw)
  })
})

describe('redactUrlParam', () => {
  it('redacts only the named parameter, in the query and the fragment', () => {
    const url = redactUrlParam('http://app/r?customerRef=C-1&page=2#customerRef=C-1', 'customerRef')
    expect(url).not.toContain('C-1')
    expect(url).toContain('page=2')
    expect(url).toContain(`customerRef=${encodeURIComponent(REDACTED)}`)
  })

  it('leaves a URL without that parameter untouched', () => {
    const raw = 'http://app/r?other=1'
    expect(redactUrlParam(raw, 'customerRef')).toBe(raw)
  })
})
