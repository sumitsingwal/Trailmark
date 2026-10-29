import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingStore, ROOT_FOLDER_ID } from '../../src/storage/store.ts'
import { LATEST_VERSION } from '../../src/storage/schema.ts'
import { STORED_MASK } from '../../src/storage/sanitise.ts'
import type { RecordedStep } from '../../src/recorder/events.ts'

/**
 * Runs against a real SQLite file in a temp directory rather than an in-memory
 * database: migrations, foreign keys, and WAL are part of what is being tested, and
 * an in-memory database would let a file-layout mistake pass unnoticed.
 */

let dir: string
let store: RecordingStore
let violations: string[][]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tcg-store-'))
  violations = []
  store = new RecordingStore({
    databasePath: join(dir, 'library.db'),
    mediaDir: join(dir, 'recordings'),
    onViolation: (_id, found) => violations.push(found)
  })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const clickStep = (over: Partial<RecordedStep> = {}): RecordedStep =>
  ({
    seq: 0,
    at: 1200,
    type: 'click',
    url: 'http://app/login',
    pageTitle: 'Sign in',
    target: { tag: 'button', label: 'Sign In', labelSource: 'text', role: 'button' },
    modifiers: [],
    recommended: {
      kind: 'role',
      expression: 'role=button[name="Sign In"]',
      matches: 1,
      unique: true,
      reason: 'Role and accessible name are unique.'
    },
    ...over
  }) as RecordedStep

const inputStep = (value: string, masked: boolean, seq = 1): RecordedStep =>
  ({
    seq,
    at: 900,
    type: 'input',
    url: 'http://app/login',
    pageTitle: 'Sign in',
    target: { tag: 'input', type: 'password', label: 'Password', labelSource: 'label' },
    value,
    masked
  }) as RecordedStep

describe('migrations', () => {
  it('brings a fresh database to the latest version', () => {
    expect(store.version).toBe(LATEST_VERSION)
  })

  it('is idempotent when the same library is opened again', () => {
    store.close()
    const reopened = new RecordingStore({
      databasePath: join(dir, 'library.db'),
      mediaDir: join(dir, 'recordings')
    })
    expect(reopened.version).toBe(LATEST_VERSION)
    expect(reopened.listFolders()).toHaveLength(1)
    reopened.close()
    store = new RecordingStore({
      databasePath: join(dir, 'library.db'),
      mediaDir: join(dir, 'recordings')
    })
  })

  it('creates the library root exactly once', () => {
    const folders = store.listFolders()
    expect(folders).toHaveLength(1)
    expect(folders[0]).toMatchObject({ id: ROOT_FOLDER_ID, parentId: '' })
  })
})

describe('folders', () => {
  it('nests folders and lists them by parent', () => {
    const release = store.createFolder('Release 24.3')
    store.createFolder('Checkout', release.id)
    store.createFolder('Search', release.id)

    expect(store.listFolders(release.id).map((f) => f.name)).toEqual(['Checkout', 'Search'])
    expect(store.listFolders(ROOT_FOLDER_ID).map((f) => f.name)).toEqual(['Release 24.3'])
  })

  it('refuses two folders with the same name under one parent', () => {
    store.createFolder('Checkout')
    expect(() => store.createFolder('Checkout')).toThrow()
  })

  it('allows the same name under different parents', () => {
    const a = store.createFolder('Release A')
    const b = store.createFolder('Release B')
    expect(() => {
      store.createFolder('Checkout', a.id)
      store.createFolder('Checkout', b.id)
    }).not.toThrow()
  })

  it('will not delete the library root', () => {
    expect(() => store.deleteFolder(ROOT_FOLDER_ID)).toThrow(/root cannot be deleted/i)
  })

  it('cascades to the recordings inside it', () => {
    const folder = store.createFolder('Temp')
    const recording = store.createRecording({
      name: 'Flow',
      startUrl: 'http://app',
      folderId: folder.id
    })
    store.appendStep(recording.id, clickStep())

    store.deleteFolder(folder.id)
    expect(store.getRecording(recording.id)).toBeUndefined()
    expect(store.listSteps(recording.id)).toEqual([])
  })
})

