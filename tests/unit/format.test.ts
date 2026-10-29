import { describe, expect, it } from 'vitest'
import { describeStep, elementName, formatStepLine } from '../../src/recorder/format.ts'
import type { ElementInfo } from '../../src/recorder/events.ts'

const el = (over: Partial<ElementInfo> = {}): ElementInfo => ({
  tag: 'input',
  label: 'Username',
  labelSource: 'label',
  ...over
})

const base = { at: 1200, url: 'http://x/login', pageTitle: 'Sign in', seq: 3 }

describe('elementName', () => {
  it('prefers the human label', () => {
    expect(elementName(el({ label: 'Username', name: 'u', id: 'i' }))).toBe('Username')
  })

  it('falls back through testId, name, id, then tag', () => {
    expect(elementName(el({ label: '', testId: 'submit-btn', name: 'n', id: 'i' }))).toBe(
      'submit-btn'
    )
    expect(elementName(el({ label: '', name: 'signin', id: 'i' }))).toBe('signin')
    expect(elementName(el({ label: '', id: 'signin-btn' }))).toBe('signin-btn')
    expect(elementName(el({ label: '', tag: 'div' }))).toBe('div')
  })
})

describe('describeStep', () => {
  it('distinguishes the opening navigation from later ones', () => {
    expect(
      describeStep({
        at: 0,
        seq: 0,
        type: 'navigate',
        url: 'http://x/',
        pageTitle: 'Sign in',
        kind: 'initial'
      })
    ).toBe('Open Sign in')
    expect(
      describeStep({
        at: 900,
        seq: 1,
        type: 'navigate',
        url: 'http://x/d',
        pageTitle: 'Dashboard',
        kind: 'load'
      })
    ).toBe('Navigate to Dashboard')
  })

  it('falls back to the URL when a page has no title', () => {
    expect(
      describeStep({
        at: 0,
        seq: 0,
        type: 'navigate',
        url: 'http://x/',
        pageTitle: '',
        kind: 'initial'
      })
    ).toBe('Open http://x/')
  })

  it('names the value typed, but never a masked one', () => {
    const typed = describeStep({
      ...base,
      type: 'input',
      target: el({ label: 'Username' }),
      value: 'user1',
      masked: false
    })
    expect(typed).toBe('Enter "user1" in Username')

    const secret = describeStep({
      ...base,
      type: 'input',
      target: el({ label: 'Password' }),
      value: '********',
      masked: true
    })
    expect(secret).toBe('Enter password in Password')
    expect(secret).not.toContain('*')
  })

  it('strips trailing punctuation captured with a label', () => {
    expect(
      describeStep({
        ...base,
        type: 'input',
        target: el({ label: 'Quantity: ' }),
        value: '2',
        masked: false
      })
    ).toBe('Enter "2" in Quantity')
  })

  it('separates links from buttons', () => {
    expect(
      describeStep({
        ...base,
        type: 'click',
        target: el({ tag: 'a', role: 'link', label: 'Open order form' }),
        modifiers: []
      })
    ).toBe('Click link "Open order form"')
    expect(
      describeStep({
        ...base,
        type: 'click',
        target: el({ tag: 'button', role: 'button', label: 'Sign In' }),
        modifiers: []
      })
    ).toBe('Click "Sign In"')
  })

  it('uses the option text for a select, not its value', () => {
    expect(
      describeStep({
        ...base,
        type: 'select',
        target: el({ tag: 'select', label: 'Country' }),
        value: 'uk',
        optionLabel: 'United Kingdom'
      })
    ).toBe('Select "United Kingdom" in Country')
  })

  it('reads a toggle by its resulting state, and a radio as a choice', () => {
    const target = el({ type: 'checkbox', role: 'checkbox', label: 'Express delivery' })
    expect(describeStep({ ...base, type: 'toggle', target, checked: true })).toBe(
      'Tick "Express delivery"'
    )
    expect(describeStep({ ...base, type: 'toggle', target, checked: false })).toBe(
      'Untick "Express delivery"'
    )
    expect(
      describeStep({
        ...base,
        type: 'toggle',
        target: el({ type: 'radio', role: 'radio', label: 'Card' }),
        checked: true
      })
    ).toBe('Choose "Card"')
  })

  it('describes keys and popups', () => {
    expect(describeStep({ ...base, type: 'key', key: 'Enter' })).toBe('Press Enter')
    expect(
      describeStep({ at: 10, seq: 2, type: 'popup', url: 'http://x/f', pageTitle: 'Order form' })
    ).toBe('New tab opens: Order form')
  })
})

describe('formatStepLine', () => {
  it('numbers steps from 1 and shows elapsed seconds', () => {
    const line = formatStepLine({ ...base, type: 'key', key: 'Enter' })
    expect(line).toContain('  4')
    expect(line).toContain('1.2s')
    expect(line).toContain('Press Enter')
  })
})
