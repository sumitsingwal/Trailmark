import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RecordingSession } from '../../src/recorder/driver.ts'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.ts'
import type { RecordedStep } from '../../src/recorder/events.ts'

/**
 * Drives the real recorder against the local fixture site.
 *
 * Actions are performed through Playwright rather than by hand, but they reach the
 * page as genuine trusted input events, so the injected recorder sees exactly what it
 * would see during a human walkthrough.
 */

let fixture: FixtureServer

beforeAll(async () => {
  fixture = await startFixtureServer()
})

afterAll(async () => {
  await fixture.close()
})

interface Capture {
  steps: RecordedStep[]
  rejected: string[]
  session: RecordingSession
}

async function record(path: string): Promise<Capture> {
  const steps: RecordedStep[] = []
  const rejected: string[] = []
  const session = await RecordingSession.start({
    startUrl: `${fixture.url}${path}`,
    headless: true,
    onStep: (step) => steps.push(step),
    onRejected: (reason) => rejected.push(reason)
  })
  return { steps, rejected, session }
}

const typesOf = (steps: RecordedStep[]): string[] => steps.map((s) => s.type)

describe('recording a login flow', () => {
  let capture: Capture

  beforeAll(async () => {
    capture = await record('/')
    const { page } = capture.session
    await page.fill('#username', 'user1')
    await page.fill('#password', 's3cret-do-not-record')
    await page.fill('#card', '4111111111111111')
    await page.click('button[name="signin"]')
    await page.waitForURL(/dashboard/)
    await capture.session.stop()
  })

  it('opens with the initial navigation', () => {
    const first = capture.steps[0]
    expect(first?.type).toBe('navigate')
    expect(first).toMatchObject({ kind: 'initial', pageTitle: 'Fixture — Sign in' })
  })

  it('accepts every event the page sent', () => {
    expect(capture.rejected).toEqual([])
  })

  it('records one input step per field, not one per keystroke', () => {
    const inputs = capture.steps.filter((s) => s.type === 'input')
    expect(inputs).toHaveLength(3)
  })

  it('never lets a password or card number leave the page', () => {
    const serialised = JSON.stringify(capture.steps)
    expect(serialised).not.toContain('s3cret-do-not-record')
    expect(serialised).not.toContain('4111111111111111')

    const inputs = capture.steps.filter((s) => s.type === 'input')
    const password = inputs.find((s) => s.type === 'input' && s.target.id === 'password')
    const card = inputs.find((s) => s.type === 'input' && s.target.id === 'card')
    expect(password).toMatchObject({ masked: true, value: '********' })
    // Masked by its autocomplete token, not its type — the field is type="text".
    expect(card).toMatchObject({ masked: true, value: '********' })
  })

  it('redacts secrets that a GET form pushed into the next URL', () => {
    // The fixture login form submits by GET, so everything typed lands in the query
    // string. Field masking alone would not have caught this.
    const navigation = capture.steps.find((s, i) => i > 0 && s.type === 'navigate')
    expect(navigation).toBeDefined()
    const url = navigation && 'url' in navigation ? navigation.url : ''
    expect(url).toContain('dashboard.html')
    expect(url).toContain('username=user1')
    expect(url).not.toContain('s3cret-do-not-record')
    expect(url).not.toContain('4111111111111111')
  })

  it('keeps the ordinary value of a non-sensitive field', () => {
    const username = capture.steps.find((s) => s.type === 'input' && s.target.id === 'username')
    expect(username).toMatchObject({ masked: false, value: 'user1' })
    expect(username).toMatchObject({ target: { label: 'Username', labelSource: 'label' } })
  })

  it('records the submit click before the navigation it caused', () => {
    const clickIndex = capture.steps.findIndex((s) => s.type === 'click')
    const navIndex = capture.steps.findIndex((s, i) => i > 0 && s.type === 'navigate')
    expect(clickIndex).toBeGreaterThan(-1)
    expect(navIndex).toBeGreaterThan(clickIndex)

    const click = capture.steps[clickIndex]
    expect(click).toMatchObject({ target: { label: 'Sign In', role: 'button', tag: 'button' } })
    expect(capture.steps[navIndex]).toMatchObject({
      kind: 'load',
      pageTitle: 'Fixture — Dashboard'
    })
  })

  it('attaches a ranked locator to each interaction step', () => {
    // Proves the whole path: the page builds candidates, the driver ranks them, and
    // the result rides along with the step.
    const click = capture.steps.find((s) => s.type === 'click')
    expect(click?.recommended).toMatchObject({ unique: true })
    expect(click?.recommended?.expression).toBeTruthy()

    const username = capture.steps.find((s) => s.type === 'input' && s.target.id === 'username')
    expect(username?.recommended).toMatchObject({
      kind: 'id',
      expression: '#username',
      unique: true
    })
    expect(
      username && 'locators' in username ? username.locators?.candidates.length : 0
    ).toBeGreaterThan(1)
  })

  it('numbers steps contiguously from zero', () => {
    expect(capture.steps.map((s) => s.seq)).toEqual(capture.steps.map((_, i) => i))
  })
})

