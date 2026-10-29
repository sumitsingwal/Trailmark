/** Types shared across the main, preload, and renderer processes. */

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface EnvCheck {
  /** Stable machine-readable key. */
  id: string
  label: string
  status: CheckStatus
  /** Human-readable result, shown verbatim in the UI. */
  detail: string
}

export interface EnvReport {
  generatedAt: string
  /** true when running from a packaged .app/.exe rather than `electron-vite dev`. */
  packaged: boolean
  platform: string
  arch: string
  versions: Record<string, string>
  checks: EnvCheck[]
  /** false if any check failed. */
  ok: boolean
}

export const IPC = {
  envReport: 'env:report'
} as const
