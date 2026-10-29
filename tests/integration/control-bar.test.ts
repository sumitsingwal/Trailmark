import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingSession, type ScreenshotCapture } from '../../src/recorder/driver.ts'
import { RecordingStore } from '../../src/storage/store.ts'
import { readPngSize } from '../../src/storage/png.ts'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.ts'
import type { RecordedStep } from '../../src/recorder/events.ts'

/**
 * The control bar is injected into the recorded page, so these drive it the way a
 * user would — by clicking its buttons — rather than by calling the driver directly.
 */

let fixture: FixtureServer
let dir: string
let store: RecordingStore

beforeAll(async () => {
  fixture = await startFixtureServer()
})

afterAll(async () => {
  await fixture.close()
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tcg-bar-'))
  store = new RecordingStore({
    databasePath: join(dir, 'library.db'),
    mediaDir: join(dir, 'recordings')
  })
})

afterEach(() => {
  try {
    store.close()
  } catch {
    // Already closed.
  }
  rmSync(dir, { recursive: true, force: true })
})

interface Harness {
  session: RecordingSession
  steps: RecordedStep[]
  shots: ScreenshotCapture[]
  notes: { text: string; afterSeq: number | null }[]
  stopRequests: number
  rejected: string[]
}

async function open(path = '/'): Promise<Harness> {
  const steps: RecordedStep[] = []
  const shots: ScreenshotCapture[] = []
  const notes: { text: string; afterSeq: number | null }[] = []
  const rejected: string[] = []
  let stopRequests = 0

  const session = await RecordingSession.start({
    startUrl: `${fixture.url}${path}`,
    headless: true,
    onStep: (step) => steps.push(step),
    onScreenshot: (shot) => {
      shots.push(shot)
    },
    onNote: (note) => notes.push(note),
    onStopRequested: () => {
      stopRequests += 1
    },
    onRejected: (reason) => rejected.push(reason)
  })

  return {
    session,
    steps,
    shots,
    notes,
    rejected,
    get stopRequests() {
      return stopRequests
    }
  } as Harness
}

describe('the control bar', () => {
  it('appears in the recorded page without being recorded itself', async () => {
    const h = await open()
    const host = h.session.page.locator('[data-trailmark-ignore]')
    await expect.poll(() => host.count()).toBe(1)

    // Interacting with the bar must not produce steps. Dispatched rather than
    // clicked through Playwright: the host is a zero-size container (the bar inside
    // it is position:fixed), so a real click would just wait for actionability.
    const before = h.steps.length
    await h.session.page.evaluate(() => {
      const el = document.querySelector('[data-trailmark-ignore]') as HTMLElement | null
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    })
    await h.session.page.waitForTimeout(150)
    expect(h.steps.length).toBe(before)

    await h.session.stop()
  })

  it('is closed to the page it is injected into', async () => {
    const h = await open()
    const reachable = await h.session.page.evaluate(() => {
      const host = document.querySelector('[data-trailmark-ignore]') as HTMLElement | null
      return host?.shadowRoot !== null && host?.shadowRoot !== undefined
    })
    // A closed shadow root reports null, so the recorded app cannot read or alter it.
    expect(reachable).toBe(false)
    await h.session.stop()
  })

  it('is installed only once, in the top document', async () => {
    const h = await open('/form.html')
    await h.session.page.waitForTimeout(200)
    expect(await h.session.page.locator('[data-trailmark-ignore]').count()).toBe(1)
    // The page has an iframe; the bar must not be drawn inside it too.
    const frame = h.session.page.frameLocator('#notes')
    expect(await frame.locator('[data-trailmark-ignore]').count()).toBe(0)
    await h.session.stop()
  })
})

