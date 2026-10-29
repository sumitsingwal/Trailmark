import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { RecordingStore } from '../storage/store.ts'
import { buildExportDocument } from './rows.ts'
import { toCsv } from './csv.ts'
import { buildWorkbook } from './xlsx.ts'

/**
 * Writes a recording out as a clickpath document.
 *
 * Screenshots are copied next to the file as well as embedded, so the images stay
 * usable on their own — reviewers paste them into tickets, and a workbook is an
 * awkward place to get one back out of.
 */

export type ExportFormat = 'xlsx' | 'csv'

export interface ExportRequest {
  store: RecordingStore
  recordingId: string
  format: ExportFormat
  /** Destination file. Its extension is corrected to match the format. */
  filePath: string
  embedScreenshots?: boolean
}

export interface ExportResult {
  filePath: string
  stepCount: number
  screenshotCount: number
  /** Directory the PNGs were copied into, when there were any. */
  screenshotDir?: string
}

export async function exportRecording(request: ExportRequest): Promise<ExportResult> {
  const recording = request.store.getRecording(request.recordingId)
  if (!recording) throw new Error('That recording no longer exists')

  const steps = request.store.listSteps(request.recordingId)
  const screenshots = request.store.listScreenshots(request.recordingId)

  const filePath = withExtension(request.filePath, request.format)
  const stem = basename(filePath, extname(filePath))
  const screenshotDirName = `${stem}_screenshots`
  const document = buildExportDocument({
    recording,
    steps,
    screenshots,
    ...(screenshots.length > 0 ? { screenshotDirName } : {})
  })

  await mkdir(dirname(filePath), { recursive: true })

  if (request.format === 'csv') {
    await writeFile(filePath, toCsv(document), 'utf8')
  } else {
    const workbook = await buildWorkbook(document, {
      embedScreenshots: request.embedScreenshots ?? true
    })
    await workbook.xlsx.writeFile(filePath)
  }

  let screenshotDir: string | undefined
  if (screenshots.length > 0) {
    screenshotDir = join(dirname(filePath), screenshotDirName)
    await mkdir(screenshotDir, { recursive: true })
    for (const shot of screenshots) {
      // A missing image must not fail an otherwise complete export.
      await copyFile(shot.filePath, join(screenshotDir, shot.fileName)).catch(() => undefined)
    }
  }

  return {
    filePath,
    stepCount: steps.length,
    screenshotCount: screenshots.length,
    ...(screenshotDir ? { screenshotDir } : {})
  }
}

/** A name typed as "checkout" or "checkout.xls" still gets the right extension. */
export function withExtension(filePath: string, format: ExportFormat): string {
  const current = extname(filePath).toLowerCase()
  if (current === `.${format}`) return filePath
  const stem = current ? filePath.slice(0, -current.length) : filePath
  return `${stem}.${format}`
}

/** A file name safe on macOS and Windows, derived from the recording's name. */
export function suggestFileName(name: string, format: ExportFormat): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${cleaned || 'clickpath'}.${format}`
}
