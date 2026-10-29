import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingSession } from '../../src/recorder/driver.ts'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.ts'

/**
 * Persistent profiles are what let a tester sign in to the application under test
 * once per project instead of once per walkthrough, so the thing worth testing is
 * that a session genuinely survives a browser restart.
 */

let fixture: FixtureServer
const dirs: string[] = []

beforeAll(async () => {
  fixture = await startFixtureServer()
})

afterAll(async () => {
  await fixture.close()
})

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function profileDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tcg-profile-'))
  dirs.push(dir)
  return dir
}

async function open(profile?: string): Promise<RecordingSession> {
  return RecordingSession.start({
    startUrl: fixture.url,
    headless: true,
    ...(profile ? { profileDir: profile } : {}),
    onStep: () => undefined
  })
}

describe('persistent sign-in profiles', () => {
  it('carries cookies and local storage into the next recording', async () => {
    const profile = profileDir()

    const first = await open(profile)
    await first.page.evaluate(() => {
      localStorage.setItem('tcg-session', 'signed-in-token')
      document.cookie = 'session=abc123; path=/'
    })
    await first.stop()

    // A completely new browser process, same profile directory.
    const second = await open(profile)
    const carried = await second.page.evaluate(() => ({
      storage: localStorage.getItem('tcg-session'),
      cookie: document.cookie
    }))
    await second.stop()

    expect(carried.storage).toBe('signed-in-token')
    expect(carried.cookie).toContain('session=abc123')
  })

  it('keeps separate projects separate', async () => {
    const projectA = profileDir()
    const projectB = profileDir()

    const a = await open(projectA)
    await a.page.evaluate(() => localStorage.setItem('tcg-session', 'project-a'))
    await a.stop()

    const b = await open(projectB)
    const leaked = await b.page.evaluate(() => localStorage.getItem('tcg-session'))
    await b.stop()

    expect(leaked).toBeNull()
  })

  it('starts clean when no profile is given', async () => {
    const profile = profileDir()
    const seeded = await open(profile)
    await seeded.page.evaluate(() => localStorage.setItem('tcg-session', 'should-not-leak'))
    await seeded.stop()

    const ephemeral = await open()
    const value = await ephemeral.page.evaluate(() => localStorage.getItem('tcg-session'))
    await ephemeral.stop()

    expect(value).toBeNull()
  })

  it('records normally in a persistent context, with no stray blank tab', async () => {
    const steps: string[] = []
    const session = await RecordingSession.start({
      startUrl: fixture.url,
      headless: true,
      profileDir: profileDir(),
      onStep: (step) => steps.push(step.type)
    })

    await session.page.fill('#username', 'user1')
    await session.page.click('button[name="signin"]')
    await session.page.waitForURL(/dashboard/)
    await session.stop()

    expect(steps).toEqual(['navigate', 'input', 'click', 'navigate'])
  })
})
