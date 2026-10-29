import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { RecordingStore } from '../../src/storage/store.ts'
import { buildExportDocument, EXPORT_COLUMNS, FIRST_LOCATOR_INDEX } from '../../src/export/rows.ts'
import { escapeCsvValue, toCsv } from '../../src/export/csv.ts'
import { exportRecording, suggestFileName, withExtension } from '../../src/export/index.ts'
import type { RecordedStep } from '../../src/recorder/events.ts'

let dir: string
let store: RecordingStore
let recordingId: string

const png = (width = 800, height = 600): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    (() => {
      const b = Buffer.alloc(4)
      b.writeUInt32BE(13)
      return b
    })(),
    Buffer.from('IHDR', 'latin1'),
    (() => {
      const b = Buffer.alloc(8)
      b.writeUInt32BE(width, 0)
      b.writeUInt32BE(height, 4)
      return b
    })(),
    Buffer.alloc(5)
  ])

const clickStep = (seq: number, over: Record<string, unknown> = {}): RecordedStep =>
  ({
    seq,
    at: seq * 100,
    type: 'click',
    url: 'http://app/checkout',
    pageTitle: 'Checkout',
    target: {
      tag: 'button',
      label: 'Place Order',
      labelSource: 'text',
      role: 'button',
      id: 'place-order',
      name: 'submit',
      testId: 'place-order-btn'
    },
    modifiers: [],
    locators: {
      inShadowDom: false,
      classes: ['btn', 'sc-bdVaJa'],
      candidates: [
        {
          kind: 'testid',
          expression: '[data-testid="place-order-btn"]',
          playwright: 'getByTestId("place-order-btn")',
          matches: 1
        },
        {
          kind: 'xpath',
          expression: "//form[@id='checkout']//button[normalize-space()='Place Order']",
          matches: 1
        },
        { kind: 'css', expression: 'button.btn', matches: 3 }
      ]
    },
    recommended: {
      kind: 'testid',
      expression: '[data-testid="place-order-btn"]',
      playwright: 'getByTestId("place-order-btn")',
      matches: 1,
      unique: true,
      reason: 'Test id is unique and survives redesigns.'
    },
    unstableClasses: ['sc-bdVaJa'],
    ...over
  }) as unknown as RecordedStep

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tcg-export-'))
  store = new RecordingStore({
    databasePath: join(dir, 'library.db'),
    mediaDir: join(dir, 'recordings')
  })
  const recording = store.createRecording({ name: 'Checkout flow', startUrl: 'http://app/login' })
  recordingId = recording.id
})

