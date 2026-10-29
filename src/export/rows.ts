import type { LocatorCandidate, RecordedStep } from '../recorder/events.ts'
import type { Recording, Screenshot, StoredStep } from '../storage/store.ts'

/**
 * Turns a stored recording into the rows of the clickpath document.
 *
 * Pure, so the column mapping is tested directly rather than by reading spreadsheets.
 * Both the Excel and CSV writers consume this, which is what keeps the two formats
 * from drifting apart.
 *
 * The sheet is two blocks. The business block on the left is what the manual document
 * has always contained; the locator block on the right is what the automation team
 * needs and would otherwise write by hand.
 *
 * Several columns were retired on 2026-10-21 after a review of real exports (Element,
 * Recommended locator, Locator type, ID, Name, Test ID, Class, CSS, Playwright). The
 * recorder still captures everything they were built from, so any of them can be
 * restored by adding it back here — see "Removed functionality" in CLAUDE.md.
 */

export type ColumnBlock = 'business' | 'locator'

export interface ExportColumn {
  key: string
  header: string
  block: ColumnBlock
  width: number
}

export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'step', header: 'Step #', block: 'business', width: 8 },
  { key: 'action', header: 'Action', block: 'business', width: 42 },
  { key: 'page', header: 'Page', block: 'business', width: 22 },
  { key: 'url', header: 'URL', block: 'business', width: 38 },
  { key: 'input', header: 'Input value', block: 'business', width: 18 },
  { key: 'expected', header: 'Expected result', block: 'business', width: 34 },
  { key: 'screenshot', header: 'Screenshot', block: 'business', width: 26 },
  { key: 'notes', header: 'Notes', block: 'business', width: 24 },

  { key: 'xpath', header: 'Relative XPath', block: 'locator', width: 52 },
  { key: 'unique', header: 'Unique?', block: 'locator', width: 18 }
]

/** Index of the first locator column, used to freeze and group the blocks. */
export const FIRST_LOCATOR_INDEX = EXPORT_COLUMNS.findIndex((c) => c.block === 'locator')

export interface ExportRow {
  values: Record<string, string>
  /** Absolute path to the screenshot for this row, when there is one. */
  screenshotPath?: string
  /** True when the relative XPath matches more than one element. */
  ambiguous: boolean
  /** True when the input value was masked. */
  masked: boolean
}

export interface ExportDocument {
  title: string
  recording: Recording
  columns: readonly ExportColumn[]
  rows: ExportRow[]
  /** Captures not tied to a step, listed after the table so they are not lost. */
  unattached: Screenshot[]
}

function candidate(
  step: RecordedStep,
  kind: LocatorCandidate['kind']
): LocatorCandidate | undefined {
  if (!('locators' in step) || !step.locators) return undefined
  return step.locators.candidates.find((c) => c.kind === kind)
}

function uniqueCell(matches: number | null): string {
  if (matches === null) return ''
  if (matches === 1) return 'Yes'
  return `No — matches ${matches}`
}

export interface LocatorDetails {
  xpath: string
  /** How many elements the XPath matched when the step was recorded. */
  xpathMatches: number | null
}

/**
 * The locator detail for one step, in the form both the export and the app's step
 * table show it. Shared so the spreadsheet and the screen cannot disagree.
 */
export function locatorDetails(step: RecordedStep): LocatorDetails {
  const xpath = candidate(step, 'xpath')
  return { xpath: xpath?.expression ?? '', xpathMatches: xpath?.matches ?? null }
}

export function buildExportDocument(input: {
  recording: Recording
  steps: readonly StoredStep[]
  screenshots: readonly Screenshot[]
  /**
   * Folder the screenshots are copied into next to the exported file. When given, the
   * Screenshot column holds a path that leads to the image rather than a bare name —
   * which matters most in CSV, where the picture cannot be embedded at all.
   */
  screenshotDirName?: string
}): ExportDocument {
  const byStep = new Map<string, Screenshot>()
  for (const shot of input.screenshots) if (shot.stepId) byStep.set(shot.stepId, shot)

  const rows: ExportRow[] = input.steps.map((step, index) => {
    const payload = step.payload
    const shot = byStep.get(step.id)
    const details = locatorDetails(payload)
    const shotCell = shot
      ? input.screenshotDirName
        ? `${input.screenshotDirName}/${shot.fileName}`
        : shot.fileName
      : ''

    return {
      values: {
        step: String(index + 1),
        action: step.action,
        page: step.pageTitle,
        url: step.url,
        input: step.inputValue,
        expected: step.expectedResult,
        screenshot: shotCell,
        notes: step.note,

        xpath: details.xpath,
        unique: uniqueCell(details.xpathMatches)
      },
      ...(shot ? { screenshotPath: shot.filePath } : {}),
      ambiguous: details.xpathMatches !== null && details.xpathMatches > 1,
      masked: step.masked
    }
  })

  return {
    title: input.recording.name,
    recording: input.recording,
    columns: EXPORT_COLUMNS,
    rows,
    unattached: input.screenshots.filter((shot) => !shot.stepId)
  }
}
