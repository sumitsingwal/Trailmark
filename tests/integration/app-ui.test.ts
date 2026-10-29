import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.ts'

/**
 * Drives the built app the way a user does.
 *
 * Launched with its own --user-data-dir so it works against a throwaway library
 * rather than whatever is in the real one. Requires `npm run build` first, which is
 * deliberate: this exercises the same bundle that gets packaged, not the sources.
 */

const require = createRequire(import.meta.url)

let app: ElectronApplication
let window: Page
let userDataDir: string

beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'tcg-ui-'))
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

describe('the app window', () => {
  it('renders the library shell', async () => {
    await expect.poll(() => window.locator('.sidebar').count(), { timeout: 15_000 }).toBe(1)
    await expect.poll(() => window.locator('.topbar h1').textContent()).toBe('Trailmark')
    await expect
      .poll(() => window.locator('.placeholder h2').textContent())
      .toBe('No recording selected')
  })

  it('reports no renderer errors', async () => {
    const errors: string[] = []
    window.on('pageerror', (error) => errors.push(error.message))
    await window.waitForTimeout(300)
    expect(errors).toEqual([])
  })

  it('starts with an empty library and the root folder selected', async () => {
    await expect.poll(() => window.locator('.tree__item.is-selected').textContent()).toBe('Library')
    await expect.poll(() => window.locator('.reclist__item').count()).toBe(0)
    await expect
      .poll(() => window.locator('.empty').first().textContent())
      .toContain('Nothing here')
  })
})

describe('the help panel', () => {
  it('opens from the top bar, names the capture shortcut, and closes on Escape', async () => {
    await window.click('.topbar button[aria-label="Help"]')
    const help = window.locator('[role="dialog"][aria-label="Help"]')
    await expect.poll(() => help.count()).toBe(1)
    await expect.poll(() => help.locator('h2').textContent()).toBe('How Trailmark works')
    await expect.poll(() => help.locator('kbd').textContent()).toMatch(/^(⌘⇧|Ctrl\+Shift)\+S$/)

    await window.keyboard.press('Escape')
    await expect.poll(() => help.count()).toBe(0)
  })

  it('is also reachable from the empty detail pane', async () => {
    await window.click('.placeholder__help button')
    const help = window.locator('[role="dialog"][aria-label="Help"]')
    await expect.poll(() => help.count()).toBe(1)
    await window.click('button[aria-label="Close help"]')
    await expect.poll(() => help.count()).toBe(0)
  })
})

describe('creating a folder', () => {
  it('adds it to the tree and keeps it after a reload', async () => {
    await window.click('.sidebar__heading button[title="New folder"]')
    await window.fill('.sidebar__add input', 'Release 24.3')
    await window.press('.sidebar__add input', 'Enter')

    await expect
      .poll(() => window.locator('.tree__name').allTextContents())
      .toContain('Release 24.3')

    // Proves it reached the database rather than only React state.
    await window.reload()
    await expect
      .poll(() => window.locator('.tree__name').allTextContents(), { timeout: 15_000 })
      .toContain('Release 24.3')
  })

  it('ignores a blank name instead of creating an unnamed folder', async () => {
    const before = await window.locator('.tree__item').count()
    await window.click('.sidebar__heading button[title="New folder"]')
    await window.fill('.sidebar__add input', '   ')
    await window.press('.sidebar__add input', 'Enter')
    await window.waitForTimeout(200)
    expect(await window.locator('.tree__item').count()).toBe(before)
  })
})

