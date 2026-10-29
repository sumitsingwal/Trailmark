import type {
  FolderDto,
  LibraryEvent,
  RecorderStatusDto,
  RecordingDetailDto,
  RecordingDto,
  ScreenshotDto,
  StartRecordingInput,
  StepDto,
  StepEdit
} from '@shared/library'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { descendantFolderIds } from '@shared/folder-tree'
import type { RecordedStep } from '../recorder/events.ts'
import type { RecordingSession, RecordingSessionOptions } from '../recorder/driver.ts'
import type { RecordingStore, Screenshot, StoredStep } from '../storage/store.ts'
import { exportRecording, type ExportFormat, type ExportResult } from '../export/index.ts'
import { locatorDetails } from '../export/rows.ts'

/**
 * Everything the app does with the library, with no Electron in sight.
 *
 * The IPC handlers are thin adapters over this, which is what lets the whole of it —
 * live recording included — be tested with a real database and a stub session,
 * without booting a window.
 */

/** Injected so tests can run the service without launching a browser. */
export type SessionFactory = (options: RecordingSessionOptions) => Promise<RecordingSession>

export interface LibraryServiceOptions {
  store: RecordingStore
  createSession: SessionFactory
  /** Directory holding one persistent browser profile per folder. */
  profilesDir: string
  /** Chromium for the recorder to drive; undefined lets Playwright choose. */
  chromiumExecutable?: string
  /** Turns an on-disk screenshot into something the renderer can display. */
  mediaUrl: (shot: Screenshot) => string
  emit: (event: LibraryEvent) => void
}

export class LibraryService {
  private readonly store: RecordingStore
  private readonly createSession: SessionFactory
  private readonly mediaUrl: (shot: Screenshot) => string
  private readonly emit: (event: LibraryEvent) => void
  private readonly profilesDir: string
  private readonly chromiumExecutable: string | undefined

  private session: RecordingSession | null = null
  private activeRecordingId: string | null = null
  private stopping = false

  constructor(options: LibraryServiceOptions) {
    this.store = options.store
    this.createSession = options.createSession
    this.mediaUrl = options.mediaUrl
    this.emit = options.emit
    this.profilesDir = options.profilesDir
    this.chromiumExecutable = options.chromiumExecutable
  }

  // --- sign-in profiles ---------------------------------------------------

  /**
   * Where a folder's persistent browser profile lives.
   *
   * Per folder rather than per recording: a folder is a project, and signing in to
   * the application under test once per project is the whole point.
   */
  profileDirFor(folderId: string): string {
    return join(this.profilesDir, folderId)
  }

  hasProfile(folderId: string): boolean {
    return existsSync(this.profileDirFor(folderId))
  }

  /** Forgets a saved sign-in. Refused mid-recording, which is using the profile. */
  clearProfile(folderId: string): void {
    if (this.activeRecordingId && this.recordingIsIn(this.activeRecordingId, folderId)) {
      throw new Error('Stop the current recording before clearing its saved sign-in')
    }
    rmSync(this.profileDirFor(folderId), { recursive: true, force: true })
  }

  // --- folders ------------------------------------------------------------

