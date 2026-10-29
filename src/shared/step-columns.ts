/**
 * Which fields the step table can show, and which it shows by default.
 *
 * A recording carries far more than fits comfortably on screen — the business
 * description, the page context, and a whole locator block. Rather than pick one
 * compromise, the reviewer chooses, and the choice is remembered.
 *
 * Pure and free of React so the defaults, the toggling rules, and the "at least one
 * column must remain" guard can be tested directly.
 */

export type StepColumnKey =
  'action' | 'expected' | 'page' | 'url' | 'input' | 'notes' | 'xpath' | 'unique' | 'screenshot'

export interface StepColumn {
  key: StepColumnKey
  label: string
  group: 'Business' | 'Locator'
  /** Rough share of the table width; used to keep proportions sane. */
  width: string
  /** Tooltip on the header, for columns whose meaning is not obvious from the name. */
  hint?: string
}

export const STEP_COLUMNS: readonly StepColumn[] = [
  { key: 'action', label: 'Action', group: 'Business', width: '22%' },
  { key: 'expected', label: 'Expected result', group: 'Business', width: '18%' },
  { key: 'page', label: 'Page', group: 'Business', width: '10%' },
  { key: 'url', label: 'URL', group: 'Business', width: '16%' },
  { key: 'input', label: 'Input value', group: 'Business', width: '9%' },
  { key: 'notes', label: 'Notes', group: 'Business', width: '10%' },
  { key: 'screenshot', label: 'Screenshot', group: 'Business', width: '86px' },

  {
    key: 'xpath',
    label: 'Relative XPath',
    group: 'Locator',
    width: '30%',
    hint: 'A selector the automation team can use to find this element'
  },
  {
    key: 'unique',
    label: 'Unique?',
    group: 'Locator',
    width: '9%',
    hint: 'Whether the XPath matched exactly one element when the step was recorded. "No" means it needs checking before use in a script'
  }
]

/** What a reviewer sees before choosing: the clickpath itself. */
export const DEFAULT_STEP_COLUMNS: readonly StepColumnKey[] = ['action', 'expected', 'screenshot']

/**
 * What the automation team wants when checking selectors. Columns retired on
 * 2026-10-21 are listed under "Removed functionality" in CLAUDE.md; a saved choice
 * that still names one is cleaned up by normaliseColumns.
 */
export const LOCATOR_PRESET: readonly StepColumnKey[] = ['action', 'xpath', 'unique']

const VALID = new Set<string>(STEP_COLUMNS.map((column) => column.key))

/** Drops unknown keys and restores order, so a stale saved choice still works. */
export function normaliseColumns(keys: readonly string[]): StepColumnKey[] {
  const wanted = new Set(keys.filter((key) => VALID.has(key)))
  const ordered = STEP_COLUMNS.filter((column) => wanted.has(column.key)).map((c) => c.key)
  return ordered.length > 0 ? ordered : [...DEFAULT_STEP_COLUMNS]
}

/**
 * Turns a column on or off. Turning off the last one is ignored: an empty table
 * would look like the recording had lost its steps.
 */
export function toggleColumn(
  current: readonly StepColumnKey[],
  key: StepColumnKey
): StepColumnKey[] {
  const has = current.includes(key)
  if (has && current.length === 1) return [...current]
  const next = has ? current.filter((k) => k !== key) : [...current, key]
  return normaliseColumns(next)
}