describe('the new recording dialog', () => {
  it('will not start until it has a name and a URL', async () => {
    await window.click('.sidebar__heading button.primary')
    await expect.poll(() => window.locator('.modal').count()).toBe(1)

    const start = window.locator('.modal__actions button.primary')
    expect(await start.isDisabled()).toBe(true)

    await window.fill('#rec-name', 'Checkout')
    expect(await start.isDisabled()).toBe(true)

    await window.fill('#rec-url', 'app.internal/checkout')
    expect(await start.isDisabled()).toBe(false)
  })

  it('offers the folders that exist', async () => {
    const options = await window.locator('#rec-folder option').allTextContents()
    expect(options.map((o) => o.trim())).toEqual(
      expect.arrayContaining(['Library', 'Release 24.3'])
    )
  })

  it('closes on cancel without starting anything', async () => {
    await window.click('.modal__actions button:not(.primary)')
    await expect.poll(() => window.locator('.modal').count()).toBe(0)
    // No live recording banner appeared.
    expect(await window.locator('.live').count()).toBe(0)
  })
})

describe('diagnostics', () => {
  it('surfaces the environment checks from the main process', async () => {
    await window.click('.statusbar button.link')
    await expect
      .poll(() => window.locator('.diag__item').count(), { timeout: 10_000 })
      .toBeGreaterThan(0)

    const labels = await window.locator('.diag__item strong').allTextContents()
    expect(labels).toContain('Library database')
    expect(labels).toContain('Recorder browser')
  })
})

describe('recording end to end through the app', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture.close()
  })

  it('opens a recorder browser, streams steps in, and stops on command', async () => {
    await window.click('.sidebar__heading button.primary')
    await window.fill('#rec-name', 'Fixture walkthrough')
    await window.fill('#rec-url', fixture.url)
    await window.click('.modal__actions button.primary')

    // The live banner is driven by a status event pushed from the main process.
    await expect.poll(() => window.locator('.live').count(), { timeout: 60_000 }).toBe(1)

    // The initial navigation arrives as a step, through the recorder, the store,
    // an IPC event, and back into the table — the whole loop.
    await expect
      .poll(() => window.locator('table.steps tbody tr').count(), { timeout: 60_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => window.locator('.cell-edit').first().inputValue(), { timeout: 30_000 })
      .toContain('Fixture')

    await window.click('.live button.danger')
    await expect.poll(() => window.locator('.live').count(), { timeout: 60_000 }).toBe(0)

    // The finished recording is in the list with its steps counted.
    await expect
      .poll(() => window.locator('.reclist__name').allTextContents(), { timeout: 15_000 })
      .toContain('Fixture walkthrough')
    expect(await window.locator('.reclist__meta').first().textContent()).toMatch(/\d+ steps/)
  }, 120_000)
})

describe('the export controls', () => {
  it('are disabled until a recording has steps, then enabled', async () => {
    // Select the recording made by the end-to-end test above.
    await window.click('.reclist__item')
    await expect.poll(() => window.locator('.detail__head h2').count(), { timeout: 15_000 }).toBe(1)

    const excel = window.locator('.detail__actions button.primary')
    await expect.poll(() => excel.textContent()).toBe('Export Excel')
    expect(await excel.isDisabled()).toBe(false)

    // CSV sits beside it.
    const csv = window.locator('.detail__actions button', { hasText: 'CSV' })
    expect(await csv.isDisabled()).toBe(false)
  })
})