afterEach(() => {
  try {
    store.close()
  } catch {
    // Already closed.
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('export columns', () => {
  it('puts the business block first and the locator block after it', () => {
    const business = EXPORT_COLUMNS.slice(0, FIRST_LOCATOR_INDEX)
    const locator = EXPORT_COLUMNS.slice(FIRST_LOCATOR_INDEX)
    expect(business.every((c) => c.block === 'business')).toBe(true)
    expect(locator.every((c) => c.block === 'locator')).toBe(true)
    expect(business.map((c) => c.header)).toEqual([
      'Step #',
      'Action',
      'Page',
      'URL',
      'Input value',
      'Expected result',
      'Screenshot',
      'Notes'
    ])
  })

  it('keeps only the relative XPath and its uniqueness in the locator block', () => {
    const locator = EXPORT_COLUMNS.slice(FIRST_LOCATOR_INDEX)
    expect(locator.map((c) => c.header)).toEqual(['Relative XPath', 'Unique?'])
  })

  it('does not bring back the columns retired on 2026-10-21', () => {
    const headers = EXPORT_COLUMNS.map((c) => c.header)
    for (const header of [
      'Element',
      'Recommended locator',
      'Locator type',
      'ID',
      'Name',
      'Test ID',
      'Class',
      'CSS',
      'Playwright'
    ]) {
      expect(headers, header).not.toContain(header)
    }
  })
})

describe('building the document', () => {
  it('maps a step into both blocks', () => {
    store.appendStep(recordingId, clickStep(0))
    const doc = buildExportDocument({
      recording: store.getRecording(recordingId)!,
      steps: store.listSteps(recordingId),
      screenshots: []
    })

    const row = doc.rows[0]!
    expect(row.values['step']).toBe('1')
    expect(row.values['action']).toBe('Click "Place Order"')
    expect(row.values['page']).toBe('Checkout')

    expect(row.values['xpath']).toBe(
      "//form[@id='checkout']//button[normalize-space()='Place Order']"
    )
    expect(row.values['unique']).toBe('Yes')
    expect(row.ambiguous).toBe(false)
  })

  it('spells out an ambiguous XPath rather than just saying no', () => {
    store.appendStep(
      recordingId,
      clickStep(0, {
        locators: {
          inShadowDom: false,
          classes: [],
          candidates: [
            { kind: 'xpath', expression: "//button[normalize-space()='Remove']", matches: 3 }
          ]
        }
      })
    )
    const doc = buildExportDocument({
      recording: store.getRecording(recordingId)!,
      steps: store.listSteps(recordingId),
      screenshots: []
    })
    expect(doc.rows[0]!.values['unique']).toBe('No — matches 3')
    expect(doc.rows[0]!.ambiguous).toBe(true)
  })

  it('judges uniqueness by the XPath, not by the recommended locator', () => {
    // The recommendation (a test id) is unique, but it is no longer exported; the
    // Unique? column has to describe the locator the sheet actually shows.
    store.appendStep(
      recordingId,
      clickStep(0, {
        locators: {
          inShadowDom: false,
          classes: [],
          candidates: [
            { kind: 'testid', expression: '[data-testid="x"]', matches: 1 },
            { kind: 'xpath', expression: '//button', matches: 2 }
          ]
        }
      })
    )
    const doc = buildExportDocument({
      recording: store.getRecording(recordingId)!,
      steps: store.listSteps(recordingId),
      screenshots: []
    })
    expect(doc.rows[0]!.values['unique']).toBe('No — matches 2')
  })

  it('leaves the locator cells empty for a step with no element', () => {
    store.appendStep(recordingId, clickStep(0, { locators: undefined }))
    const doc = buildExportDocument({
      recording: store.getRecording(recordingId)!,
      steps: store.listSteps(recordingId),
      screenshots: []
    })
    expect(doc.rows[0]!.values['xpath']).toBe('')
    expect(doc.rows[0]!.values['unique']).toBe('')
    expect(doc.rows[0]!.ambiguous).toBe(false)
  })

  it('numbers rows by display order, not capture order', () => {
    const a = store.appendStep(recordingId, clickStep(0))
    const b = store.appendStep(recordingId, clickStep(1))
    store.reorderSteps(recordingId, [b.id, a.id])

    const doc = buildExportDocument({
      recording: store.getRecording(recordingId)!,
      steps: store.listSteps(recordingId),
      screenshots: []
    })
    expect(doc.rows.map((r) => r.values['step'])).toEqual(['1', '2'])
    expect(doc.rows[0]!.values['action']).toBe('Click "Place Order"')
  })

  it('attaches a screenshot to its row and lists the rest separately', () => {
    const step = store.appendStep(recordingId, clickStep(0))
    store.saveScreenshot({ recordingId, stepId: step.id, data: png() })
    store.saveScreenshot({ recordingId, stepId: null, data: png() })

    const doc = buildExportDocument({
      recording: store.getRecording(recordingId)!,
      steps: store.listSteps(recordingId),
      screenshots: store.listScreenshots(recordingId)
    })
    expect(doc.rows[0]!.values['screenshot']).toBe('001.png')
    expect(doc.rows[0]!.screenshotPath).toContain('001.png')
    expect(doc.unattached).toHaveLength(1)
  })
})

describe('CSV escaping', () => {
  it('quotes values containing commas, quotes, or newlines', () => {
    expect(escapeCsvValue('plain')).toBe('plain')
    expect(escapeCsvValue('a,b')).toBe('"a,b"')
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"')
  })

  it('quotes an XPath containing a comma, which would otherwise shift every column', () => {
    const xpath = "//button[normalize-space()='Save, now']"
    expect(escapeCsvValue(xpath)).toBe(`"${xpath}"`)
  })

  it('neutralises values Excel would run as a formula', () => {
    // These come from pages we do not control, so they must not be executable.
    expect(escapeCsvValue('=1+1')).toBe("'=1+1")
    expect(escapeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCsvValue('-2')).toBe("'-2")
    expect(escapeCsvValue('+3')).toBe("'+3")
  })

  it('renders a header row and one row per step', () => {
    store.appendStep(recordingId, clickStep(0))
    store.appendStep(recordingId, clickStep(1))
    const csv = toCsv(
      buildExportDocument({
        recording: store.getRecording(recordingId)!,
        steps: store.listSteps(recordingId),
        screenshots: []
      })
    )
    const lines = csv.trimEnd().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Step #')
    expect(lines[0]).toContain('Relative XPath')
  })
})

describe('file naming', () => {
  it('corrects the extension to match the format', () => {
    expect(withExtension('/tmp/out', 'xlsx')).toBe('/tmp/out.xlsx')
    expect(withExtension('/tmp/out.csv', 'xlsx')).toBe('/tmp/out.xlsx')
    expect(withExtension('/tmp/out.xlsx', 'xlsx')).toBe('/tmp/out.xlsx')
  })

  it('suggests a name that is legal on both platforms', () => {
    expect(suggestFileName('Checkout: happy path / v2', 'xlsx')).toBe('Checkout happy path v2.xlsx')
    expect(suggestFileName('   ', 'csv')).toBe('clickpath.csv')
  })
})

describe('writing the files', () => {
  it('writes a workbook with both blocks, the locator block collapsed', async () => {
    const step = store.appendStep(recordingId, clickStep(0))
    store.appendStep(recordingId, clickStep(1))
    store.updateStep(step.id, { expectedResult: 'Order confirmation appears' })
    store.saveScreenshot({ recordingId, stepId: step.id, data: png() })

    const result = await exportRecording({
      store,
      recordingId,
      format: 'xlsx',
      filePath: join(dir, 'out.xlsx')
    })

    expect(result.stepCount).toBe(2)
    expect(statSync(result.filePath).size).toBeGreaterThan(0)

    // Read it back rather than trusting the writer.
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(result.filePath)
    const sheet = workbook.getWorksheet('Clickpath')!

    expect(sheet.getCell(1, 1).value).toBe('Checkout flow')
    expect(sheet.getCell(4, 1).value).toBe('Step #')
    expect(sheet.getCell(5, 2).value).toBe('Click "Place Order"')
    const expectedIndex = EXPORT_COLUMNS.findIndex((c) => c.key === 'expected') + 1
    expect(sheet.getCell(5, expectedIndex).value).toBe('Order confirmation appears')

    // The locator block is grouped so it can be collapsed, but it must be visible:
    // a hidden column reads as missing data.
    const xpathIndex = EXPORT_COLUMNS.findIndex((c) => c.key === 'xpath') + 1
    const uniqueIndex = EXPORT_COLUMNS.findIndex((c) => c.key === 'unique') + 1
    expect(sheet.getCell(4, xpathIndex).value).toBe('Relative XPath')
    expect(sheet.getCell(4, uniqueIndex).value).toBe('Unique?')
    expect(sheet.getColumn(xpathIndex).hidden).toBeFalsy()
    expect(sheet.getColumn(uniqueIndex).hidden).toBeFalsy()
    expect(sheet.getColumn(xpathIndex).outlineLevel).toBe(1)
    // And the values actually reached the cells.
    expect(String(sheet.getCell(5, xpathIndex).value)).toContain('//form')

    // The screenshot is embedded.
    expect(sheet.getImages()).toHaveLength(1)
  })

  it('copies the screenshots alongside the workbook', async () => {
    const step = store.appendStep(recordingId, clickStep(0))
    store.saveScreenshot({ recordingId, stepId: step.id, data: png() })

    const result = await exportRecording({
      store,
      recordingId,
      format: 'xlsx',
      filePath: join(dir, 'exports', 'checkout.xlsx')
    })

    expect(result.screenshotDir).toBeDefined()
    expect(existsSync(join(result.screenshotDir!, '001.png'))).toBe(true)
  })

  it('produces a smaller workbook when images are not embedded', async () => {
    const step = store.appendStep(recordingId, clickStep(0))
    store.saveScreenshot({ recordingId, stepId: step.id, data: png(1400, 9000) })

    const embedded = await exportRecording({
      store,
      recordingId,
      format: 'xlsx',
      filePath: join(dir, 'with.xlsx'),
      embedScreenshots: true
    })
    const referenced = await exportRecording({
      store,
      recordingId,
      format: 'xlsx',
      filePath: join(dir, 'without.xlsx'),
      embedScreenshots: false
    })

    expect(statSync(embedded.filePath).size).toBeGreaterThan(statSync(referenced.filePath).size)
  })

  it('writes CSV as UTF-8 text', async () => {
    store.appendStep(recordingId, clickStep(0))
    const result = await exportRecording({
      store,
      recordingId,
      format: 'csv',
      filePath: join(dir, 'out.csv')
    })

    const text = readFileSync(result.filePath, 'utf8')
    expect(text.split('\r\n')[0]).toContain('Step #')
    // The action contains quotes, so it arrives CSV-escaped rather than verbatim.
    expect(text).toContain('"Click ""Place Order"""')
  })

  it('exports an empty recording without failing', async () => {
    const result = await exportRecording({
      store,
      recordingId,
      format: 'xlsx',
      filePath: join(dir, 'empty.xlsx')
    })
    expect(result.stepCount).toBe(0)
    expect(statSync(result.filePath).size).toBeGreaterThan(0)
  })

  it('refuses a recording that no longer exists', async () => {
    await expect(
      exportRecording({ store, recordingId: 'gone', format: 'csv', filePath: join(dir, 'x.csv') })
    ).rejects.toThrow(/no longer exists/)
  })

  it('still exports when a screenshot file has been deleted from disk', async () => {
    const step = store.appendStep(recordingId, clickStep(0))
    const shot = store.saveScreenshot({ recordingId, stepId: step.id, data: png() })
    rmSync(shot.filePath)

    const result = await exportRecording({
      store,
      recordingId,
      format: 'xlsx',
      filePath: join(dir, 'missing-shot.xlsx')
    })
    expect(statSync(result.filePath).size).toBeGreaterThan(0)
  })
})
