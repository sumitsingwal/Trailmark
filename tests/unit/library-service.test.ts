import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LibraryService,
  normaliseUrl,
  type SessionFactory
} from '../../src/main/library-service.ts'
import { RecordingStore } from '../../src/storage/store.ts'
import type { RecordingSessionOptions } from '../../src/recorder/driver.ts'
import type { LibraryEvent } from '../../src/shared/library.ts'
import type { RecordedStep } from '../../src/recorder/events.ts'

/**
 * Covers the app's behaviour — including live recording — against a real database and
 * a stub session, so none of it depends on launching Electron or a browser.
 */

let dir: string
let store: RecordingStore
let service: LibraryService
let events: LibraryEvent[]
let session: StubSession

/** Stands in for a RecordingSession, exposing the callbacks the driver would fire. */
class StubSession {
  paused = false
  stopped = false
  captures = 0
  readonly options: RecordingSessionOptions
  readonly page = {
    on: vi.fn(),
    url: () => 'http://app/',
    title: async () => 'App'
  }

  constructor(options: RecordingSessionOptions) {
    this.options = options
  }

  get isPaused(): boolean {
    return this.paused
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused
  }

  async capture(): Promise<void> {
    this.captures += 1
  }

  async stop(): Promise<void> {
    this.stopped = true
  }
}

const png = (): Buffer =>
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
      b.writeUInt32BE(800, 0)
      b.writeUInt32BE(600, 4)
      return b
    })(),
    Buffer.alloc(5)
  ])

const step = (seq: number, over: Partial<RecordedStep> = {}): RecordedStep =>
  ({
    seq,
    at: seq * 100,
    type: 'click',
    url: 'http://app/',
    pageTitle: 'App',
    target: { tag: 'button', label: `Button ${seq}`, labelSource: 'text', role: 'button' },
    modifiers: [],
    ...over
  }) as RecordedStep

let failNextSession = false