describe('choosing which fields to see', () => {
  it('shows the default clickpath columns, then reveals the locator detail on request', async () => {
    await window.click('.reclist__item')
    await expect.poll(() => window.locator('table.steps').count(), { timeout: 15_000 }).toBe(1)

    const headers = async (): Promise<string[]> =>
      (await window.locator('table.steps thead th').allTextContents()).map((h) => h.trim())

    expect(await headers()).toEqual(
      expect.arrayContaining(['Action', 'Expected result', 'Screenshot'])
    )
    expect(await headers()).not.toContain('Relative XPath')

    await window.click('.picker__button')
    await expect.poll(() => window.locator('.picker__menu').count()).toBe(1)
    await window.click('.picker__presets button:nth-child(2)')

    // The locator preset brings in exactly what the automation team reads.
    await expect
      .poll(async () => await headers(), { timeout: 10_000 })
      .toEqual(expect.arrayContaining(['Relative XPath', 'Unique?']))
  })

  it('remembers the choice across a reload', async () => {
    await window.reload()
    await expect.poll(() => window.locator('.sidebar').count(), { timeout: 15_000 }).toBe(1)
    await window.click('.reclist__item')
    await expect.poll(() => window.locator('table.steps').count(), { timeout: 15_000 }).toBe(1)

    const headers = (await window.locator('table.steps thead th').allTextContents()).map((h) =>
      h.trim()
    )
    expect(headers).toContain('Relative XPath')
  })

  it('will not let the last column be turned off', async () => {
    await window.click('.picker__button')
    await window.click('.picker__presets button:nth-child(1)')

    // Turn off everything but the first; the remaining one must stay checkable.
    for (const label of ['Expected result', 'Screenshot']) {
      await window.click(`.picker__item:has-text("${label}") input`)
    }
    const remaining = window.locator('.picker__item input:checked')
    await expect.poll(() => remaining.count()).toBe(1)
    expect(await remaining.isDisabled()).toBe(true)

    // Put it back for any later test.
    await window.click('.picker__presets button:nth-child(1)')
    await window.keyboard.press('Escape')
  })
})

describe('the recording row menu', () => {
  const openMenu = async (): Promise<void> => {
    await window.click('.reclist__row .rowmenu__button')
    await expect.poll(() => window.locator('.rowmenu').count(), { timeout: 10_000 }).toBe(1)
  }

  it('renames in place from the list, without opening the recording', async () => {
    // Deliberately no click on the row itself: the menu must work on its own.
    await openMenu()
    await window.click('.rowmenu__item:has-text("Rename")')

    await expect.poll(() => window.locator('.reclist__renaming input').count()).toBe(1)
    await window.fill('.reclist__renaming input', 'Checkout — reviewed')
    await window.press('.reclist__renaming input', 'Enter')

    await expect
      .poll(() => window.locator('.reclist__name').allTextContents(), { timeout: 10_000 })
      .toContain('Checkout — reviewed')
  })

  it('abandons a rename on Escape', async () => {
    await openMenu()
    await window.click('.rowmenu__item:has-text("Rename")')
    await window.fill('.reclist__renaming input', 'discard me')
    await window.press('.reclist__renaming input', 'Escape')

    await expect
      .poll(() => window.locator('.reclist__name').allTextContents())
      .toContain('Checkout — reviewed')
  })

  it('keeps the old name when the new one is blank', async () => {
    await openMenu()
    await window.click('.rowmenu__item:has-text("Rename")')
    await window.fill('.reclist__renaming input', '   ')
    await window.press('.reclist__renaming input', 'Enter')

    await expect
      .poll(() => window.locator('.reclist__name').allTextContents())
      .toContain('Checkout — reviewed')
  })

  it('closes on Escape without doing anything', async () => {
    await openMenu()
    await window.keyboard.press('Escape')
    await expect.poll(() => window.locator('.rowmenu').count()).toBe(0)
  })

  it('moves the recording to another folder, marking where it already is', async () => {
    await openMenu()
    await window.click('.rowmenu__item:has-text("Move to")')
    await expect.poll(() => window.locator('.rowmenu__folders').count()).toBe(1)

    // The current folder is shown as current and cannot be chosen again.
    const current = window.locator('.rowmenu__folder.is-current')
    await expect.poll(() => current.count()).toBe(1)
    expect(await current.isDisabled()).toBe(true)

    // "Release 24.3" was created by an earlier test in this file.
    await window.click('.rowmenu__folder:has-text("Release 24.3")')

    await expect
      .poll(() => window.locator('.tree__item.is-selected').textContent(), { timeout: 10_000 })
      .toContain('Release 24.3')
    await expect
      .poll(() => window.locator('.reclist__name').allTextContents())
      .toContain('Checkout — reviewed')

    // Survives a reload, so the move reached the database.
    await window.reload()
    await expect.poll(() => window.locator('.sidebar').count(), { timeout: 15_000 }).toBe(1)
    await window.click('.tree__item:has-text("Release 24.3")')
    await expect
      .poll(() => window.locator('.reclist__name').allTextContents(), { timeout: 10_000 })
      .toContain('Checkout — reviewed')
  })
})