describe('recording form controls', () => {
  let capture: Capture

  beforeAll(async () => {
    capture = await record('/form.html')
    const { page } = capture.session
    await page.selectOption('#country', 'uk')
    await page.check('#express')
    await page.check('#pay-invoice')
    await page.click('[data-testid="add-line"]')
    await capture.session.stop()
  })

  it('captures the visible option text alongside the value', () => {
    const select = capture.steps.find((s) => s.type === 'select')
    expect(select).toMatchObject({
      value: 'uk',
      optionLabel: 'United Kingdom',
      target: { label: 'Country', role: 'combobox' }
    })
  })

  it('records a checkbox and a radio as toggles with their state', () => {
    const toggles = capture.steps.filter((s) => s.type === 'toggle')
    expect(toggles).toHaveLength(2)
    expect(toggles[0]).toMatchObject({
      checked: true,
      target: { role: 'checkbox', label: 'Express delivery' }
    })
    expect(toggles[1]).toMatchObject({ checked: true, target: { role: 'radio', label: 'Invoice' } })
  })

  it('names a text-only button by its text and keeps its test id', () => {
    const click = capture.steps.find((s) => s.type === 'click' && s.target.testId === 'add-line')
    expect(click).toMatchObject({ target: { label: 'Add line', tag: 'button' } })
  })

  it('records a ticked checkbox once, as a toggle rather than a click too', () => {
    // Clicking a checkbox fires both click and change. Recording both would put the
    // same action in the clickpath twice.
    const expressSteps = capture.steps.filter((s) => 'target' in s && s.target?.id === 'express')
    expect(expressSteps.map((s) => s.type)).toEqual(['toggle'])
    expect(capture.rejected).toEqual([])
  })

  it('still records clicks on ordinary buttons', () => {
    expect(typesOf(capture.steps)).toContain('click')
  })
})

describe('recording beyond the top document', () => {
  it('records input inside an iframe and marks its frame', async () => {
    const capture = await record('/form.html')
    const frame = capture.session.page.frameLocator('#notes')
    await frame.locator('#note').fill('ship by friday')
    await frame.locator('#save-note').click()
    await capture.session.stop()

    const input = capture.steps.find((s) => s.type === 'input' && s.target.id === 'note')
    expect(input).toMatchObject({ value: 'ship by friday', target: { label: 'Note' } })
    expect(input && 'frameUrl' in input ? input.frameUrl : undefined).toContain('/notes.html')
  })

  it('records a new tab as a popup step', async () => {
    const capture = await record('/dashboard.html')
    await capture.session.page.click('#to-form-newtab')
    await capture.session.page.waitForTimeout(500)
    await capture.session.stop()

    const popup = capture.steps.find((s) => s.type === 'popup')
    expect(popup).toBeDefined()
    expect(popup).toMatchObject({ pageTitle: 'Fixture — Order form' })
  })
})

describe('trusting nothing from the page', () => {
  it('rejects a forged event sent straight to the binding', async () => {
    const capture = await record('/')
    await capture.session.page.evaluate(() => {
      const send = (window as unknown as Record<string, unknown>)['__trailmark_send'] as (
        e: unknown
      ) => void
      send({ type: 'click', totally: 'malformed' })
    })
    await capture.session.page.waitForTimeout(200)
    await capture.session.stop()

    expect(capture.rejected.length).toBeGreaterThan(0)
    expect(capture.steps.filter((s) => s.type === 'click')).toHaveLength(0)
  })

  it('flushes a half-typed field when the recording stops', async () => {
    const capture = await record('/form.html')
    // Typed but never blurred — without the flush on stop this step would vanish.
    await capture.session.page.fill('#qty', '7')
    await capture.session.stop()

    const input = capture.steps.find((s) => s.type === 'input' && s.target.id === 'qty')
    expect(input).toMatchObject({ value: '7' })
  })
})
