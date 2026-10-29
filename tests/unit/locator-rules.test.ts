import { describe, expect, it } from 'vitest'
import {
  chooseRecommended,
  isGeneratedToken,
  LOCATOR_PRIORITY,
  summariseLocators,
  unstableClasses
} from '../../src/recorder/locator-rules.ts'
import type { LocatorCandidate } from '../../src/recorder/events.ts'

const c = (
  kind: LocatorCandidate['kind'],
  matches: number,
  expression = `expr-${kind}`
): LocatorCandidate => ({
  kind,
  expression,
  matches
})

describe('isGeneratedToken', () => {
  it('recognises framework-generated classes', () => {
    for (const token of [
      'css-1q2w3e',
      'sc-bdVaJa',
      'Button_root__2Ab3x',
      'header-a1b2c3d4',
      'jss123456',
      'emotion-9xk2m1'
    ]) {
      expect(isGeneratedToken(token), token).toBe(true)
    }
  })

  it('leaves hand-written classes alone', () => {
    for (const token of [
      'btn',
      'btn-primary',
      'form-control',
      'ghost',
      'line',
      'remove',
      'col-md-6',
      'is-active',
      'nav__item'
    ]) {
      expect(isGeneratedToken(token), token).toBe(false)
    }
  })

  it('treats an empty token as stable rather than throwing', () => {
    expect(isGeneratedToken('')).toBe(false)
  })
})

describe('unstableClasses', () => {
  it('returns only the generated ones', () => {
    expect(unstableClasses(['btn', 'css-1q2w3e', 'primary', 'Button_root__2Ab3x'])).toEqual([
      'css-1q2w3e',
      'Button_root__2Ab3x'
    ])
  })
})

describe('chooseRecommended', () => {
  it('follows the priority order when everything is unique', () => {
    const chosen = chooseRecommended([c('css', 1), c('xpath', 1), c('id', 1), c('testid', 1)])
    expect(chosen?.kind).toBe('testid')
    expect(chosen?.unique).toBe(true)
  })

  it('prefers a unique lower-priority locator over an ambiguous higher-priority one', () => {
    // A test id matching three elements is not a locator, whatever its pedigree.
    const chosen = chooseRecommended([c('testid', 3), c('xpath', 1)])
    expect(chosen?.kind).toBe('xpath')
    expect(chosen?.unique).toBe(true)
  })

  it('says so plainly when nothing is unique', () => {
    const chosen = chooseRecommended([c('testid', 4), c('css', 2)])
    expect(chosen?.unique).toBe(false)
    expect(chosen?.matches).toBe(2)
    expect(chosen?.reason).toContain('matches 2 elements')
  })

  it('never recommends a CSS selector built from a generated class', () => {
    const chosen = chooseRecommended(
      [c('css', 1, 'button.css-1q2w3e'), c('xpath', 1, "//button[normalize-space()='Apply']")],
      ['css-1q2w3e']
    )
    expect(chosen?.kind).toBe('xpath')
  })

  it('still returns something when every candidate uses a generated class', () => {
    const chosen = chooseRecommended([c('css', 1, 'div.css-1q2w3e')], ['css-1q2w3e'])
    expect(chosen).toBeDefined()
    expect(chosen?.kind).toBe('css')
  })

  it('carries the Playwright form through when one exists', () => {
    const chosen = chooseRecommended([
      {
        kind: 'testid',
        expression: '[data-testid="add"]',
        playwright: 'getByTestId("add")',
        matches: 1
      }
    ])
    expect(chosen?.playwright).toBe('getByTestId("add")')
  })

  it('returns nothing when there are no candidates', () => {
    expect(chooseRecommended([])).toBeUndefined()
  })

  it('breaks ties within a kind by fewest matches', () => {
    const chosen = chooseRecommended([c('css', 5, 'a'), c('css', 2, 'b')])
    expect(chosen?.expression).toBe('b')
  })
})

describe('LOCATOR_PRIORITY', () => {
  it('ranks durable identifiers above structural ones', () => {
    const rank = (k: string): number => LOCATOR_PRIORITY.indexOf(k as never)
    expect(rank('testid')).toBeLessThan(rank('id'))
    expect(rank('id')).toBeLessThan(rank('role'))
    expect(rank('role')).toBeLessThan(rank('xpath'))
    expect(rank('xpath')).toBeLessThan(rank('css'))
  })
})

describe('summariseLocators', () => {
  it('reports the recommendation and the unstable classes together', () => {
    const summary = summariseLocators({
      candidates: [c('id', 1, '#apply')],
      inShadowDom: false,
      classes: ['btn', 'sc-bdVaJa']
    })
    expect(summary.recommended?.expression).toBe('#apply')
    expect(summary.unstable).toEqual(['sc-bdVaJa'])
  })

  it('omits the recommendation when the page found no candidates', () => {
    const summary = summariseLocators({ candidates: [], inShadowDom: true, classes: [] })
    expect(summary.recommended).toBeUndefined()
    expect(summary.unstable).toEqual([])
  })
})