describe('recordings', () => {
  it('starts in the recording state and can be completed', () => {
    const recording = store.createRecording({ name: 'Checkout', startUrl: 'http://app' })
    expect(recording.status).toBe('recording')

    store.finishRecording(recording.id)
    const after = store.getRecording(recording.id)
    expect(after?.status).toBe('completed')
    expect(after?.completedAt).toBeTruthy()
  })

  it('creates a screenshot directory per recording', () => {
    const recording = store.createRecording({ name: 'Checkout', startUrl: 'http://app' })
    expect(existsSync(store.mediaDirFor(recording.id))).toBe(true)
  })

  it('lists newest first, with step counts, even within the same millisecond', () => {
    const first = store.createRecording({ name: 'First', startUrl: 'http://app' })
    store.appendStep(first.id, clickStep())
    store.appendStep(first.id, clickStep({ seq: 1 }))
    store.createRecording({ name: 'Second', startUrl: 'http://app' })

    const listed = store.listRecordings()
    expect(listed.map((r) => r.name)).toEqual(['Second', 'First'])
    expect(listed.find((r) => r.name === 'First')?.stepCount).toBe(2)
  })

  it('removes screenshots from disk when deleted', () => {
    const recording = store.createRecording({ name: 'Checkout', startUrl: 'http://app' })
    const shots = store.mediaDirFor(recording.id)
    mkdirSync(shots, { recursive: true })
    writeFileSync(join(shots, '001.png'), 'not-really-a-png')

    store.deleteRecording(recording.id)
    expect(existsSync(shots)).toBe(false)
    expect(store.getRecording(recording.id)).toBeUndefined()
  })
})

describe('steps', () => {
  it('stores a generated action description and the ranked locator', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    const stored = store.appendStep(recording.id, clickStep())

    expect(stored.action).toBe('Click "Sign In"')
    expect(stored.elementLabel).toBe('Sign In')
    expect(stored).toMatchObject({
      recommendedKind: 'role',
      recommendedExpression: 'role=button[name="Sign In"]',
      recommendedUnique: true,
      recommendedMatches: 1
    })
  })

  it('keeps the full event payload for the locator block', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(recording.id, clickStep())
    const [step] = store.listSteps(recording.id)
    expect(step?.payload.type).toBe('click')
  })

  it('assigns positions in append order, independent of capture sequence', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(recording.id, clickStep({ seq: 5 }))
    store.appendStep(recording.id, clickStep({ seq: 9 }))

    const steps = store.listSteps(recording.id)
    expect(steps.map((s) => s.position)).toEqual([0, 1])
    expect(steps.map((s) => s.seq)).toEqual([5, 9])
  })

  it('rejects two steps claiming the same capture sequence', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(recording.id, clickStep({ seq: 0 }))
    expect(() => store.appendStep(recording.id, clickStep({ seq: 0 }))).toThrow()
  })

  it('reorders for display without touching capture order', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    const a = store.appendStep(recording.id, clickStep({ seq: 0 }))
    const b = store.appendStep(recording.id, clickStep({ seq: 1 }))

    store.reorderSteps(recording.id, [b.id, a.id])
    const steps = store.listSteps(recording.id)
    expect(steps.map((s) => s.id)).toEqual([b.id, a.id])
    expect(steps.map((s) => s.seq)).toEqual([1, 0])
  })

  it('only lets the review screen edit human-authored columns', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    const step = store.appendStep(recording.id, clickStep())

    store.updateStep(step.id, { expectedResult: 'Dashboard loads', note: 'slow' })
    const [updated] = store.listSteps(recording.id)
    expect(updated).toMatchObject({ expectedResult: 'Dashboard loads', note: 'slow' })
    // Untouched by the edit.
    expect(updated?.recommendedExpression).toBe('role=button[name="Sign In"]')
  })

  it('ignores an update with no changes', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    const step = store.appendStep(recording.id, clickStep())
    expect(() => store.updateStep(step.id, {})).not.toThrow()
  })

  it('deletes a single step without disturbing the rest', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    const a = store.appendStep(recording.id, clickStep({ seq: 0 }))
    store.appendStep(recording.id, clickStep({ seq: 1 }))

    store.deleteStep(a.id)
    expect(store.listSteps(recording.id)).toHaveLength(1)
  })
})

describe('nothing sensitive reaches the disk', () => {
  it('stores the mask, never the typed password', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(recording.id, inputStep(STORED_MASK, true))

    const [step] = store.listSteps(recording.id)
    expect(step?.inputValue).toBe(STORED_MASK)
    expect(step?.masked).toBe(true)
  })

  it('scrubs a masked step that somehow arrives holding plaintext', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    // Simulates a future import path or a recorder bug bypassing in-page masking.
    store.appendStep(recording.id, inputStep('hunter2-plaintext', true))

    const [step] = store.listSteps(recording.id)
    expect(step?.inputValue).toBe(STORED_MASK)
    expect(JSON.stringify(step?.payload)).not.toContain('hunter2-plaintext')
    expect(violations.flat()).toContain('masked field carried a plaintext value')
  })

  it('redacts sensitive URL parameters again at the storage boundary', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(
      recording.id,
      clickStep({ url: 'http://app/next?user=bob&password=hunter2' } as Partial<RecordedStep>)
    )

    const [step] = store.listSteps(recording.id)
    expect(step?.url).toContain('user=bob')
    expect(step?.url).not.toContain('hunter2')
    expect(violations.flat()).toContain('url contained sensitive parameters')
  })

  it('leaves no plaintext anywhere in the database file itself', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(recording.id, inputStep('hunter2-plaintext', true))
    store.appendStep(
      recording.id,
      clickStep({ seq: 2, url: 'http://app/n?token=abcdef123456' } as Partial<RecordedStep>)
    )
    // Force WAL content into the main database file before inspecting it.
    store.close()

    const bytes = readFileSync(join(dir, 'library.db')).toString('binary')
    expect(bytes).not.toContain('hunter2-plaintext')
    expect(bytes).not.toContain('abcdef123456')

    store = new RecordingStore({
      databasePath: join(dir, 'library.db'),
      mediaDir: join(dir, 'recordings')
    })
  })

  it('keeps an ordinary value readable', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(recording.id, inputStep('user1', false))
    const [step] = store.listSteps(recording.id)
    expect(step?.inputValue).toBe('user1')
    expect(violations).toEqual([])
  })
})

