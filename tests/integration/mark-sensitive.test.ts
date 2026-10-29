import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { RecordingStore } from '../../src/storage/store.ts'
import type { RecordedStep } from '../../src/recorder/events.ts'

/**
 * Marking a missed value sensitive, through the built app.
 *
 * The library is seeded directly rather than recorded, so the test does not depend on
 * typing into a recorder browser — the recorder side is covered elsewhere.
 */

const require = createRequire(import.meta.url)
const SECRET = 'CUST-998877'

let app: ElectronApplication
let window: Page
let userDataDir: string

beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'tcg-mask-'))
  const store = new RecordingStore({
    databasePath: join(userDataDir, 'library.db'),
    mediaDir: join(userDataDir, 'recordings')
  })
  const recording = store.createRecording({ name: 'Customer lookup', startUrl: 'http://app' })
  store.appendStep(recording.id, {
    seq: 0,
    at: 100,
    type: 'input',
    url: 'http://app/search',
    pageTitle: 'Search',
    target: {
      tag: 'input',
      type: 'text',
      name: 'customerRef',
      label: 'Customer',
      labelSource: 'label'
    },
    value: SECRET,
    masked: false
  } as RecordedStep)
  store.finishRecording(recording.id)
  store.close()

  app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userDataDir}`],
    executablePath: require('electron') as string
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
}, 60_000)

afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('marking a value sensitive', () => {
  const lock = (): ReturnType<Page['locator']> =>
    window.locator('button[title="Mark this value as sensitive"]')

  it('asks first, and cancelling leaves the value', async () => {
    await window.click('.reclist__item:has-text("Customer lookup")')
    await expect.poll(() => lock().count(), { timeout: 15_000 }).toBe(1)

    await lock().click()
    const dialog = window.locator('[role="dialog"][aria-label="Mark this value as sensitive?"]')
    await expect.poll(() => dialog.textContent()).toContain('cannot be undone')
    await dialog.locator('button:has-text("Cancel")').click()

    await expect.poll(() => dialog.count()).toBe(0)
    expect(await window.locator('.cell-edit').first().inputValue()).toContain(SECRET)
  })

  it('replaces the value once confirmed, on screen and on disk', async () => {
    await lock().click()
    await window.click('button:has-text("Mark sensitive")')

    await expect.poll(() => lock().count()).toBe(0)
    await expect.poll(() => window.locator('table.steps tr.is-masked').count()).toBe(1)
    expect(await window.locator('.cell-edit').first().inputValue()).toBe(
      'Enter "********" in Customer'
    )

    const bytes = readFileSync(join(userDataDir, 'library.db')).toString('binary')
    expect(bytes).not.toContain(SECRET)
  })
})
