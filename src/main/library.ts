import { join } from 'node:path'
import { app } from 'electron'

/**
 * Where the library lives on disk.
 *
 * One database for every recording, because the library view queries across them.
 * Screenshots stay as ordinary files under `recordings/<id>/shots`, so they remain
 * usable without the app and keep the database small.
 */
export interface LibraryPaths {
  databasePath: string
  mediaDir: string
  /** One persistent browser profile per project folder. */
  profilesDir: string
}

export function libraryPaths(): LibraryPaths {
  const base = app.getPath('userData')
  return {
    databasePath: join(base, 'library.db'),
    mediaDir: join(base, 'recordings'),
    profilesDir: join(base, 'profiles')
  }
}