  listFolders(): FolderDto[] {
    const folders = this.store.listFolders()
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      recordingCount: this.store.listRecordings(folder.id).length
    }))
  }

  createFolder(name: string, parentId: string): FolderDto {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('A folder needs a name')
    const folder = this.store.createFolder(trimmed, parentId)
    return { id: folder.id, name: folder.name, parentId: folder.parentId, recordingCount: 0 }
  }

  /**
   * Deletes a folder and everything beneath it: nested folders, their recordings,
   * those recordings' screenshots, and the saved sign-in profiles.
   *
   * Descendants are handled explicitly because `parent_id` has no foreign key, so the
   * database does not cascade folder deletion on its own. Without this a child folder
   * outlived its parent and resurfaced at the top level, and its screenshots and
   * session cookies stayed on disk with nothing pointing at them.
   */
  deleteFolder(id: string): void {
    const doomed = descendantFolderIds(this.listFolders(), id)

    // Deleting a folder out from under a live recording would orphan the session.
    const live = this.activeRecordingId
      ? this.store.getRecording(this.activeRecordingId)?.folderId
      : undefined
    if (live && doomed.includes(live)) {
      throw new Error('Stop the current recording before deleting its folder')
    }

    for (const folderId of doomed) {
      // deleteRecording removes the screenshots from disk as well as the rows.
      for (const recording of this.store.listRecordings(folderId)) {
        this.store.deleteRecording(recording.id)
      }
      // A saved sign-in belongs to the folder; it must not outlive it.
      rmSync(this.profileDirFor(folderId), { recursive: true, force: true })
      this.store.deleteFolder(folderId)
    }
  }

  /** What deleting this folder would take with it, for the confirmation. */
  folderDeletionSummary(id: string): { folders: number; recordings: number } {
    const doomed = descendantFolderIds(this.listFolders(), id)
    const recordings = doomed.reduce(
      (total, folderId) => total + this.store.listRecordings(folderId).length,
      0
    )
    // Exclude the folder being deleted from the nested count.
    return { folders: doomed.length - 1, recordings }
  }

  private recordingIsIn(recordingId: string, folderId: string): boolean {
    return this.store.getRecording(recordingId)?.folderId === folderId
  }

  // --- recordings ---------------------------------------------------------

  listRecordings(folderId?: string): RecordingDto[] {
    return this.store.listRecordings(folderId).map((row) => ({
      id: row.id,
      folderId: row.folderId,
      name: row.name,
      startUrl: row.startUrl,
      status: row.status,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      stepCount: row.stepCount,
      screenshotCount: row.screenshotCount
    }))
  }

  getRecording(id: string): RecordingDetailDto | undefined {
    const summary = this.listRecordings().find((r) => r.id === id)
    if (!summary) return undefined

    const shots = this.store.listScreenshots(id)
    const byStep = new Map<string, Screenshot>()
    for (const shot of shots) if (shot.stepId) byStep.set(shot.stepId, shot)

    const steps = this.store.listSteps(id).map((step) => this.toStepDto(step, byStep.get(step.id)))
    const unattached = shots.filter((shot) => !shot.stepId).map((shot) => this.toShotDto(shot))

    return { recording: summary, steps, unattached }
  }

  renameRecording(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('A recording needs a name')
    this.store.renameRecording(id, trimmed)
  }

  moveRecording(id: string, folderId: string): void {
    this.store.moveRecording(id, folderId)
  }

  deleteRecording(id: string): void {
    if (this.activeRecordingId === id) {
      throw new Error('Stop the current recording before deleting it')
    }
    this.store.deleteRecording(id)
  }

  // --- steps --------------------------------------------------------------

  updateStep(id: string, changes: StepEdit): void {
    this.store.updateStep(id, changes)
  }

  deleteStep(id: string): void {
    this.store.deleteStep(id)
  }

  /**
   * Refused while that recording is live: the form the value was typed into may not
   * have been submitted yet, and the URL that carries it would arrive unredacted.
   */
  markStepSensitive(id: string): void {
    const step = this.store.getStep(id)
    if (!step) return
    if (this.activeRecordingId === step.recordingId) {
      throw new Error('Stop the recording before marking a value as sensitive')
    }
    this.store.markStepSensitive(id)
  }

  /** Moves one step up or down in display order, leaving capture order untouched. */
  moveStep(recordingId: string, stepId: string, direction: -1 | 1): void {
    const ids = this.store.listSteps(recordingId).map((step) => step.id)
    const from = ids.indexOf(stepId)
    const to = from + direction
    if (from === -1 || to < 0 || to >= ids.length) return
    const reordered = [...ids]
    const [moved] = reordered.splice(from, 1)
    if (!moved) return
    reordered.splice(to, 0, moved)
    this.store.reorderSteps(recordingId, reordered)
  }

  deleteScreenshot(id: string): void {
    this.store.deleteScreenshot(id)
  }

  // --- export -------------------------------------------------------------

  async exportRecording(input: {
    recordingId: string
    format: ExportFormat
    filePath: string
    embedScreenshots?: boolean
  }): Promise<ExportResult> {
    return exportRecording({ store: this.store, ...input })
  }

  // --- recording ----------------------------------------------------------

  get status(): RecorderStatusDto {
    if (!this.session || !this.activeRecordingId) {
      return { state: 'idle', recordingId: null, stepCount: 0, screenshotCount: 0 }
    }
    const summary = this.store.listRecordings().find((r) => r.id === this.activeRecordingId)
    return {
      state: this.session.isPaused ? 'paused' : 'recording',
      recordingId: this.activeRecordingId,
      stepCount: summary?.stepCount ?? 0,
      screenshotCount: summary?.screenshotCount ?? 0
    }
  }

  async startRecording(input: StartRecordingInput): Promise<RecordingDto> {
    if (this.session) throw new Error('A recording is already in progress')

    const name = input.name.trim()
    if (!name) throw new Error('A recording needs a name')
    const startUrl = normaliseUrl(input.startUrl)

    const recording = this.store.createRecording({
      name,
      startUrl,
      folderId: input.folderId
    })
    this.activeRecordingId = recording.id

    try {
      this.session = await this.createSession({
        startUrl,
        headless: false,
        ...(this.chromiumExecutable ? { executablePath: this.chromiumExecutable } : {}),
        // Reusing the folder's profile means the tester signs in once per project.
        ...(input.reuseProfile === false ? {} : { profileDir: this.profileDirFor(input.folderId) }),
        onStep: (step) => this.onStep(recording.id, step),
        onScreenshot: (shot) => this.onScreenshot(recording.id, shot),
        onNote: (note) => this.onNote(recording.id, note),
        onPauseChanged: () => this.pushStatus(),
        onStopRequested: () => void this.stopRecording(),
        onRejected: () => undefined
      })
    } catch (error) {
      // The browser never opened; do not leave an empty recording behind.
      this.activeRecordingId = null
      this.store.deleteRecording(recording.id)
      throw error
    }

    // Closing the browser window is as valid a way to finish as pressing Stop.
    this.session.page.on('close', () => void this.stopRecording())

    this.pushStatus()
    return this.listRecordings().find((r) => r.id === recording.id)!
  }

  async stopRecording(): Promise<void> {
    if (!this.session || this.stopping) return
    this.stopping = true
    const session = this.session
    const recordingId = this.activeRecordingId

    try {
      await session.stop()
    } finally {
      this.session = null
      this.activeRecordingId = null
      this.stopping = false
      if (recordingId) this.store.finishRecording(recordingId, 'completed')
      this.pushStatus()
    }
  }

  async setPaused(paused: boolean): Promise<void> {
    if (!this.session) return
    await this.session.setPaused(paused)
    this.pushStatus()
  }

  async capture(): Promise<void> {
    if (!this.session) return
    await this.session.capture(this.session.page)
  }

  // --- live callbacks -----------------------------------------------------

  private onStep(recordingId: string, step: RecordedStep): void {
    const stored = this.store.appendStep(recordingId, step)
    this.emit({ type: 'step', recordingId, step: this.toStepDto(stored, undefined) })
    this.pushStatus()
  }

  private onScreenshot(recordingId: string, shot: { data: Buffer; afterSeq: number | null }): void {
    const target =
      shot.afterSeq === null ? undefined : this.store.findStepBySeq(recordingId, shot.afterSeq)
    const saved = this.store.saveScreenshot({
      recordingId,
      stepId: target?.id ?? null,
      data: shot.data
    })
    this.emit({
      type: 'screenshot',
      recordingId,
      screenshot: this.toShotDto(saved),
      stepId: target?.id ?? null
    })
    this.pushStatus()
  }

  private onNote(recordingId: string, note: { text: string; afterSeq: number | null }): void {
    const target =
      note.afterSeq === null ? undefined : this.store.findStepBySeq(recordingId, note.afterSeq)
    if (!target) return
    this.store.updateStep(target.id, { note: note.text })
    this.emit({ type: 'note', recordingId, stepId: target.id, note: note.text })
  }

  private pushStatus(): void {
    this.emit({ type: 'status', status: this.status })
  }

  // --- mapping ------------------------------------------------------------

  private toStepDto(step: StoredStep, shot: Screenshot | undefined): StepDto {
    return {
      id: step.id,
      position: step.position,
      seq: step.seq,
      type: step.type,
      atMs: step.atMs,
      action: step.action,
      expectedResult: step.expectedResult,
      note: step.note,
      url: step.url,
      pageTitle: step.pageTitle,
      inputValue: step.inputValue,
      masked: step.masked,
      // Same extraction the spreadsheet uses, so screen and export agree.
      locator: locatorDetails(step.payload),
      screenshot: shot ? this.toShotDto(shot) : null
    }
  }

  private toShotDto(shot: Screenshot): ScreenshotDto {
    return {
      id: shot.id,
      stepId: shot.stepId,
      src: this.mediaUrl(shot),
      width: shot.width,
      height: shot.height
    }
  }
}

/**
 * Accepts what someone would paste from a browser bar.
 *
 * A bare host is assumed to be https, since typing "app.internal" and getting a
 * file-not-found is unhelpful. Anything declaring a scheme the recorder cannot drive
 * is rejected by name, so the message says what was wrong.
 */
const RECORDABLE = ['http:', 'https:', 'file:']

export function normaliseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('A recording needs a start URL')

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase()
  // "localhost:3000/app" parses as scheme "localhost"; it is a host and port.
  const isHostPort = /^[a-z0-9.-]+:\d+(\/|$)/i.test(trimmed)

  let candidate: string
  if (scheme && !isHostPort) {
    if (!RECORDABLE.includes(`${scheme}:`)) {
      throw new Error(`Cannot record ${scheme}: URLs`)
    }
    candidate = trimmed
  } else {
    candidate = `https://${trimmed}`
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error(`That does not look like a URL: ${raw}`)
  }
  if (!RECORDABLE.includes(url.protocol)) {
    throw new Error(`Cannot record ${url.protocol} URLs`)
  }
  return url.toString()
}