const factory: SessionFactory = async (options) => {
  if (failNextSession) {
    failNextSession = false
    throw new Error('Chromium refused to start')
  }
  session = new StubSession(options)
  return session as unknown as Awaited<ReturnType<SessionFactory>>
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tcg-svc-'))
  store = new RecordingStore({
    databasePath: join(dir, 'library.db'),
    mediaDir: join(dir, 'recordings')
  })
  events = []
  service = new LibraryService({
    store,
    createSession: factory,
    profilesDir: join(dir, 'profiles'),
    mediaUrl: (shot) => `trailmark-media://shot/${shot.recordingId}/${shot.fileName}`,
    emit: (event) => events.push(event)
  })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('normaliseUrl', () => {
  it('keeps an explicit scheme', () => {
    expect(normaliseUrl('http://app.internal/login')).toBe('http://app.internal/login')
  })

  it('assumes https for a bare host, which is what people paste', () => {
    expect(normaliseUrl('app.internal/login')).toBe('https://app.internal/login')
  })

  it('rejects an empty or nonsense value with a readable message', () => {
    expect(() => normaliseUrl('   ')).toThrow(/needs a start URL/)
    expect(() => normaliseUrl('http://')).toThrow(/does not look like a URL/)
  })

  it('refuses schemes the recorder cannot drive, by name', () => {
    expect(() => normaliseUrl('javascript:alert(1)')).toThrow(/Cannot record javascript:/)
    expect(() => normaliseUrl('ftp://files.internal')).toThrow(/Cannot record ftp:/)
    expect(() => normaliseUrl('data:text/html,<h1>x</h1>')).toThrow(/Cannot record data:/)
  })

  it('treats host:port as a host, not a scheme', () => {
    // Testers routinely point this at a local dev server.
    expect(normaliseUrl('localhost:3000/checkout')).toBe('https://localhost:3000/checkout')
    expect(normaliseUrl('http://localhost:8080')).toBe('http://localhost:8080/')
  })

  it('allows a local file, for a saved page', () => {
    expect(normaliseUrl('file:///tmp/page.html')).toBe('file:///tmp/page.html')
  })
})

describe('saved sign-in profiles', () => {
  it('passes the folder profile to the session so a sign-in carries over', async () => {
    const folder = service.createFolder('Release 24.3', 'root')
    await service.startRecording({ name: 'A', startUrl: 'http://app', folderId: folder.id })
    expect(session.options.profileDir).toBe(service.profileDirFor(folder.id))
  })

  it('gives separate folders separate profiles', () => {
    const a = service.createFolder('A', 'root')
    const b = service.createFolder('B', 'root')
    expect(service.profileDirFor(a.id)).not.toBe(service.profileDirFor(b.id))
  })

  it('can be opted out of for a one-off clean browser', async () => {
    await service.startRecording({
      name: 'Clean',
      startUrl: 'http://app',
      folderId: 'root',
      reuseProfile: false
    })
    expect(session.options.profileDir).toBeUndefined()
  })

  it('reports and forgets a saved sign-in', () => {
    const folder = service.createFolder('Release', 'root')
    expect(service.hasProfile(folder.id)).toBe(false)

    mkdirSync(service.profileDirFor(folder.id), { recursive: true })
    expect(service.hasProfile(folder.id)).toBe(true)

    service.clearProfile(folder.id)
    expect(service.hasProfile(folder.id)).toBe(false)
    expect(existsSync(service.profileDirFor(folder.id))).toBe(false)
  })

  it('refuses to clear the profile a live recording is using', async () => {
    const folder = service.createFolder('Live', 'root')
    await service.startRecording({ name: 'In folder', startUrl: 'http://app', folderId: folder.id })
    expect(() => service.clearProfile(folder.id)).toThrow(/Stop the current recording/)
  })
})

describe('folders', () => {
  it('reports how many recordings each folder holds', () => {
    const folder = service.createFolder('Release 24.3', 'root')
    store.createRecording({ name: 'A', startUrl: 'http://app', folderId: folder.id })

    const listed = service.listFolders().find((f) => f.id === folder.id)
    expect(listed?.recordingCount).toBe(1)
  })

  it('deletes nested folders too, instead of leaving them to resurface at the top', () => {
    const parent = service.createFolder('Release 24.3', 'root')
    const child = service.createFolder('Checkout', parent.id)
    const grandchild = service.createFolder('Payment', child.id)

    service.deleteFolder(parent.id)

    const remaining = service.listFolders().map((f) => f.id)
    expect(remaining).not.toContain(parent.id)
    expect(remaining).not.toContain(child.id)
    expect(remaining).not.toContain(grandchild.id)
  })

  it('takes the recordings in nested folders with it, screenshots and all', () => {
    const parent = service.createFolder('Release', 'root')
    const child = service.createFolder('Checkout', parent.id)
    const recording = store.createRecording({
      name: 'Nested',
      startUrl: 'http://app',
      folderId: child.id
    })
    const stored = store.appendStep(recording.id, step(0))
    const shot = store.saveScreenshot({ recordingId: recording.id, stepId: stored.id, data: png() })
    expect(existsSync(shot.filePath)).toBe(true)

    service.deleteFolder(parent.id)

    expect(service.listRecordings()).toHaveLength(0)
    // The image file went too, rather than being orphaned on disk.
    expect(existsSync(shot.filePath)).toBe(false)
  })

  it('removes the saved sign-in, so session tokens do not outlive the folder', () => {
    const folder = service.createFolder('Release', 'root')
    const child = service.createFolder('Nested', folder.id)
    mkdirSync(service.profileDirFor(folder.id), { recursive: true })
    mkdirSync(service.profileDirFor(child.id), { recursive: true })

    service.deleteFolder(folder.id)

    expect(existsSync(service.profileDirFor(folder.id))).toBe(false)
    expect(existsSync(service.profileDirFor(child.id))).toBe(false)
  })

  it('refuses when a live recording is in a nested folder, not just the folder itself', async () => {
    const parent = service.createFolder('Release', 'root')
    const child = service.createFolder('Checkout', parent.id)
    await service.startRecording({ name: 'Live', startUrl: 'http://app', folderId: child.id })

    expect(() => service.deleteFolder(parent.id)).toThrow(/Stop the current recording/)
  })

  it('counts what a deletion would take, for the confirmation', () => {
    const parent = service.createFolder('Release', 'root')
    const child = service.createFolder('Checkout', parent.id)
    store.createRecording({ name: 'A', startUrl: 'http://app', folderId: parent.id })
    store.createRecording({ name: 'B', startUrl: 'http://app', folderId: child.id })

    expect(service.folderDeletionSummary(parent.id)).toEqual({ folders: 1, recordings: 2 })
  })

  it('reports nothing at risk for an empty folder', () => {
    const folder = service.createFolder('Empty', 'root')
    expect(service.folderDeletionSummary(folder.id)).toEqual({ folders: 0, recordings: 0 })
  })

  it('will not create a folder with a blank name', () => {
    expect(() => service.createFolder('   ', 'root')).toThrow(/needs a name/)
  })

  it('trims the name it is given', () => {
    expect(service.createFolder('  Checkout  ', 'root').name).toBe('Checkout')
  })
})

describe('starting a recording', () => {
  it('opens a session and reports the live status', async () => {
    const recording = await service.startRecording({
      name: 'Login',
      startUrl: 'app.internal/login',
      folderId: 'root'
    })

    expect(recording.status).toBe('recording')
    expect(session.options.startUrl).toBe('https://app.internal/login')
    expect(service.status).toMatchObject({ state: 'recording', recordingId: recording.id })
    expect(events.some((e) => e.type === 'status')).toBe(true)
  })

  it('refuses a second recording while one is running', async () => {
    await service.startRecording({ name: 'A', startUrl: 'http://app', folderId: 'root' })
    await expect(
      service.startRecording({ name: 'B', startUrl: 'http://app', folderId: 'root' })
    ).rejects.toThrow(/already in progress/)
  })

  it('leaves no empty recording behind when the browser fails to open', async () => {
    failNextSession = true
    await expect(
      service.startRecording({ name: 'Doomed', startUrl: 'http://app', folderId: 'root' })
    ).rejects.toThrow(/refused to start/)

    expect(service.listRecordings()).toHaveLength(0)
    expect(service.status.state).toBe('idle')
  })

  it('validates the name and URL before creating anything', async () => {
    await expect(
      service.startRecording({ name: '  ', startUrl: 'http://app', folderId: 'root' })
    ).rejects.toThrow(/needs a name/)
    expect(service.listRecordings()).toHaveLength(0)
  })
})

describe('during a recording', () => {
  beforeEach(async () => {
    await service.startRecording({ name: 'Login', startUrl: 'http://app', folderId: 'root' })
    events.length = 0
  })

  it('refuses to mark a value sensitive until the recording stops', async () => {
    session.options.onStep(
      step(0, {
        type: 'input',
        target: { tag: 'input', name: 'ref', label: 'Ref', labelSource: 'label' },
        value: 'C-1',
        masked: false
      } as Partial<RecordedStep>)
    )
    const recordingId = service.status.recordingId!
    const [input] = service.getRecording(recordingId)!.steps
    expect(() => service.markStepSensitive(input!.id)).toThrow(/Stop the recording/)

    await service.stopRecording()
    service.markStepSensitive(input!.id)
    expect(service.getRecording(recordingId)?.steps[0]?.masked).toBe(true)
  })

  it('persists each step and announces it', () => {
    session.options.onStep(step(0))
    session.options.onStep(step(1))

    const stepEvents = events.filter((e) => e.type === 'step')
    expect(stepEvents).toHaveLength(2)
    expect(service.status.stepCount).toBe(2)

    const detail = service.getRecording(service.status.recordingId!)
    expect(detail?.steps.map((s) => s.action)).toEqual(['Click "Button 0"', 'Click "Button 1"'])
  })

  it('attaches a capture to the step it followed', async () => {
    session.options.onStep(step(0))
    session.options.onStep(step(1))
    await session.options.onScreenshot?.({
      data: png(),
      atMs: 500,
      afterSeq: 1,
      url: 'http://app/',
      pageTitle: 'App'
    })

    const detail = service.getRecording(service.status.recordingId!)
    expect(detail?.steps[0]?.screenshot).toBeNull()
    expect(detail?.steps[1]?.screenshot).toMatchObject({ width: 800, height: 600 })
    expect(detail?.steps[1]?.screenshot?.src).toContain('trailmark-media://')
  })

  it('keeps a capture taken before any step, rather than dropping it', async () => {
    await session.options.onScreenshot?.({
      data: png(),
      atMs: 10,
      afterSeq: null,
      url: 'http://app/',
      pageTitle: 'App'
    })

    const detail = service.getRecording(service.status.recordingId!)
    expect(detail?.unattached).toHaveLength(1)
  })

  it('files a note against the step it followed', () => {
    session.options.onStep(step(0))
    session.options.onNote?.({ text: 'slow to load', afterSeq: 0 })

    const detail = service.getRecording(service.status.recordingId!)
    expect(detail?.steps[0]?.note).toBe('slow to load')
    expect(events.some((e) => e.type === 'note')).toBe(true)
  })

  it('reports paused state', async () => {
    await service.setPaused(true)
    expect(service.status.state).toBe('paused')
    await service.setPaused(false)
    expect(service.status.state).toBe('recording')
  })

  it('marks the recording completed on stop', async () => {
    session.options.onStep(step(0))
    await service.stopRecording()

    expect(session.stopped).toBe(true)
    expect(service.status.state).toBe('idle')
    expect(service.listRecordings()[0]?.status).toBe('completed')
  })

  it('ignores a second stop', async () => {
    await service.stopRecording()
    await expect(service.stopRecording()).resolves.toBeUndefined()
  })

  it('will not delete the recording that is being made', async () => {
    const id = service.status.recordingId!
    expect(() => service.deleteRecording(id)).toThrow(/Stop the current recording/)
  })

  it('will not delete the folder the live recording is in', async () => {
    const folder = service.createFolder('Live', 'root')
    await service.stopRecording()
    await service.startRecording({ name: 'In folder', startUrl: 'http://app', folderId: folder.id })
    expect(() => service.deleteFolder(folder.id)).toThrow(/Stop the current recording/)
  })
})

describe('reviewing a recording', () => {
  let id: string

  beforeEach(async () => {
    await service.startRecording({ name: 'Login', startUrl: 'http://app', folderId: 'root' })
    id = service.status.recordingId!
    session.options.onStep(step(0))
    session.options.onStep(step(1))
    session.options.onStep(step(2))
    await service.stopRecording()
  })

  it('edits the action wording and the expected result', () => {
    const detail = service.getRecording(id)!
    service.updateStep(detail.steps[0]!.id, {
      action: 'Click the green Submit button',
      expectedResult: 'Order confirmation appears'
    })

    const after = service.getRecording(id)!
    expect(after.steps[0]).toMatchObject({
      action: 'Click the green Submit button',
      expectedResult: 'Order confirmation appears'
    })
  })

  it('moves a step down without disturbing capture order', () => {
    const before = service.getRecording(id)!.steps
    service.moveStep(id, before[0]!.id, 1)

    const after = service.getRecording(id)!.steps
    expect(after.map((s) => s.id)).toEqual([before[1]!.id, before[0]!.id, before[2]!.id])
    expect(after.map((s) => s.seq).sort()).toEqual([0, 1, 2])
  })

  it('does nothing when asked to move past either end', () => {
    const steps = service.getRecording(id)!.steps
    service.moveStep(id, steps[0]!.id, -1)
    service.moveStep(id, steps[2]!.id, 1)
    expect(service.getRecording(id)!.steps.map((s) => s.id)).toEqual(steps.map((s) => s.id))
  })

  it('deletes a step', () => {
    const steps = service.getRecording(id)!.steps
    service.deleteStep(steps[1]!.id)
    expect(service.getRecording(id)!.steps).toHaveLength(2)
  })

  it('renames a recording, trimming what it is given', () => {
    service.renameRecording(id, '  Checkout — happy path  ')
    expect(service.getRecording(id)?.recording.name).toBe('Checkout — happy path')
  })

  it('refuses a blank name rather than leaving a recording unnamed', () => {
    expect(() => service.renameRecording(id, '   ')).toThrow(/needs a name/)
    expect(service.getRecording(id)?.recording.name).toBe('Login')
  })

  it('moves a recording between folders', () => {
    const target = service.createFolder('Release 24.4', 'root')
    service.moveRecording(id, target.id)

    expect(service.getRecording(id)?.recording.folderId).toBe(target.id)
    expect(service.listRecordings(target.id).map((r) => r.id)).toEqual([id])
    expect(service.listRecordings('root')).toHaveLength(0)
    // Folder counts follow it.
    expect(service.listFolders().find((f) => f.id === target.id)?.recordingCount).toBe(1)
  })

  it('keeps the steps and screenshots when a recording is moved', () => {
    const before = service.getRecording(id)!.steps.length
    const target = service.createFolder('Elsewhere', 'root')
    service.moveRecording(id, target.id)
    expect(service.getRecording(id)?.steps).toHaveLength(before)
  })

  it('returns nothing for a recording that does not exist', () => {
    expect(service.getRecording('missing')).toBeUndefined()
  })

  it('deletes the whole recording once it is no longer live', () => {
    service.deleteRecording(id)
    expect(service.listRecordings()).toHaveLength(0)
  })
})