describe('deleting a recording', () => {
  it('asks first, and cancelling changes nothing', async () => {
    const before = await window.locator('.reclist__row').count()

    await window.click('.reclist__row .rowmenu__button')
    await window.click('.rowmenu__item:has-text("Delete")')

    const dialog = window.locator('.modal__card--narrow')
    await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(1)
    // Says exactly what will be lost.
    expect(await dialog.textContent()).toMatch(/steps?/)

    await window.click('.modal__actions button:not(.danger-solid)')
    await expect.poll(() => dialog.count()).toBe(0)
    expect(await window.locator('.reclist__row').count()).toBe(before)
  })

  it('deletes once confirmed', async () => {
    const before = await window.locator('.reclist__row').count()

    await window.click('.reclist__row .rowmenu__button')
    await window.click('.rowmenu__item:has-text("Delete")')
    await window.click('.modal__actions button.danger-solid')

    await expect
      .poll(() => window.locator('.reclist__row').count(), { timeout: 10_000 })
      .toBe(before - 1)
  })
})

describe('deleting a folder', () => {
  it('asks first, and says what is nested inside', async () => {
    // Build a parent with a nested folder so the warning has something to count.
    await window.click('.sidebar__heading button[title="New folder"]')
    await window.fill('.sidebar__add input', 'Doomed parent')
    await window.press('.sidebar__add input', 'Enter')
    await expect
      .poll(() => window.locator('.tree__name').allTextContents(), { timeout: 10_000 })
      .toContain('Doomed parent')

    await window.click('.tree__item:has-text("Doomed parent")')
    await window.click('.sidebar__heading button[title="New folder"]')
    await window.fill('.sidebar__add input', 'Nested child')
    await window.press('.sidebar__add input', 'Enter')
    await expect
      .poll(() => window.locator('.tree__name').allTextContents(), { timeout: 10_000 })
      .toContain('Nested child')

    await window.hover('.tree__item:has-text("Doomed parent")')
    await window.click('.tree__item:has-text("Doomed parent") .tree__delete')

    const dialog = window.locator('.modal__card--narrow')
    await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(1)
    expect(await dialog.textContent()).toContain('nested folder')

    // Cancelling leaves both folders alone.
    await window.click('.modal__actions button:not(.danger-solid)')
    await expect.poll(() => dialog.count()).toBe(0)
    expect(await window.locator('.tree__name').allTextContents()).toContain('Doomed parent')
  })

  it('deletes the folder and its nested folders once confirmed', async () => {
    await window.hover('.tree__item:has-text("Doomed parent")')
    await window.click('.tree__item:has-text("Doomed parent") .tree__delete')
    await window.click('.modal__actions button.danger-solid')

    await expect
      .poll(() => window.locator('.tree__name').allTextContents(), { timeout: 10_000 })
      .not.toContain('Doomed parent')
    // The nested folder went too, rather than resurfacing at the top level.
    expect(await window.locator('.tree__name').allTextContents()).not.toContain('Nested child')
  })

  it('says nothing is affected for an empty folder', async () => {
    await window.click('.tree__item:has-text("Library")')
    await window.click('.sidebar__heading button[title="New folder"]')
    await window.fill('.sidebar__add input', 'Just empty')
    await window.press('.sidebar__add input', 'Enter')
    await expect
      .poll(() => window.locator('.tree__name').allTextContents(), { timeout: 10_000 })
      .toContain('Just empty')

    await window.hover('.tree__item:has-text("Just empty")')
    await window.click('.tree__item:has-text("Just empty") .tree__delete')

    const dialog = window.locator('.modal__card--narrow')
    await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(1)
    expect(await dialog.textContent()).toContain('empty')
    await window.click('.modal__actions button.danger-solid')
    await expect.poll(() => dialog.count()).toBe(0)
  })
})
