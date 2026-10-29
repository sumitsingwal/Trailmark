import type BetterSqlite3 from 'better-sqlite3'

/**
 * Schema and migrations.
 *
 * Versioned through SQLite's own `user_version` pragma, so there is no separate
 * bookkeeping table to keep in step. Migrations are append-only: once a version has
 * shipped it is never edited, because someone's library on disk has already run it.
 */

export interface Migration {
  version: number
  description: string
  up: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'folders, recordings, steps, screenshots',
    up: `
      CREATE TABLE folders (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        -- '' means the library root. A nullable column would defeat the UNIQUE
        -- constraint below, because SQLite treats NULLs as distinct from each other.
        parent_id   TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        UNIQUE (parent_id, name)
      );

      CREATE TABLE recordings (
        id           TEXT PRIMARY KEY,
        folder_id    TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        start_url    TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN ('recording', 'completed', 'aborted')),
        created_at   TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE steps (
        id              TEXT PRIMARY KEY,
        recording_id    TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
        -- Order in which the step was captured; never changes.
        seq             INTEGER NOT NULL,
        -- Order in which the step is displayed and exported; the review screen edits this.
        position        INTEGER NOT NULL,
        type            TEXT NOT NULL,
        at_ms           INTEGER NOT NULL,
        url             TEXT NOT NULL DEFAULT '',
        page_title      TEXT NOT NULL DEFAULT '',
        frame_url       TEXT,
        -- Generated description, editable during review.
        action          TEXT NOT NULL,
        expected_result TEXT NOT NULL DEFAULT '',
        note            TEXT NOT NULL DEFAULT '',
        element_label   TEXT NOT NULL DEFAULT '',
        input_value     TEXT NOT NULL DEFAULT '',
        masked          INTEGER NOT NULL DEFAULT 0 CHECK (masked IN (0, 1)),
        recommended_kind       TEXT,
        recommended_expression TEXT,
        recommended_unique     INTEGER,
        recommended_matches    INTEGER,
        -- Full validated event, for the locator block and anything added later.
        payload         TEXT NOT NULL,
        UNIQUE (recording_id, seq)
      );

      CREATE TABLE screenshots (
        id           TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
        -- The step this is the expected result for. Kept if the step is removed, so
        -- an image is never silently orphaned on disk without a row pointing at it.
        step_id      TEXT REFERENCES steps(id) ON DELETE SET NULL,
        file_name    TEXT NOT NULL,
        width        INTEGER NOT NULL DEFAULT 0,
        height       INTEGER NOT NULL DEFAULT 0,
        captured_at  TEXT NOT NULL
      );

      CREATE INDEX idx_recordings_folder ON recordings (folder_id, created_at DESC);
      CREATE INDEX idx_steps_recording   ON steps (recording_id, position);
      CREATE INDEX idx_steps_url         ON steps (url);
      CREATE INDEX idx_shots_recording   ON screenshots (recording_id);
      CREATE INDEX idx_shots_step        ON screenshots (step_id);
    `
  }
]

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)

/** Applies every migration newer than the database's current version. */
export function migrate(db: BetterSqlite3.Database): number {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((migration) => migration.version > current).sort(
    (a, b) => a.version - b.version
  )

  for (const migration of pending) {
    // Each migration is one transaction: a failure leaves the database on the
    // previous version rather than half-migrated.
    const run = db.transaction(() => {
      db.exec(migration.up)
      db.pragma(`user_version = ${migration.version}`)
    })
    run()
  }

  return db.pragma('user_version', { simple: true }) as number
}
