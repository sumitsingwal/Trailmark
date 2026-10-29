import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STEP_COLUMNS,
  LOCATOR_PRESET,
  normaliseColumns,
  STEP_COLUMNS,
  toggleColumn,
  type StepColumnKey
} from '../../src/shared/step-columns.ts'

describe('column definitions', () => {
  it('has a unique key and a label for every column', () => {
    const keys = STEP_COLUMNS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(STEP_COLUMNS.every((c) => c.label.length > 0)).toBe(true)
  })

  it('offers both presets from the defined columns only', () => {
    const keys = new Set<string>(STEP_COLUMNS.map((c) => c.key))
    for (const key of [...DEFAULT_STEP_COLUMNS, ...LOCATOR_PRESET]) {
      expect(keys.has(key), key).toBe(true)
    }
  })
})

describe('normaliseColumns', () => {
  it('restores the defined order regardless of how they were chosen', () => {
    expect(normaliseColumns(['xpath', 'action', 'expected'])).toEqual([
      'action',
      'expected',
      'xpath'
    ])
  })

  it('drops keys that no longer exist, so a stale saved choice still works', () => {
    expect(normaliseColumns(['action', 'a-column-we-removed'])).toEqual(['action'])
  })

  it('cleans up a saved choice that names columns retired on 2026-10-21', () => {
    expect(normaliseColumns(['action', 'recommended', 'css', 'xpath'])).toEqual(['action', 'xpath'])
    expect(normaliseColumns(['element', 'playwright'])).toEqual([...DEFAULT_STEP_COLUMNS])
  })

  it('falls back to the defaults rather than showing an empty table', () => {
    expect(normaliseColumns([])).toEqual([...DEFAULT_STEP_COLUMNS])
    expect(normaliseColumns(['nothing', 'valid'])).toEqual([...DEFAULT_STEP_COLUMNS])
  })

  it('removes duplicates', () => {
    expect(normaliseColumns(['action', 'action'])).toEqual(['action'])
  })
})

describe('toggleColumn', () => {
  it('adds a column in its defined position, not at the end', () => {
    expect(toggleColumn(['action', 'xpath'], 'expected')).toEqual(['action', 'expected', 'xpath'])
  })

  it('removes a column that is on', () => {
    expect(toggleColumn(['action', 'expected'], 'expected')).toEqual(['action'])
  })

  it('refuses to turn off the last column', () => {
    // An empty table would read as a recording that had lost its steps.
    expect(toggleColumn(['action'], 'action')).toEqual(['action'])
  })

  it('leaves the input untouched', () => {
    const current: StepColumnKey[] = ['action']
    toggleColumn(current, 'xpath')
    expect(current).toEqual(['action'])
  })
})
