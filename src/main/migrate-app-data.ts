import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * Moves the app data directory left behind by an earlier product name.
 *
 * `app.setName()` decides where `app.getPath('userData')` points, so renaming the
 * application also renames its data directory — and every recording, screenshot, and
 * saved sign-in would appear to have vanished. This carries them across once.
 *
 * Deliberately conservative: an entry already present at the destination is never
 * overwritten, so running this against a library that has already been used cannot
 * destroy anything.
 */

/** The names this app has shipped under, oldest first. */
export const LEGACY_APP_NAMES = ['Test-Case-Generator'] as const

/**
 * Only this application's own data is carried across.
 *
 * The directory also holds Chromium and Electron caches, which are disposable and
 * rebuilt on demand — moving them would carry stale state under a new name for no
 * benefit.
 */
export const MIGRATED_ENTRIES = [
  'library.db',
  'library.db-wal',
  'library.db-shm',
  'recordings',
  'profiles'
] as const

export interface MigrationResult {
  moved: string[]
  from?: string
  to?: string
  /** Set when something was found but could not be moved. */
  problem?: string
}

/**
 * Moves the contents of `from` into `to`, skipping anything that already exists there.
 * Exported separately from the Electron wiring so it can be tested with plain paths.
 */
export function migrateAppData(from: string, to: string): MigrationResult {
  if (!existsSync(from) || from === to) return { moved: [] }

  try {
    mkdirSync(to, { recursive: true })

    const present = new Set(readdirSync(from))
    const moved: string[] = []
    for (const entry of MIGRATED_ENTRIES) {
      if (!present.has(entry)) continue
      const target = join(to, entry)
      // Never clobber data that already exists under the new name.
      if (existsSync(target)) continue
      renameSync(join(from, entry), target)
      moved.push(entry)
    }

    // The old directory is only removed if nothing at all is left in it; caches and
    // anything unrecognised stay put rather than being deleted on the user's behalf.
    if (readdirSync(from).length === 0) {
      try {
        rmdirSync(from)
      } catch {
        // An empty directory that will not delete is harmless.
      }
    }

    return moved.length > 0 ? { moved, from, to } : { moved: [] }
  } catch (error) {
    return { moved: [], from, to, problem: String(error) }
  }
}

/** Runs the migration for every previous product name. Call before opening the library. */
export function migrateLegacyAppData(): MigrationResult[] {
  const current = app.getPath('userData')
  const parent = dirname(current)
  return LEGACY_APP_NAMES.map((name) => migrateAppData(join(parent, name), current)).filter(
    (result) => result.moved.length > 0 || result.problem
  )
}