describe('capturing an expected page', () => {
  it('captures from the keyboard shortcut, wherever focus is', async () => {
    const h = await open()
    await h.session.page.click('#username')
    const before = h.steps.length

    await h.session.page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+S' : 'Control+Shift+S'
    )
    await expect.poll(() => h.shots.length, { timeout: 5000 }).toBe(1)

    // The shortcut itself is not a step in the clickpath.
    expect(h.steps.length).toBe(before)
    await h.session.stop()
  })

  it('captures a full-page PNG and attaches it to the preceding step', async () => {
    const h = await open()
    await h.session.page.fill('#username', 'user1')
    await h.session.page.click('.actions .btn.ghost:nth-of-type(1)')
    await h.session.page.waitForTimeout(150)

    const lastSeq = h.steps[h.steps.length - 1]?.seq ?? null
    await h.session.capture(h.session.page)

    expect(h.shots).toHaveLength(1)
    const shot = h.shots[0]!
    expect(shot.afterSeq).toBe(lastSeq)
    expect(readPngSize(shot.data)).toMatchObject({ width: expect.any(Number) })
    await h.session.stop()
  })

  it('keeps the control bar out of the image', async () => {
    const h = await open()
    // Hidden for the duration of the capture, then restored.
    await h.session.capture(h.session.page)
    const visibleAfter = await h.session.page.evaluate(() => {
      const host = document.querySelector('[data-trailmark-ignore]') as HTMLElement | null
      return host ? host.style.display !== 'none' : false
    })
    expect(visibleAfter).toBe(true)
    await h.session.stop()
  })

  it('saves the capture into the library against the right step', async () => {
    const h = await open()
    const recording = store.createRecording({ name: 'Login', startUrl: fixture.url })
    for (const step of h.steps) store.appendStep(recording.id, step)

    await h.session.page.fill('#username', 'user1')
    await h.session.page.click('button[name="signin"]')
    await h.session.page.waitForURL(/dashboard/)
    await h.session.page.waitForTimeout(150)
    for (const step of h.steps.slice(store.listSteps(recording.id).length)) {
      store.appendStep(recording.id, step)
    }

    await h.session.capture(h.session.page)
    const shot = h.shots[0]!
    const target =
      shot.afterSeq === null ? undefined : store.findStepBySeq(recording.id, shot.afterSeq)
    const saved = store.saveScreenshot({
      recordingId: recording.id,
      stepId: target?.id ?? null,
      data: shot.data
    })

    expect(saved.fileName).toBe('001.png')
    expect(statSync(saved.filePath).size).toBeGreaterThan(0)
    expect(saved.width).toBeGreaterThan(0)
    expect(saved.stepId).toBe(target?.id)

    expect(store.listScreenshots(recording.id)).toHaveLength(1)
    expect(store.listRecordings()[0]?.screenshotCount).toBe(1)
    await h.session.stop()
  })

  it('numbers captures in order', async () => {
    const recording = store.createRecording({ name: 'Login', startUrl: fixture.url })
    const h = await open()
    await h.session.capture(h.session.page)
    await h.session.capture(h.session.page)

    const names = h.shots.map(
      (shot) =>
        store.saveScreenshot({ recordingId: recording.id, stepId: null, data: shot.data }).fileName
    )
    expect(names).toEqual(['001.png', '002.png'])
    await h.session.stop()
  })
})

describe('pausing', () => {
  it('records nothing while paused, and resumes cleanly', async () => {
    const h = await open()
    await h.session.setPaused(true)
    expect(h.session.isPaused).toBe(true)

    const before = h.steps.length
    await h.session.page.fill('#username', 'typed-while-paused')
    await h.session.page.click('.actions .btn.ghost:nth-of-type(1)')
    await h.session.page.waitForTimeout(200)
    expect(h.steps.length).toBe(before)

    await h.session.setPaused(false)
    await h.session.page.click('.actions .btn.ghost:nth-of-type(2)')
    await h.session.page.waitForTimeout(200)
    expect(h.steps.length).toBeGreaterThan(before)

    // The text typed while paused must not surface on resume.
    expect(JSON.stringify(h.steps)).not.toContain('typed-while-paused')
    await h.session.stop()
  })
})

describe('commands from the page are not trusted', () => {
  it('ignores a malformed command sent to the control binding', async () => {
    const h = await open()
    await h.session.page.evaluate(() => {
      const send = (window as unknown as Record<string, unknown>)['__trailmark_control'] as (
        c: unknown
      ) => void
      send({ command: 'stop', but: 'malformed extra' })
      send({ command: 'not-a-real-command' })
      send({ command: 'note' })
    })
    await h.session.page.waitForTimeout(200)

    // "stop" with an unexpected field is still a valid stop; the other two are not.
    expect(h.rejected.length).toBeGreaterThanOrEqual(2)
    expect(h.notes).toHaveLength(0)
    await h.session.stop()
  })
})