describe('marking a value sensitive after the fact', () => {
  const SECRET = 'CUST-998877'

  /** A field whose name matches no masking rule, submitted by a GET form. */
  const record = (): { recordingId: string; stepId: string } => {
    const recording = store.createRecording({ name: 'Lookup', startUrl: 'http://app' })
    store.appendStep(recording.id, {
      seq: 0,
      at: 100,
      type: 'input',
      url: 'http://app/search',
      pageTitle: 'Search',
      target: {
        tag: 'input',
        type: 'text',
        name: 'customerRef',
        label: 'Customer',
        labelSource: 'label'
      },
      value: SECRET,
      masked: false
    } as RecordedStep)
    store.appendStep(recording.id, {
      seq: 1,
      at: 200,
      type: 'navigate',
      kind: 'load',
      url: `http://app/results?customerRef=${SECRET}&page=2`,
      pageTitle: ''
    } as RecordedStep)
    const [input] = store.listSteps(recording.id)
    store.updateStep(input!.id, { note: `Used ${SECRET} from the test pack` })
    return { recordingId: recording.id, stepId: input!.id }
  }

  it('replaces the value in the step, its event, and its text', () => {
    const { recordingId, stepId } = record()
    expect(store.getStep(stepId)?.action).toContain(SECRET)

    store.markStepSensitive(stepId)

    const step = store.getStep(stepId)
    expect(step?.masked).toBe(true)
    expect(step?.inputValue).toBe(STORED_MASK)
    expect(step?.action).toBe(`Enter "${STORED_MASK}" in Customer`)
    expect(step?.note).toBe(`Used ${STORED_MASK} from the test pack`)
    expect(JSON.stringify(store.listSteps(recordingId))).not.toContain(SECRET)
  })

  it('redacts the same parameter from later URLs, leaving the rest of the URL alone', () => {
    const { recordingId, stepId } = record()
    store.markStepSensitive(stepId)

    const navigation = store.listSteps(recordingId)[1]
    expect(navigation?.url).toContain('page=2')
    expect(navigation?.url).not.toContain(SECRET)
    // Untitled navigations describe themselves by URL, so the action changes too.
    expect(navigation?.action).not.toContain(SECRET)
    expect(JSON.stringify(navigation?.payload)).not.toContain(SECRET)
  })

  it('leaves no plaintext in the database file or its WAL, while the library is still open', () => {
    const { stepId } = record()
    store.markStepSensitive(stepId)

    for (const file of ['library.db', 'library.db-wal', 'library.db-shm']) {
      const path = join(dir, file)
      if (!existsSync(path)) continue
      expect(readFileSync(path).toString('binary'), file).not.toContain(SECRET)
    }
  })

  it('masks a dropdown choice, including its visible label', () => {
    const recording = store.createRecording({ name: 'Plan', startUrl: 'http://app' })
    store.appendStep(recording.id, {
      seq: 0,
      at: 100,
      type: 'select',
      url: 'http://app/plan',
      pageTitle: 'Plan',
      target: { tag: 'select', label: 'Account', labelSource: 'label' },
      value: 'acct-1234',
      optionLabel: 'Savings 1234'
    } as RecordedStep)
    const [step] = store.listSteps(recording.id)
    store.markStepSensitive(step!.id)

    const after = store.getStep(step!.id)
    expect(after?.masked).toBe(true)
    expect(after?.action).toBe(`Select "${STORED_MASK}" in Account`)
    expect(JSON.stringify(after)).not.toMatch(/acct-1234|Savings 1234/)
  })

  it('refuses a step that has no entered value', () => {
    const recording = store.createRecording({ name: 'Login', startUrl: 'http://app' })
    store.appendStep(recording.id, clickStep())
    const [step] = store.listSteps(recording.id)
    expect(() => store.markStepSensitive(step!.id)).toThrow(/entered value/)
  })
})
