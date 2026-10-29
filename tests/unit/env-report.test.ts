import { describe, expect, it } from 'vitest'
import { formatReport, isOk, worstStatus } from '@shared/env-report'
import type { EnvCheck, EnvReport } from '@shared/types'

const check = (id: string, status: EnvCheck['status']): EnvCheck => ({
  id,
  label: `check ${id}`,
  status,
  detail: 'detail'
})

describe('worstStatus', () => {
  it('returns pass when everything passes', () => {
    expect(worstStatus([check('a', 'pass'), check('b', 'pass')])).toBe('pass')
  })

  it('reports a warning when nothing has failed', () => {
    expect(worstStatus([check('a', 'pass'), check('b', 'warn')])).toBe('warn')
  })

  it('lets a failure outrank a warning regardless of order', () => {
    expect(worstStatus([check('a', 'fail'), check('b', 'warn')])).toBe('fail')
    expect(worstStatus([check('a', 'warn'), check('b', 'fail')])).toBe('fail')
  })

  it('treats an empty set as passing', () => {
    expect(worstStatus([])).toBe('pass')
  })
})

describe('isOk', () => {
  it('tolerates warnings but not failures', () => {
    expect(isOk([check('a', 'warn')])).toBe(true)
    expect(isOk([check('a', 'fail')])).toBe(false)
  })
})

describe('formatReport', () => {
  const report: EnvReport = {
    generatedAt: '2026-09-28T00:00:00.000Z',
    packaged: false,
    platform: 'darwin',
    arch: 'arm64',
    versions: { electron: '33.0.0' },
    checks: [check('sqlite', 'pass'), check('chromium', 'fail')],
    ok: false
  }

  it('renders every check with its status', () => {
    const text = formatReport(report)
    expect(text).toContain('darwin/arm64, dev')
    expect(text).toContain('electron: 33.0.0')
    expect(text).toContain('[PASS] check sqlite')
    expect(text).toContain('[FAIL] check chromium')
  })
})
