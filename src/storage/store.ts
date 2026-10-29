import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RecordedStep } from '../recorder/events.ts'
import { describeStep, elementName } from '../recorder/format.ts'
import { migrate } from './schema.ts'
import { STORED_MASK, sanitiseStep, storedInputValue } from './sanitise.ts'
import { redactUrlParam } from '../recorder/redact.ts'
import { readPngSize } from './png.ts'

/**
 * The library: one SQLite database for every recording, plus a directory of
 * screenshots per recording.
 *
 * One database rather than one per recording, because the library view queries
 * across them — recordings in a folder, newest first, step counts, and later "which
 * clickpaths touch this URL". Screenshots stay as ordinary PNG files on disk so the
 * database stays small and the images remain usable without the app.
 *
 * Synchronous by design: better-sqlite3 has no async API, local writes are fast, and
 * the main process is the only writer.
 */

export const ROOT_FOLDER_ID = 'root'

export interface Folder {
  id: string
  name: string
  parentId: string
  createdAt: string
}

export interface Recording {
  id: string
  folderId: string
  name: string
  startUrl: string
  status: 'recording' | 'completed' | 'aborted'
  createdAt: string
  completedAt: string | null
}

export interface StoredStep {
  id: string
  recordingId: string
  seq: number
  position: number
  type: string
  atMs: number
  url: string
  pageTitle: string
  frameUrl: string | null
  action: string
  expectedResult: string
  note: string
  elementLabel: string
  inputValue: string
  masked: boolean
  recommendedKind: string | null
  recommendedExpression: string | null
  recommendedUnique: boolean | null
  recommendedMatches: number | null
  payload: RecordedStep
}

export interface RecordingSummary extends Recording {
  stepCount: number
  screenshotCount: number
}

export interface Screenshot {
  id: string
  recordingId: string
  /** The step this is the expected result for, if it is still present. */
  stepId: string | null
  fileName: string
  /** Absolute path on disk. Not stored; derived from the media directory. */
  filePath: string
  width: number
  height: number
  capturedAt: string
}

export interface StoreOptions {
  /** Path to library.db. Parent directories are created if missing. */
  databasePath: string
  /** Directory that holds one screenshot folder per recording. */
  mediaDir: string
  /** Called when sanitisation had to scrub something — always a bug worth seeing. */
  onViolation?: (recordingId: string, violations: string[]) => void
}

interface StepRow {
  id: string
  recording_id: string
  seq: number
  position: number
  type: string
  at_ms: number
  url: string
  page_title: string
  frame_url: string | null
  action: string
  expected_result: string
  note: string
  element_label: string
  input_value: string
  masked: number
  recommended_kind: string | null
  recommended_expression: string | null
  recommended_unique: number | null
  recommended_matches: number | null
  payload: string
}

export class RecordingStore {
  private readonly db: Database.Database
  private readonly mediaDir: string
  private readonly onViolation: StoreOptions['onViolation']

  constructor(options: StoreOptions) {
    mkdirSync(dirname(options.databasePath), { recursive: true })
    mkdirSync(options.mediaDir, { recursive: true })

    this.db = new Database(options.databasePath)
    this.mediaDir = options.mediaDir
    this.onViolation = options.onViolation

    // WAL keeps appends during a live recording from blocking reads in the UI.
    this.db.pragma('journal_mode = WAL')
    // Off by default in SQLite; without it the ON DELETE CASCADEs are decorative.
    this.db.pragma('foreign_keys = ON')
    // Overwrites deleted and replaced content with zeros. Without it a value masked
    // after the fact would survive in free space inside the database file.
    this.db.pragma('secure_delete = ON')
    migrate(this.db)
    this.ensureRoot()
  }

  close(): void {
    this.db.close()
  }

  get version(): number {
    return this.db.pragma('user_version', { simple: true }) as number
  }

  private ensureRoot(): void {
    this.db
      .prepare(
        `INSERT INTO folders (id, name, parent_id, created_at)
         VALUES (?, 'Library', '', ?)
         ON CONFLICT (id) DO NOTHING`
      )
      .run(ROOT_FOLDER_ID, new Date().toISOString())
  }

  // --- folders ------------------------------------------------------------

  createFolder(name: string, parentId: string = ROOT_FOLDER_ID): Folder {
    const folder: Folder = {
      id: randomUUID(),
      name,
      parentId,
      createdAt: new Date().toISOString()
    }
    this.db
      .prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
      .run(folder.id, folder.name, folder.parentId, folder.createdAt)
    return folder
  }

  listFolders(parentId?: string): Folder[] {
    const rows =
      parentId === undefined
        ? (this.db.prepare('SELECT * FROM folders ORDER BY name').all() as Record<string, string>[])
        : (this.db
            .prepare('SELECT * FROM folders WHERE parent_id = ? ORDER BY name')
            .all(parentId) as Record<string, string>[])
    return rows.map((row) => ({
      id: row['id'] as string,
      name: row['name'] as string,
      parentId: row['parent_id'] as string,
      createdAt: row['created_at'] as string
    }))
  }

