import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/types'
import { IPC_LIBRARY } from '@shared/ipc'
import type { EnvReport } from '@shared/types'
import type {
  ExportFormat,
  ExportResultDto,
  FolderDto,
  LibraryEvent,
  RecorderStatusDto,
  RecordingDetailDto,
  RecordingDto,
  StartRecordingInput,
  StepEdit
} from '@shared/library'

/**
 * The only surface the renderer gets.
 *
 * Node stays in the main process: the renderer displays content derived from recorded
 * pages, so it is treated as untrusted. Every call here is a named channel with a
 * fixed shape rather than a general-purpose bridge.
 */
const api = {
  getEnvReport: (): Promise<EnvReport> => ipcRenderer.invoke(IPC.envReport),

  listFolders: (): Promise<FolderDto[]> => ipcRenderer.invoke(IPC_LIBRARY.listFolders),
  createFolder: (name: string, parentId: string): Promise<FolderDto> =>
    ipcRenderer.invoke(IPC_LIBRARY.createFolder, name, parentId),
  deleteFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC_LIBRARY.deleteFolder, id),

  listRecordings: (folderId?: string): Promise<RecordingDto[]> =>
    ipcRenderer.invoke(IPC_LIBRARY.listRecordings, folderId),
  getRecording: (id: string): Promise<RecordingDetailDto | undefined> =>
    ipcRenderer.invoke(IPC_LIBRARY.getRecording, id),
  renameRecording: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.renameRecording, id, name),
  moveRecording: (id: string, folderId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.moveRecording, id, folderId),
  deleteRecording: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.deleteRecording, id),

  updateStep: (id: string, changes: StepEdit): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.updateStep, id, changes),
  deleteStep: (id: string): Promise<void> => ipcRenderer.invoke(IPC_LIBRARY.deleteStep, id),
  markStepSensitive: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.markStepSensitive, id),
  moveStep: (recordingId: string, stepId: string, direction: -1 | 1): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.moveStep, recordingId, stepId, direction),
  deleteScreenshot: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.deleteScreenshot, id),

  startRecording: (input: StartRecordingInput): Promise<RecordingDto> =>
    ipcRenderer.invoke(IPC_LIBRARY.startRecording, input),
  stopRecording: (): Promise<void> => ipcRenderer.invoke(IPC_LIBRARY.stopRecording),
  setPaused: (paused: boolean): Promise<void> => ipcRenderer.invoke(IPC_LIBRARY.setPaused, paused),
  capture: (): Promise<void> => ipcRenderer.invoke(IPC_LIBRARY.capture),
  getStatus: (): Promise<RecorderStatusDto> => ipcRenderer.invoke(IPC_LIBRARY.status),

  hasProfile: (folderId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_LIBRARY.hasProfile, folderId),
  clearProfile: (folderId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_LIBRARY.clearProfile, folderId),

  exportRecording: (
    recordingId: string,
    format: ExportFormat,
    name: string
  ): Promise<ExportResultDto> =>
    ipcRenderer.invoke(IPC_LIBRARY.exportRecording, recordingId, format, name),

  /** Subscribes to live recording updates. Returns an unsubscribe function. */
  onLibraryEvent: (listener: (event: LibraryEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: LibraryEvent): void => listener(payload)
    ipcRenderer.on(IPC_LIBRARY.event, handler)
    return () => ipcRenderer.removeListener(IPC_LIBRARY.event, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
