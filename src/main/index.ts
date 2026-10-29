import { join } from 'node:path'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { formatReport } from '@shared/env-report'
import { buildEnvReport } from './env-check.ts'
import { libraryPaths } from './library.ts'
import { LibraryService } from './library-service.ts'
import { broadcast, registerLibraryIpc } from './ipc.ts'
import { mediaUrlFor, registerMediaScheme, serveMedia } from './media-protocol.ts'
import { locateChromium } from './chromium.ts'
import { migrateLegacyAppData } from './migrate-app-data.ts'
import { RecordingStore } from '../storage/store.ts'
import { RecordingSession } from '../recorder/driver.ts'

const isDev = !app.isPackaged

/**
 * `--smoke` runs the environment checks, prints them, and exits without opening a
 * window. This is the CI-able form of the Phase 0 panel: it proves the packaged
 * app can load its native module and find Chromium without a human looking at it.
 */
const isSmokeRun = process.argv.includes('--smoke')

// Set before anything reads app.getPath('userData'), so dev and packaged runs agree
// on where recordings live instead of dev scattering them under "Electron".
app.setName('Trailmark')

// Custom schemes must be declared before the app is ready.
if (!isSmokeRun) registerMediaScheme()

let store: RecordingStore | null = null
let service: LibraryService | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Trailmark',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#12141a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Avoid the white flash before the renderer has painted.
  window.on('ready-to-show', () => window.show())

  // Anything the app itself links out to opens in the user's real browser,
  // never inside an app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * Carries data across from a previous product name.
 *
 * Runs before anything reads the library — including the environment check, which
 * opens it and would otherwise create an empty one at the new path and block the real
 * one from moving.
 */
function runMigrations(): void {
  for (const result of migrateLegacyAppData()) {
    if (result.problem) {
      console.warn(`[migration] could not move ${result.from}: ${result.problem}`)
    } else {
      console.log(`[migration] moved ${result.moved.join(', ')} from ${result.from}`)
    }
  }
}

function startLibrary(): LibraryService {
  const paths = libraryPaths()
  store = new RecordingStore({
    databasePath: paths.databasePath,
    mediaDir: paths.mediaDir,
    onViolation: (recordingId, violations) => {
      // Always a bug worth seeing: the earlier layers should have caught it.
      console.warn(`[library] sanitised ${recordingId}: ${violations.join('; ')}`)
    }
  })

  serveMedia(paths.mediaDir)

  const chromium = locateChromium()
  console.log(`[recorder] Chromium: ${chromium.source} — ${chromium.detail}`)

  return new LibraryService({
    store,
    createSession: (options) => RecordingSession.start(options),
    profilesDir: paths.profilesDir,
    ...(chromium.executablePath ? { chromiumExecutable: chromium.executablePath } : {}),
    mediaUrl: mediaUrlFor,
    emit: (event) => broadcast(() => BrowserWindow.getAllWindows(), event)
  })
}

function registerIpc(): void {
  ipcMain.handle(IPC.envReport, () => buildEnvReport())
}

// A second instance would fight over the app data directory and, later, over
// recorder browser profiles. Keep it to one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  void app.whenReady().then(() => {
    runMigrations()

    if (isSmokeRun) {
      const report = buildEnvReport()
      process.stdout.write(`${formatReport(report)}\n`)
      app.exit(report.ok ? 0 : 1)
      return
    }

    registerIpc()
    service = startLibrary()
    registerLibraryIpc(service)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // A recorder browser outliving the app would keep a Chromium process around with
  // nothing driving it.
  app.on('before-quit', () => {
    void service?.stopRecording()
    store?.close()
  })
}