  deleteFolder(id: string): void {
    if (id === ROOT_FOLDER_ID) throw new Error('The library root cannot be deleted')
    // Recordings cascade, but their screenshots are files and must be removed too.
    for (const recording of this.listRecordings(id)) this.removeMedia(recording.id)
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  }

  // --- recordings ---------------------------------------------------------

  createRecording(input: { name: string; startUrl: string; folderId?: string }): Recording {
    const recording: Recording = {
      id: randomUUID(),
      folderId: input.folderId ?? ROOT_FOLDER_ID,
      name: input.name,
      startUrl: input.startUrl,
      status: 'recording',
      createdAt: new Date().toISOString(),
      completedAt: null
    }
    this.db
      .prepare(
        `INSERT INTO recordings (id, folder_id, name, start_url, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        recording.id,
        recording.folderId,
        recording.name,
        recording.startUrl,
        recording.status,
        recording.createdAt
      )
    mkdirSync(this.mediaDirFor(recording.id), { recursive: true })
    return recording
  }

  finishRecording(id: string, status: 'completed' | 'aborted' = 'completed'): void {
    this.db
      .prepare('UPDATE recordings SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id)
  }

  renameRecording(id: string, name: string): void {
    this.db.prepare('UPDATE recordings SET name = ? WHERE id = ?').run(name, id)
  }

  moveRecording(id: string, folderId: string): void {
    this.db.prepare('UPDATE recordings SET folder_id = ? WHERE id = ?').run(folderId, id)
  }

  getRecording(id: string): Recording | undefined {
    const row = this.db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as
      Record<string, unknown> | undefined
    return row ? this.toRecording(row) : undefined
  }

  listRecordings(folderId?: string): RecordingSummary[] {
    const where = folderId === undefined ? '' : 'WHERE r.folder_id = ?'
    const sql = `
      SELECT r.*,
             (SELECT COUNT(*) FROM steps s WHERE s.recording_id = r.id) AS step_count,
             (SELECT COUNT(*) FROM screenshots p WHERE p.recording_id = r.id) AS shot_count
      FROM recordings r ${where}
      -- rowid breaks ties: two recordings created in the same millisecond share a
      -- created_at, and without it their order would be arbitrary.
      ORDER BY r.created_at DESC, r.rowid DESC
    `
    const statement = this.db.prepare(sql)
    const rows = (folderId === undefined ? statement.all() : statement.all(folderId)) as Record<
      string,
      unknown
    >[]
    return rows.map((row) => ({
      ...this.toRecording(row),
      stepCount: Number(row['step_count'] ?? 0),
      screenshotCount: Number(row['shot_count'] ?? 0)
    }))
  }

  deleteRecording(id: string): void {
    this.removeMedia(id)
    this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id)
  }

  // --- steps --------------------------------------------------------------

  /**
   * Appends one step. Called live during a walkthrough, so each append is its own
   * committed transaction: losing power at minute 18 costs the last step, not the
   * recording.
   */
  appendStep(recordingId: string, raw: RecordedStep): StoredStep {
    const { step, violations } = sanitiseStep(raw)
    if (violations.length > 0) this.onViolation?.(recordingId, violations)

    const nextPosition = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM steps WHERE recording_id = ?')
      .get(recordingId) as { next: number }

    const target = 'target' in step ? step.target : undefined
    const stored: StoredStep = {
      id: randomUUID(),
      recordingId,
      seq: step.seq,
      position: nextPosition.next,
      type: step.type,
      atMs: Math.round(step.at),
      url: 'url' in step ? step.url : '',
      pageTitle: 'pageTitle' in step ? step.pageTitle : '',
      frameUrl: 'frameUrl' in step && step.frameUrl ? step.frameUrl : null,
      action: describeStep(step),
      expectedResult: '',
      note: '',
      elementLabel: target ? elementName(target) : '',
      inputValue: storedInputValue(step),
      masked: 'masked' in step ? Boolean(step.masked) : false,
      recommendedKind: step.recommended?.kind ?? null,
      recommendedExpression: step.recommended?.expression ?? null,
      recommendedUnique: step.recommended ? step.recommended.unique : null,
      recommendedMatches: step.recommended?.matches ?? null,
      payload: step
    }

    this.db
      .prepare(
        `INSERT INTO steps (
           id, recording_id, seq, position, type, at_ms, url, page_title, frame_url,
           action, expected_result, note, element_label, input_value, masked,
           recommended_kind, recommended_expression, recommended_unique,
           recommended_matches, payload
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stored.id,
        stored.recordingId,
        stored.seq,
        stored.position,
        stored.type,
        stored.atMs,
        stored.url,
        stored.pageTitle,
        stored.frameUrl,
        stored.action,
        stored.expectedResult,
        stored.note,
        stored.elementLabel,
        stored.inputValue,
        stored.masked ? 1 : 0,
        stored.recommendedKind,
        stored.recommendedExpression,
        stored.recommendedUnique === null ? null : stored.recommendedUnique ? 1 : 0,
        stored.recommendedMatches,
        JSON.stringify(stored.payload)
      )

    return stored
  }

  /** The step most recently appended to this recording, by display order. */
  lastStep(recordingId: string): StoredStep | undefined {
    const row = this.db
      .prepare('SELECT * FROM steps WHERE recording_id = ? ORDER BY position DESC LIMIT 1')
      .get(recordingId) as StepRow | undefined
    return row ? this.toStep(row) : undefined
  }

  findStepBySeq(recordingId: string, seq: number): StoredStep | undefined {
    const row = this.db
      .prepare('SELECT * FROM steps WHERE recording_id = ? AND seq = ?')
      .get(recordingId, seq) as StepRow | undefined
    return row ? this.toStep(row) : undefined
  }

  listSteps(recordingId: string): StoredStep[] {
    const rows = this.db
      .prepare('SELECT * FROM steps WHERE recording_id = ? ORDER BY position')
      .all(recordingId) as StepRow[]
    return rows.map((row) => this.toStep(row))
  }

  /** Review-screen edits. Only the human-authored columns are writable. */
  updateStep(
    id: string,
    changes: Partial<Pick<StoredStep, 'action' | 'expectedResult' | 'note'>>
  ): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (changes.action !== undefined) {
      sets.push('action = ?')
      values.push(changes.action)
    }
    if (changes.expectedResult !== undefined) {
      sets.push('expected_result = ?')
      values.push(changes.expectedResult)
    }
    if (changes.note !== undefined) {
      sets.push('note = ?')
      values.push(changes.note)
    }
    if (sets.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE steps SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  getStep(id: string): StoredStep | undefined {
    const row = this.db.prepare('SELECT * FROM steps WHERE id = ?').get(id) as StepRow | undefined
    return row ? this.toStep(row) : undefined
  }

  /**
   * Masks a value the recorder did not recognise as sensitive, after the fact.
   *
   * The plaintext is replaced wherever this library put it: the input column, the
   * stored event, and any text on the step that quotes it — the generated action
   * does. If the field has a name, the same parameter is redacted from every URL in
   * the recording, since a GET form carries the value into the next page's address.
   *
   * Irreversible by design: the plaintext is gone, not hidden. The WAL is then
   * checkpointed and truncated so the old row does not linger beside the database.
   */
  markStepSensitive(id: string): void {
    const step = this.getStep(id)
    if (!step || step.masked) return
    const payload = step.payload
    if (payload.type !== 'input' && payload.type !== 'select') {
      throw new Error('Only a step with an entered value can be marked sensitive')
    }

    const secrets = [payload.value, payload.type === 'select' ? payload.optionLabel : '']
      .filter((secret) => secret.length > 0)
      // Longest first, so a label that contains the value is not half-replaced.
      .sort((a, b) => b.length - a.length)
    const scrub = (text: string): string =>
      secrets.reduce((result, secret) => result.replaceAll(secret, STORED_MASK), text)

    const masked = {
      ...payload,
      value: STORED_MASK,
      ...(payload.type === 'select' ? { optionLabel: STORED_MASK } : { masked: true })
    } as RecordedStep

    const fieldName = payload.target.name
    const others = fieldName ? this.listSteps(step.recordingId) : []

    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE steps SET input_value = ?, masked = 1, action = ?, expected_result = ?,
             note = ?, payload = ? WHERE id = ?`
        )
        .run(
          STORED_MASK,
          scrub(step.action),
          scrub(step.expectedResult),
          scrub(step.note),
          JSON.stringify(masked),
          id
        )

      const update = this.db.prepare(
        'UPDATE steps SET url = ?, frame_url = ?, action = ?, payload = ? WHERE id = ?'
      )
      for (const other of others) {
        if (!fieldName) break
        const url = redactUrlParam(other.url, fieldName)
        const frameUrl = other.frameUrl === null ? null : redactUrlParam(other.frameUrl, fieldName)
        if (url === other.url && frameUrl === other.frameUrl) continue
        const next: Record<string, unknown> = { ...(other.id === id ? masked : other.payload) }
        if (typeof next['url'] === 'string') next['url'] = redactUrlParam(next['url'], fieldName)
        if (typeof next['frameUrl'] === 'string') {
          next['frameUrl'] = redactUrlParam(next['frameUrl'], fieldName)
        }
        // A navigation with no page title describes itself by its URL.
        const action = (other.id === id ? scrub(step.action) : other.action).replaceAll(
          other.url,
          url
        )
        update.run(url, frameUrl, action, JSON.stringify(next), other.id)
      }
    })
    run()

    this.db.pragma('wal_checkpoint(TRUNCATE)')
  }

  deleteStep(id: string): void {
    this.db.prepare('DELETE FROM steps WHERE id = ?').run(id)
  }

  /** Rewrites display order from an explicit list of step ids. */
  reorderSteps(recordingId: string, orderedIds: readonly string[]): void {
    const update = this.db.prepare(
      'UPDATE steps SET position = ? WHERE id = ? AND recording_id = ?'
    )
    const run = this.db.transaction((ids: readonly string[]) => {
      ids.forEach((id, index) => update.run(index, id, recordingId))
    })
    run(orderedIds)
  }

  // --- screenshots --------------------------------------------------------

  /**
   * Writes the image to disk and records it against a step.
   *
   * The file is written before the row is inserted: an image with no row is
   * recoverable clutter, whereas a row pointing at a file that was never written
   * would break the export.
   */
  saveScreenshot(input: { recordingId: string; stepId: string | null; data: Buffer }): Screenshot {
    const dir = this.mediaDirFor(input.recordingId)
    mkdirSync(dir, { recursive: true })

    const existing = this.db
      .prepare('SELECT COUNT(*) AS n FROM screenshots WHERE recording_id = ?')
      .get(input.recordingId) as { n: number }
    const fileName = `${String(existing.n + 1).padStart(3, '0')}.png`
    const filePath = join(dir, fileName)
    writeFileSync(filePath, input.data)

    const size = readPngSize(input.data)
    const shot: Screenshot = {
      id: randomUUID(),
      recordingId: input.recordingId,
      stepId: input.stepId,
      fileName,
      filePath,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      capturedAt: new Date().toISOString()
    }

    this.db
      .prepare(
        `INSERT INTO screenshots (id, recording_id, step_id, file_name, width, height, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        shot.id,
        shot.recordingId,
        shot.stepId,
        shot.fileName,
        shot.width,
        shot.height,
        shot.capturedAt
      )

    return shot
  }

  listScreenshots(recordingId: string): Screenshot[] {
    const rows = this.db
      .prepare('SELECT * FROM screenshots WHERE recording_id = ? ORDER BY captured_at, rowid')
      .all(recordingId) as Record<string, unknown>[]
    return rows.map((row) => ({
      id: row['id'] as string,
      recordingId: row['recording_id'] as string,
      stepId: (row['step_id'] as string | null) ?? null,
      fileName: row['file_name'] as string,
      filePath: join(this.mediaDirFor(row['recording_id'] as string), row['file_name'] as string),
      width: Number(row['width'] ?? 0),
      height: Number(row['height'] ?? 0),
      capturedAt: row['captured_at'] as string
    }))
  }

  deleteScreenshot(id: string): void {
    const row = this.db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id) as
      Record<string, unknown> | undefined
    if (!row) return
    rmSync(join(this.mediaDirFor(row['recording_id'] as string), row['file_name'] as string), {
      force: true
    })
    this.db.prepare('DELETE FROM screenshots WHERE id = ?').run(id)
  }

  // --- media --------------------------------------------------------------

  /** Directory holding this recording's screenshots. */
  mediaDirFor(recordingId: string): string {
    return join(this.mediaDir, recordingId, 'shots')
  }

  private removeMedia(recordingId: string): void {
    rmSync(join(this.mediaDir, recordingId), { recursive: true, force: true })
  }

  // --- mapping ------------------------------------------------------------

  private toRecording(row: Record<string, unknown>): Recording {
    return {
      id: row['id'] as string,
      folderId: row['folder_id'] as string,
      name: row['name'] as string,
      startUrl: row['start_url'] as string,
      status: row['status'] as Recording['status'],
      createdAt: row['created_at'] as string,
      completedAt: (row['completed_at'] as string | null) ?? null
    }
  }

  private toStep(row: StepRow): StoredStep {
    return {
      id: row.id,
      recordingId: row.recording_id,
      seq: row.seq,
      position: row.position,
      type: row.type,
      atMs: row.at_ms,
      url: row.url,
      pageTitle: row.page_title,
      frameUrl: row.frame_url,
      action: row.action,
      expectedResult: row.expected_result,
      note: row.note,
      elementLabel: row.element_label,
      inputValue: row.input_value,
      masked: row.masked === 1,
      recommendedKind: row.recommended_kind,
      recommendedExpression: row.recommended_expression,
      recommendedUnique: row.recommended_unique === null ? null : row.recommended_unique === 1,
      recommendedMatches: row.recommended_matches,
      payload: JSON.parse(row.payload) as RecordedStep
    }
  }
}
