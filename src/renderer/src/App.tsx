import { useCallback, useEffect, useState } from 'react'
import type { EnvReport } from '@shared/types'
import type {
  ExportFormat,
  FolderDto,
  LibraryEvent,
  RecorderStatusDto,
  RecordingDetailDto,
  RecordingDto,
  StartRecordingInput,
  StepDto
} from '@shared/library'
import Sidebar from './components/Sidebar'
import StepTable from './components/StepTable'
import ColumnPicker from './components/ColumnPicker'
import RecordingHeader from './components/RecordingHeader'
import ConfirmDialog from './components/ConfirmDialog'
import NewRecordingDialog from './components/NewRecordingDialog'
import HelpDialog from './components/HelpDialog'
import { DEFAULT_STEP_COLUMNS, normaliseColumns, type StepColumnKey } from '@shared/step-columns'
import { descendantFolderIds } from '@shared/folder-tree'

/** Remembers the reviewer's column choice between sessions. */
const COLUMNS_KEY = 'trailmark.stepColumns'

function loadColumns(): StepColumnKey[] {
  try {
    // Falls back to the key used before the app was renamed.
    const saved = localStorage.getItem(COLUMNS_KEY) ?? localStorage.getItem('tcg.stepColumns')
    if (!saved) return [...DEFAULT_STEP_COLUMNS]
    return normaliseColumns(JSON.parse(saved) as string[])
  } catch {
    // Unreadable or corrupt storage is not worth failing over.
    return [...DEFAULT_STEP_COLUMNS]
  }
}

/**
 * Spells out what deleting a folder takes with it. Nested folders and their recordings
 * go too, which is not obvious from looking at a collapsed tree.
 */
function describeFolderDeletion(folders: FolderDto[], folder: FolderDto): string {
  const doomed = descendantFolderIds(folders, folder.id)
  const nested = doomed.length - 1
  const recordings = folders
    .filter((candidate) => doomed.includes(candidate.id))
    .reduce((total, candidate) => total + candidate.recordingCount, 0)

  const parts: string[] = []
  if (recordings > 0) parts.push(`${recordings} recording${recordings === 1 ? '' : 's'}`)
  if (nested > 0) parts.push(`${nested} nested folder${nested === 1 ? '' : 's'}`)

  if (parts.length === 0) {
    return 'The folder is empty, so nothing else is affected.'
  }
  return `This also deletes ${parts.join(' and ')}, with their steps, screenshots, and saved sign-in. Anything already exported is untouched.`
}

const IDLE: RecorderStatusDto = {
  state: 'idle',
  recordingId: null,
  stepCount: 0,
  screenshotCount: 0
}

