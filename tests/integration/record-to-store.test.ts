import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingSession } from '../../src/recorder/driver.ts'
import { RecordingStore } from '../../src/storage/store.ts'
import { STORED_MASK } from '../../src/storage/sanitise.ts'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.ts'

/**
 * The whole pipeline: a real browser walkthrough, through the recorder and the
 * ranking rules, into the library on disk. The individual layers are covered
 * elsewhere; this is here to catch the seams between them.
 */

let fixture: FixtureServer
let dir: string
let store: RecordingStore
let violations: string[][]

beforeAll(async () => {
  fixture = await startFixtureServer()
})

afterAll(async () => {
  await fixture.close()
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tcg-e2e-'))
  violations = []
  store = new RecordingStore({
    databasePath: join(dir, 'library.db'),
    mediaDir: join(dir, 'recordings'),
    onViolation: (_id, found) => violations.push(found)
  })
})

afterEach(() => {
  try {
    store.close()
  } catch {
    // Already closed by a test that needed to inspect the file.
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('recording straight into the library', () => {
  it('persists a whole walkthrough as ordered, described steps', async () => {
    const folder = store.createFolder('Release 24.3')
    const recording = store.createRecording({
      name: 'Checkout login',
      startUrl: fixture.url,
      folderId: folder.id
    })

    const session = await RecordingSession.start({
      startUrl: fixture.url,
      headless: true,
      // Steps are written as they arrive, exactly as they will be during a live
      // walkthrough — not buffered and saved at the end.
      onStep: (step) => store.appendStep(recording.id, step)
    })

    const { page } = session
    await page.fill('#username', 'user1')
    await page.fill('#password', 'hunter2-secret')
    await page.click('button[name="signin"]')
    await page.waitForURL(/dashboard/)
    await session.stop()
    store.finishRecording(recording.id)

    const steps = store.listSteps(recording.id)
    expect(steps.length).toBeGreaterThanOrEqual(5)
    expect(steps.map((s) => s.position)).toEqual(steps.map((_, i) => i))

    expect(steps[0]?.action).toBe('Open Fixture — Sign in')
    expect(steps.map((s) => s.action)).toContain('Click "Sign In"')
    expect(steps.map((s) => s.action)).toContain('Enter "user1" in Username')

    const signIn = steps.find((s) => s.action === 'Click "Sign In"')
    expect(signIn?.recommendedExpression).toBeTruthy()
    expect(signIn?.recommendedUnique).toBe(true)

    const summary = store.listRecordings(folder.id)[0]
    expect(summary).toMatchObject({ name: 'Checkout login', status: 'completed' })
    expect(summary?.stepCount).toBe(steps.length)
  })

  it('writes no credential to the library file, from any path', async () => {
    const recording = store.createRecording({ name: 'Login', startUrl: fixture.url })
    const session = await RecordingSession.start({
      startUrl: fixture.url,
      headless: true,
      onStep: (step) => store.appendStep(recording.id, step)
    })

    const { page } = session
    await page.fill('#username', 'user1')
    await page.fill('#password', 'hunter2-secret')
    await page.fill('#card', '4111111111111111')
    await page.click('button[name="signin"]')
    await page.waitForURL(/dashboard/)
    await session.stop()

    const password = store
      .listSteps(recording.id)
      .find((s) => s.type === 'input' && s.elementLabel === 'Password')
    expect(password?.inputValue).toBe(STORED_MASK)
    expect(password?.masked).toBe(true)

    // Checkpoint WAL into the main file, then read the raw bytes.
    store.close()
    const bytes = readFileSync(join(dir, 'library.db')).toString('binary')
    expect(bytes).not.toContain('hunter2-secret')
    expect(bytes).not.toContain('4111111111111111')

    // Nothing needed scrubbing at the storage boundary: the earlier layers held.
    expect(violations).toEqual([])
  })
})
