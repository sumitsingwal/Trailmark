import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateAppData } from '../../src/main/migrate-app-data.ts'

/**
 * The app data directory is named after the product, so renaming the app moves it.
 * These cover the cases where getting it wrong would lose someone's recordings.
 */

let base: string
let oldDir: string
let newDir: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'trailmark-migrate-'))
  oldDir = join(base, 'Test-Case-Generator')
  newDir = join(base, 'Trailmark')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function seedOldLibrary(): void {
  mkdirSync(join(oldDir, 'recordings', 'abc', 'shots'), { recursive: true })
  mkdirSync(join(oldDir, 'profiles', 'folder-1'), { recursive: true })
  writeFileSync(join(oldDir, 'library.db'), 'pretend-database')
  writeFileSync(join(oldDir, 'recordings', 'abc', 'shots', '001.png'), 'pretend-image')
}

describe('migrateAppData', () => {
  it('moves the library, screenshots, and profiles across', () => {
    seedOldLibrary()

    const result = migrateAppData(oldDir, newDir)

    expect(result.moved.sort()).toEqual(['library.db', 'profiles', 'recordings'])
    expect(readFileSync(join(newDir, 'library.db'), 'utf8')).toBe('pretend-database')
    expect(existsSync(join(newDir, 'recordings', 'abc', 'shots', '001.png'))).toBe(true)
    expect(existsSync(join(newDir, 'profiles', 'folder-1'))).toBe(true)
  })

  it('removes the old directory once it is empty', () => {
    seedOldLibrary()
    migrateAppData(oldDir, newDir)
    expect(existsSync(oldDir)).toBe(false)
  })

  it('does nothing when there is no old directory', () => {
    const result = migrateAppData(oldDir, newDir)
    expect(result.moved).toEqual([])
    expect(existsSync(newDir)).toBe(false)
  })

  it('never overwrites data that already exists under the new name', () => {
    seedOldLibrary()
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(newDir, 'library.db'), 'the-library-in-use')

    const result = migrateAppData(oldDir, newDir)

    // The in-use library is untouched, and the old one is left behind rather than lost.
    expect(readFileSync(join(newDir, 'library.db'), 'utf8')).toBe('the-library-in-use')
    expect(result.moved).not.toContain('library.db')
    expect(existsSync(join(oldDir, 'library.db'))).toBe(true)
  })

  it('still moves the entries that do not collide', () => {
    seedOldLibrary()
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(newDir, 'library.db'), 'the-library-in-use')

    const result = migrateAppData(oldDir, newDir)

    expect(result.moved.sort()).toEqual(['profiles', 'recordings'])
    expect(existsSync(join(newDir, 'recordings', 'abc', 'shots', '001.png'))).toBe(true)
  })

  it('is safe to run twice', () => {
    seedOldLibrary()
    migrateAppData(oldDir, newDir)
    const again = migrateAppData(oldDir, newDir)

    expect(again.moved).toEqual([])
    expect(readFileSync(join(newDir, 'library.db'), 'utf8')).toBe('pretend-database')
  })

  it('does nothing when the two paths are the same', () => {
    seedOldLibrary()
    const result = migrateAppData(oldDir, oldDir)
    expect(result.moved).toEqual([])
    expect(existsSync(join(oldDir, 'library.db'))).toBe(true)
  })

  it('reports a problem rather than throwing', () => {
    // A file where the destination directory should be cannot be written into.
    seedOldLibrary()
    writeFileSync(newDir, 'not-a-directory')

    const result = migrateAppData(oldDir, newDir)
    expect(result.problem).toBeTruthy()
    expect(result.moved).toEqual([])
    // The original data is still there to try again with.
    expect(existsSync(join(oldDir, 'library.db'))).toBe(true)
  })
})