export default function App(): React.JSX.Element {
  const [folders, setFolders] = useState<FolderDto[]>([])
  const [recordings, setRecordings] = useState<RecordingDto[]>([])
  const [folderId, setFolderId] = useState('root')
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RecordingDetailDto | null>(null)
  const [status, setStatus] = useState<RecorderStatusDto>(IDLE)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<RecordingDto | null>(null)
  const [pendingFolderDelete, setPendingFolderDelete] = useState<FolderDto | null>(null)
  const [pendingMask, setPendingMask] = useState<StepDto | null>(null)
  const [env, setEnv] = useState<EnvReport | null>(null)
  const [columns, setColumns] = useState<StepColumnKey[]>(loadColumns)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  /** Every IPC call goes through here so a failure surfaces instead of vanishing. */
  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null)
      return await work()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // Electron prefixes IPC errors with the handler's stack; the last line is the
      // part a human wrote.
      setError(
        message.split('\n')[0]?.replace(/^Error invoking remote method '[^']+': /, '') ?? message
      )
      return undefined
    }
  }, [])

  const refreshFolders = useCallback(async () => {
    const next = await run(() => window.api.listFolders())
    if (next) setFolders(next)
  }, [run])

  const refreshRecordings = useCallback(
    async (id: string) => {
      const next = await run(() => window.api.listRecordings(id))
      if (next) setRecordings(next)
    },
    [run]
  )

  const refreshDetail = useCallback(
    async (id: string | null) => {
      if (!id) {
        setDetail(null)
        return
      }
      const next = await run(() => window.api.getRecording(id))
      setDetail(next ?? null)
    },
    [run]
  )

  useEffect(() => {
    void refreshFolders()
    void run(() => window.api.getStatus()).then((s) => s && setStatus(s))
    void window.api
      .getEnvReport()
      .then(setEnv)
      .catch(() => undefined)
  }, [refreshFolders, run])

  useEffect(() => {
    void refreshRecordings(folderId)
  }, [folderId, refreshRecordings])

  useEffect(() => {
    void refreshDetail(recordingId)
  }, [recordingId, refreshDetail])

  // Live updates while a recording is running.
  useEffect(() => {
    return window.api.onLibraryEvent((event: LibraryEvent) => {
      if (event.type === 'status') {
        setStatus(event.status)
        // A finished recording changes counts and status in the list.
        if (event.status.state === 'idle') {
          void refreshFolders()
          void refreshRecordings(folderId)
          void refreshDetail(recordingId)
        }
        return
      }
      // Steps, screenshots and notes all change the open recording.
      if (event.recordingId === recordingId) void refreshDetail(recordingId)
      if (event.type === 'step') void refreshRecordings(folderId)
    })
  }, [folderId, recordingId, refreshDetail, refreshFolders, refreshRecordings])

  const startRecording = async (input: StartRecordingInput): Promise<void> => {
    setBusy(true)
    const created = await run(() => window.api.startRecording(input))
    setBusy(false)
    if (!created) return
    setDialogOpen(false)
    setFolderId(created.folderId)
    setRecordingId(created.id)
    await refreshFolders()
    await refreshRecordings(created.folderId)
  }

  const chooseColumns = (next: StepColumnKey[]): void => {
    setColumns(next)
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next))
    } catch {
      // The choice still applies for this session.
    }
  }

  const renameRecording = (id: string, name: string): void => {
    void run(() => window.api.renameRecording(id, name)).then(async () => {
      await refreshRecordings(folderId)
      if (recordingId === id) await refreshDetail(id)
    })
  }

  const moveRecording = (id: string, target: string): void => {
    void run(() => window.api.moveRecording(id, target)).then(async () => {
      await refreshFolders()
      // Follow the recording to its new folder, so the list still contains it.
      if (recordingId === id) {
        setFolderId(target)
        await refreshRecordings(target)
        await refreshDetail(id)
      } else {
        await refreshRecordings(folderId)
      }
    })
  }

  const deleteRecording = (id: string): void => {
    void run(() => window.api.deleteRecording(id)).then(async () => {
      if (recordingId === id) setRecordingId(null)
      await refreshFolders()
      await refreshRecordings(folderId)
    })
  }

  const exportRecording = async (format: ExportFormat): Promise<void> => {
    if (!detail) return
    setExporting(true)
    const result = await run(() =>
      window.api.exportRecording(detail.recording.id, format, detail.recording.name)
    )
    setExporting(false)
    if (!result || result.cancelled) return
    setExported(
      `Exported ${result.stepCount} steps${
        result.screenshotCount ? ` and ${result.screenshotCount} screenshots` : ''
      } to ${result.filePath}`
    )
  }

  const live = status.state !== 'idle'
  const liveHere = live && status.recordingId === recordingId

  return (
    <div className="app">
      <header className="topbar">
        <h1>Trailmark</h1>
        <div className="topbar__end">
          {live && (
            <div className="live">
              <span className={`dot ${status.state === 'paused' ? 'dot--paused' : ''}`} />
              <span>
                {status.state === 'paused' ? 'Paused' : 'Recording'} · {status.stepCount} steps ·{' '}
                {status.screenshotCount} 📷
              </span>
              <button
                title="Screenshot the recorded page as the expected result of the step just performed"
                onClick={() => void run(() => window.api.capture())}
              >
                Capture
              </button>
              <button
                onClick={() => void run(() => window.api.setPaused(status.state !== 'paused'))}
              >
                {status.state === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button className="danger" onClick={() => void run(() => window.api.stopRecording())}>
                Stop
              </button>
            </div>
          )}
          <button
            className="help-button"
            aria-label="Help"
            title="How Trailmark works"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
        </div>
      </header>

      {exported && (
        <div className="banner banner--ok" role="status">
          {exported}
          <button className="icon" onClick={() => setExported(null)}>
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
          <button className="icon" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="layout">
        <Sidebar
          folders={folders}
          recordings={recordings}
          selectedFolderId={folderId}
          selectedRecordingId={recordingId}
          busy={live}
          liveRecordingId={status.recordingId}
          onSelectFolder={(id) => {
            setFolderId(id)
            setRecordingId(null)
          }}
          onSelectRecording={setRecordingId}
          onCreateFolder={(name, parentId) =>
            void run(() => window.api.createFolder(name, parentId)).then(() => refreshFolders())
          }
          onDeleteFolder={(id) => {
            const folder = folders.find((f) => f.id === id)
            if (folder) setPendingFolderDelete(folder)
          }}
          onNewRecording={() => setDialogOpen(true)}
          onRenameRecording={renameRecording}
          onMoveRecording={moveRecording}
          onDeleteRecording={setPendingDelete}
        />

        <main className="main">
          {!detail ? (
            <div className="placeholder">
              <h2>No recording selected</h2>
              <p className="muted">
                Pick one from the list, or start a new recording to capture a walkthrough.
              </p>
              <button className="primary" disabled={live} onClick={() => setDialogOpen(true)}>
                New recording
              </button>
              <p className="placeholder__help">
                <button className="link" onClick={() => setHelpOpen(true)}>
                  How Trailmark works
                </button>
              </p>
            </div>
          ) : (
            <>
              <div className="detail__head">
                <RecordingHeader detail={detail} folders={folders} live={liveHere} />
                <div className="detail__actions">
                  <ColumnPicker columns={columns} onChange={chooseColumns} />
                  <button
                    className="primary"
                    disabled={exporting || detail.steps.length === 0}
                    onClick={() => void exportRecording('xlsx')}
                  >
                    {exporting ? 'Exporting…' : 'Export Excel'}
                  </button>
                  <button
                    disabled={exporting || detail.steps.length === 0}
                    onClick={() => void exportRecording('csv')}
                  >
                    CSV
                  </button>
                </div>
              </div>

              <StepTable
                steps={detail.steps}
                columns={columns}
                onEdit={(stepId, changes) =>
                  void run(() => window.api.updateStep(stepId, changes)).then(() =>
                    refreshDetail(detail.recording.id)
                  )
                }
                onDelete={(stepId) =>
                  void run(() => window.api.deleteStep(stepId)).then(() =>
                    refreshDetail(detail.recording.id)
                  )
                }
                onMarkSensitive={setPendingMask}
                onMove={(stepId, direction) =>
                  void run(() => window.api.moveStep(detail.recording.id, stepId, direction)).then(
                    () => refreshDetail(detail.recording.id)
                  )
                }
                onOpenShot={setLightbox}
              />

              {detail.unattached.length > 0 && (
                <section className="unattached">
                  <h3>Captures not attached to a step</h3>
                  <div className="unattached__row">
                    {detail.unattached.map((shot) => (
                      <button key={shot.id} className="thumb" onClick={() => setLightbox(shot.src)}>
                        <img src={shot.src} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <button className="link" onClick={() => setShowDiagnostics((open) => !open)}>
          {showDiagnostics ? 'Hide' : 'Show'} diagnostics
        </button>
        {showDiagnostics && env && (
          <ul className="diag">
            {env.checks.map((check) => (
              <li key={check.id} className={`diag__item diag__item--${check.status}`}>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </footer>

      {dialogOpen && (
        <NewRecordingDialog
          folders={folders}
          defaultFolderId={folderId}
          busy={busy}
          onCancel={() => setDialogOpen(false)}
          onStart={(input) => void startRecording(input)}
          hasProfile={(id) => window.api.hasProfile(id)}
          onClearProfile={async (id) => {
            await run(() => window.api.clearProfile(id))
          }}
        />
      )}

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          body={`This removes ${pendingDelete.stepCount} step${
            pendingDelete.stepCount === 1 ? '' : 's'
          }${
            pendingDelete.screenshotCount
              ? ` and ${pendingDelete.screenshotCount} screenshot${
                  pendingDelete.screenshotCount === 1 ? '' : 's'
                }`
              : ''
          } for good. Anything already exported is untouched.`}
          confirmLabel="Delete recording"
          destructive
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteRecording(pendingDelete.id)
            setPendingDelete(null)
          }}
        />
      )}

      {pendingMask && (
        <ConfirmDialog
          title="Mark this value as sensitive?"
          body={`The value is replaced with ******** in this step, in the saved library, and in any later URL that carried it. This cannot be undone. Files already exported, and screenshots that show the value, are not changed.`}
          confirmLabel="Mark sensitive"
          destructive
          onCancel={() => setPendingMask(null)}
          onConfirm={() => {
            const step = pendingMask
            setPendingMask(null)
            void run(() => window.api.markStepSensitive(step.id)).then(() =>
              detail ? refreshDetail(detail.recording.id) : undefined
            )
          }}
        />
      )}

      {pendingFolderDelete && (
        <ConfirmDialog
          title={`Delete “${pendingFolderDelete.name}”?`}
          body={describeFolderDeletion(folders, pendingFolderDelete)}
          confirmLabel="Delete folder"
          destructive
          onCancel={() => setPendingFolderDelete(null)}
          onConfirm={() => {
            const id = pendingFolderDelete.id
            setPendingFolderDelete(null)
            void run(() => window.api.deleteFolder(id)).then(async () => {
              await refreshFolders()
              if (folderId === id) {
                setFolderId('root')
                setRecordingId(null)
              }
            })
          }}
        />
      )}

      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-label="Screenshot"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Captured expected page" />
        </div>
      )}
    </div>
  )
}
