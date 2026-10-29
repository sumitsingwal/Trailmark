/**
 * The shapes that cross the IPC boundary.
 *
 * Deliberately separate from the storage row types: the renderer never sees the full
 * recorded event payload (it is large, and only the export needs it), and keeping a
 * declared contract here means the renderer compiles without any Node or database
 * types leaking into it.
 */

export interface FolderDto {
  id: string
  name: string
  parentId: string
  /** Recordings directly in this folder. */
  recordingCount: number
}

export type RecordingStatus = 'recording' | 'completed' | 'aborted'

export interface RecordingDto {
  id: string
  folderId: string
  name: string
  startUrl: string
  status: RecordingStatus
  createdAt: string
  completedAt: string | null
  stepCount: number
  screenshotCount: number
}

export interface StepDto {
  id: string
  position: number
  seq: number
  type: string
  atMs: number
  /** Generated description, edited by the reviewer. */
  action: string
  expectedResult: string
  note: string
  url: string
  pageTitle: string
  inputValue: string
  masked: boolean
  /** Locator detail, in the same form the export shows it. */
  locator: {
    xpath: string
    xpathMatches: number | null
  }
  /** Set when a captured expected-page image is attached to this step. */
  screenshot: ScreenshotDto | null
}

export interface ScreenshotDto {
  id: string
  stepId: string | null
  /** A trailmark-media: URL the renderer can put in an <img src>. */
  src: string
  width: number
  height: number
}

export interface RecordingDetailDto {
  recording: RecordingDto
  steps: StepDto[]
  /** Captures not attached to any step, e.g. taken before the first action. */
  unattached: ScreenshotDto[]
}

export type RecorderState = 'idle' | 'recording' | 'paused'

export interface RecorderStatusDto {
  state: RecorderState
  recordingId: string | null
  stepCount: number
  screenshotCount: number
  /** Present when a recording failed to start or ended badly. */
  error?: string
}

/** Pushed from main whenever something changes during a live recording. */
export type LibraryEvent =
  | { type: 'status'; status: RecorderStatusDto }
  | { type: 'step'; recordingId: string; step: StepDto }
  | { type: 'screenshot'; recordingId: string; screenshot: ScreenshotDto; stepId: string | null }
  | { type: 'note'; recordingId: string; stepId: string; note: string }

export interface StartRecordingInput {
  name: string
  startUrl: string
  folderId: string
  /**
   * Reuse the folder's saved browser profile so an existing sign-in carries over.
   * Defaults to true; false gives a clean browser for this recording only.
   */
  reuseProfile?: boolean
}

export interface StepEdit {
  action?: string
  expectedResult?: string
  note?: string
}

export type ExportFormat = 'xlsx' | 'csv'

export interface ExportResultDto {
  /** Absent when the user cancelled the save dialog. */
  filePath?: string
  stepCount?: number
  screenshotCount?: number
  screenshotDir?: string
  cancelled: boolean
}
