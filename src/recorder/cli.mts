/**
 * Console harness for the recorder.
 *
 * Opens a recorder browser with its control bar, prints each step as it arrives, and
 * writes everything into a real library so the storage path is exercised too. The app
 * UI lands in Phase 5; until then this is how a recording is made end to end.
 *
 *   npm run record                      # fixture site, throwaway library
 *   npm run record -- <url>             # any URL
 *   npm run record -- <url> --library <dir>
 *
 * Stop with the control bar's Stop button, by closing the window, or with Ctrl-C.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingSession } from './driver.ts'
import { formatLocatorLine, formatStepLine } from './format.ts'
import { RecordingStore } from '../storage/store.ts'
import { startFixtureServer, type FixtureServer } from '../../tests/fixtures/server.ts'

function parseArgs(argv: string[]): { url?: string; library?: string } {
  const out: { url?: string; library?: string } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--library') {
      const value = argv[i + 1]
      if (value) out.library = value
      i += 1
    } else if (arg && !arg.startsWith('--') && !out.url) {
      out.url = arg
    }
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  let fixture: FixtureServer | undefined
  let startUrl = args.url
  if (!startUrl) {
    fixture = await startFixtureServer()
    startUrl = fixture.url
    console.log(`No URL given — serving the fixture site at ${startUrl}`)
  }

  const libraryDir = args.library ?? mkdtempSync(join(tmpdir(), 'tcg-library-'))
  const store = new RecordingStore({
    databasePath: join(libraryDir, 'library.db'),
    mediaDir: join(libraryDir, 'recordings'),
    onViolation: (_id, violations) =>
      console.warn(`  ! sanitised before writing: ${violations.join('; ')}`)
  })

  const recording = store.createRecording({
    name: `Harness ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    startUrl
  })

  console.log(`Library: ${libraryDir}`)
  console.log('Recording. Use the bar in the browser: Capture, Note, Pause, Stop.\n')

  const session = await RecordingSession.start({
    startUrl,
    headless: false,
    onStep: (step) => {
      store.appendStep(recording.id, step)
      console.log(formatStepLine(step))
      const locator = formatLocatorLine(step)
      if (locator) console.log(locator)
    },
    onScreenshot: (shot) => {
      const target =
        shot.afterSeq === null ? undefined : store.findStepBySeq(recording.id, shot.afterSeq)
      const saved = store.saveScreenshot({
        recordingId: recording.id,
        stepId: target?.id ?? null,
        data: shot.data
      })
      console.log(
        `          📷 ${saved.fileName} (${saved.width}×${saved.height}) → ${target?.action ?? 'unattached'}`
      )
    },
    onNote: (note) => {
      const target =
        note.afterSeq === null ? undefined : store.findStepBySeq(recording.id, note.afterSeq)
      if (target) store.updateStep(target.id, { note: note.text })
      console.log(`          📝 ${note.text}`)
    },
    onPauseChanged: (paused) => console.log(paused ? '\n— paused —\n' : '\n— resumed —\n'),
    onRejected: (reason) => console.warn(`  ! rejected: ${reason.split('\n')[0]}`),
    onStopRequested: () => void stop()
  })

  let stopping = false
  async function stop(): Promise<void> {
    if (stopping) return
    stopping = true
    await session.stop()
    store.finishRecording(recording.id)

    const steps = store.listSteps(recording.id)
    const shots = store.listScreenshots(recording.id)
    console.log(`\nRecorded ${steps.length} steps and ${shots.length} screenshots.`)
    console.log(`Library: ${join(libraryDir, 'library.db')}`)
    store.close()
    await fixture?.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void stop())
  session.page.on('close', () => void stop())
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
