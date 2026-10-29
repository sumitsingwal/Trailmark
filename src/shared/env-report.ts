import type { CheckStatus, EnvCheck, EnvReport } from './types'

/**
 * Pure helpers over a set of checks. Kept free of Electron and Node APIs so the
 * reporting rules can be unit-tested without booting the app.
 */

export function worstStatus(checks: readonly EnvCheck[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'pass'
}

export function isOk(checks: readonly EnvCheck[]): boolean {
  return !checks.some((c) => c.status === 'fail')
}

export function formatReport(report: EnvReport): string {
  const lines = [
    `Trailmark environment (${report.platform}/${report.arch}, ${
      report.packaged ? 'packaged' : 'dev'
    })`,
    ...Object.entries(report.versions).map(([k, v]) => `  ${k}: ${v}`),
    '',
    ...report.checks.map((c) => `  [${c.status.toUpperCase()}] ${c.label} — ${c.detail}`)
  ]
  return lines.join('\n')
}
