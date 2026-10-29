import ExcelJS from 'exceljs'
import { readFile } from 'node:fs/promises'
import { readPngSize } from '../storage/png.ts'
import { FIRST_LOCATOR_INDEX, type ExportDocument } from './rows.ts'

/**
 * Excel rendering.
 *
 * Laid out so the sheet still reads like the manual clickpath: the business columns
 * are frozen and the locator block is grouped and collapsed, so a business reader
 * sees what they always saw and the automation team expands one outline to get the
 * selectors.
 */

/** Widest a screenshot is displayed at, in points. Keeps rows a sane height. */
const SHOT_WIDTH = 190
const SHOT_MAX_HEIGHT = 150

export interface XlsxOptions {
  /**
   * Embed the images in the workbook. Off produces a small file that references the
   * PNGs written alongside it — full-page screenshots are large, and a long
   * walkthrough can otherwise make a workbook awkward to email.
   */
  embedScreenshots: boolean
}

export async function buildWorkbook(
  document: ExportDocument,
  options: XlsxOptions
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Trailmark'
  workbook.created = new Date(document.recording.createdAt)

  const sheet = workbook.addWorksheet('Clickpath', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
    properties: { defaultRowHeight: 18 }
  })

  // --- heading ----------------------------------------------------------
  sheet.mergeCells(1, 1, 1, Math.min(8, document.columns.length))
  const title = sheet.getCell(1, 1)
  title.value = document.recording.name
  title.font = { bold: true, size: 14 }

  sheet.mergeCells(2, 1, 2, Math.min(8, document.columns.length))
  const subtitle = sheet.getCell(2, 1)
  subtitle.value = `${document.recording.startUrl}    ·    ${document.rows.length} steps    ·    recorded ${formatDate(
    document.recording.createdAt
  )}`
  subtitle.font = { color: { argb: 'FF666666' }, size: 10 }

  sheet.getRow(3).height = 6

  // --- header row -------------------------------------------------------
  const headerRow = sheet.getRow(4)
  document.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = column.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: column.block === 'business' ? 'FF2F5BB7' : 'FF5A6478' }
    }
    cell.alignment = { vertical: 'middle', wrapText: true }
    sheet.getColumn(index + 1).width = column.width
  })
  headerRow.height = 22

  // The locator block is an outline group so a business reader can collapse it, but
  // it is NOT hidden: a hidden column looks like missing data, and the whole point of
  // the block is that the automation team can see it.
  for (let index = FIRST_LOCATOR_INDEX; index < document.columns.length; index += 1) {
    sheet.getColumn(index + 1).outlineLevel = 1
  }
  sheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false }

  // --- data rows --------------------------------------------------------
  const keyToIndex = new Map(document.columns.map((column, index) => [column.key, index + 1]))
  const screenshotColumn = keyToIndex.get('screenshot') ?? 8

  for (const [rowOffset, row] of document.rows.entries()) {
    const rowNumber = 5 + rowOffset
    const sheetRow = sheet.getRow(rowNumber)

    document.columns.forEach((column, index) => {
      const cell = sheetRow.getCell(index + 1)
      cell.value = row.values[column.key] ?? ''
      cell.alignment = { vertical: 'top', wrapText: column.key !== 'step' }
      cell.font = { size: 10 }
    })

    if (row.ambiguous) {
      // Flag the locator, not the whole row: the action itself is still correct.
      const uniqueCell = sheetRow.getCell(keyToIndex.get('unique') ?? 1)
      uniqueCell.font = { size: 10, bold: true, color: { argb: 'FF9A6000' } }
      uniqueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3D6' } }
    }

    if (row.masked) {
      const inputCell = sheetRow.getCell(keyToIndex.get('input') ?? 1)
      inputCell.font = { size: 10, italic: true, color: { argb: 'FF888888' } }
    }

    if (options.embedScreenshots && row.screenshotPath) {
      await embedScreenshot(workbook, sheet, row.screenshotPath, rowNumber, screenshotColumn)
    }
  }

  // --- captures with no step -------------------------------------------
  if (document.unattached.length > 0) {
    const startRow = 6 + document.rows.length
    const cell = sheet.getCell(startRow, 1)
    cell.value = `Captures not attached to a step (${document.unattached.length})`
    cell.font = { bold: true, size: 10, color: { argb: 'FF666666' } }
  }

  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + document.rows.length, column: document.columns.length }
  }

  return workbook
}

/**
 * Places a screenshot against its row, scaled to fit.
 *
 * Full-page captures can be twenty thousand pixels tall, so the displayed size is
 * capped and the row height set to match. The image data is unchanged — only how
 * Excel draws it.
 */
async function embedScreenshot(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  filePath: string,
  rowNumber: number,
  column: number
): Promise<void> {
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch {
    // A missing file must not abort the whole export.
    return
  }

  const size = readPngSize(buffer)
  if (!size) return

  const scale = Math.min(SHOT_WIDTH / size.width, SHOT_MAX_HEIGHT / size.height, 1)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))

  const imageId = workbook.addImage({
    buffer: buffer as unknown as ExcelJS.Buffer,
    extension: 'png'
  })
  sheet.addImage(imageId, {
    // Anchored one cell in from the column edge so the file name stays readable.
    tl: { col: column - 1 + 0.05, row: rowNumber - 1 + 0.05 },
    ext: { width, height },
    editAs: 'oneCell'
  })

  const row = sheet.getRow(rowNumber)
  // Excel row height is in points, roughly 0.75 per pixel.
  row.height = Math.max(row.height ?? 18, height * 0.78 + 6)
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 16).replace('T', ' ')
}
