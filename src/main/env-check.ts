import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { EnvCheck, EnvReport } from '@shared/types'
import { isOk } from '@shared/env-report'
import { libraryPaths } from './library.ts'
import { RecordingStore } from '../storage/store.ts'
import { LATEST_VERSION } from '../storage/schema.ts'
import { locateChromium } from './chromium.ts'

/**
 * Phase 0 exists to surface packaging problems on day one rather than at ship time.
 * The three checks below are the ones that historically break only in a packaged
 * build: a native module compiled against the wrong ABI, a Playwright browser that
 * was never bundled, and an app data directory that is not writable.
 */

function checkNativeSqlite(): EnvCheck {
  const base = { id: 'sqlite', label: 'better-sqlite3 native module' }
  try {
    // Required lazily so a broken build reports here instead of crashing at boot.
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(':memory:')
    db.exec('create table probe (id integer primary key, note text)')
    db.prepare('insert into probe (note) values (?)').run('phase-0')
    const row = db.prepare('select note from probe where id = 1').get() as
      { note: string } | undefined
    db.close()
    if (row?.note !== 'phase-0') {
      return {
        ...base,
        status: 'fail',
        detail: 'Opened, but the round-trip query returned nothing.'
      }
    }
    return { ...base, status: 'pass', detail: 'Loaded and round-tripped an in-memory query.' }
  } catch (error) {
    return {
      ...base,
      status: 'fail',
      detail: `Failed to load — likely built against a different Node/Electron ABI. ${String(error)}`
    }
  }
}

function checkPlaywrightChromium(): EnvCheck {
  const base = { id: 'chromium', label: 'Recorder browser' }
  try {
    // A packaged app must use the Chromium shipped inside it; anything else means the
    // build depends on a cache the person installing it will not have.
    const located = locateChromium()
    if (located.executablePath) {
      return { ...base, status: 'pass', detail: `Bundled — ${located.executablePath}` }
    }
    if (app.isPackaged) {
      return {
        ...base,
        status: 'fail',
        detail: `No browser bundled in this build. ${located.detail} Run "npm run bundle:chromium" before packaging.`
      }
    }

    const { chromium } = require('playwright') as typeof import('playwright')
    const executable = chromium.executablePath()
    if (!executable) {
      return { ...base, status: 'fail', detail: 'Playwright reported no Chromium executable path.' }
    }
    if (!existsSync(executable)) {
      return {
        ...base,
        status: 'fail',
        detail: `Not present at ${executable}. Run "npx playwright install chromium".`
      }
    }
    return { ...base, status: 'pass', detail: executable }
  } catch (error) {
    return { ...base, status: 'fail', detail: `Could not resolve Playwright. ${String(error)}` }
  }
}

function checkUserDataWritable(): EnvCheck {
  const base = { id: 'userdata', label: 'App data directory writable' }
  try {
    // The directory recordings' screenshots actually land in, not a placeholder.
    const dir = libraryPaths().mediaDir
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-probe')
    writeFileSync(probe, 'phase-0')
    rmSync(probe)
    return { ...base, status: 'pass', detail: dir }
  } catch (error) {
    return { ...base, status: 'fail', detail: `Not writable. ${String(error)}` }
  }
}

/**
 * Opens the real library, applying migrations. Distinct from the native-module probe
 * above: that one proves the binary loads, this one proves the schema this version of
 * the app expects can actually be reached on this machine's existing data.
 */
function checkLibrary(): EnvCheck {
  const base = { id: 'library', label: 'Library database' }
  try {
    const paths = libraryPaths()
    const store = new RecordingStore({
      databasePath: paths.databasePath,
      mediaDir: paths.mediaDir
    })
    const version = store.version
    const recordings = store.listRecordings().length
    store.close()

    if (version !== LATEST_VERSION) {
      return {
        ...base,
        status: 'fail',
        detail: `Migrated to v${version}, but this build expects v${LATEST_VERSION}.`
      }
    }
    return {
      ...base,
      status: 'pass',
      detail: `Schema v${version}, ${recordings} recording${recordings === 1 ? '' : 's'} — ${paths.databasePath}`
    }
  } catch (error) {
    return { ...base, status: 'fail', detail: `Could not open the library. ${String(error)}` }
  }
}

export function buildEnvReport(): EnvReport {
  const checks = [
    checkNativeSqlite(),
    checkLibrary(),
    checkPlaywrightChromium(),
    checkUserDataWritable()
  ]
  return {
    generatedAt: new Date().toISOString(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node
    },
    checks,
    ok: isOk(checks)
  }
}
