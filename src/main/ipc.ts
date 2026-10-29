import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC_LIBRARY } from '@shared/ipc'
import type {
  ExportFormat,
  ExportResultDto,
  LibraryEvent,
  StartRecordingInput,
  StepEdit
} from '@shared/library'
import type { LibraryService } from './library-service.ts'
import { suggestFileName } from '../export/index.ts'

/**
 * Thin adapters over LibraryService.
 *
 * Nothing but argument unwrapping happens here, so the behaviour stays in the service
 * where it is tested without an Electron window.
 */

export function registerLibraryIpc(service: LibraryService): void {
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (_event, ...args) => fn(...(args as never[])))
  }

  handle(IPC_LIBRARY.listFolders, () => service.listFolders())
  handle(IPC_LIBRARY.createFolder, (name: string, parentId: string) =>
    service.createFolder(name, parentId)
  )
  handle(IPC_LIBRARY.deleteFolder, (id: string) => service.deleteFolder(id))

  handle(IPC_LIBRARY.listRecordings, (folderId?: string) => service.listRecordings(folderId))
  handle(IPC_LIBRARY.getRecording, (id: string) => service.getRecording(id))
  handle(IPC_LIBRARY.renameRecording, (id: string, name: string) =>
    service.renameRecording(id, name)
  )
  handle(IPC_LIBRARY.moveRecording, (id: string, folderId: string) =>
    service.moveRecording(id, folderId)
  )
  handle(IPC_LIBRARY.deleteRecording, (id: string) => service.deleteRecording(id))

  handle(IPC_LIBRARY.updateStep, (id: string, changes: StepEdit) => service.updateStep(id, changes))
  handle(IPC_LIBRARY.deleteStep, (id: string) => service.deleteStep(id))
  handle(IPC_LIBRARY.markStepSensitive, (id: string) => service.markStepSensitive(id))
  handle(IPC_LIBRARY.moveStep, (recordingId: string, stepId: string, direction: -1 | 1) =>
    service.moveStep(recordingId, stepId, direction)
  )
  handle(IPC_LIBRARY.deleteScreenshot, (id: string) => service.deleteScreenshot(id))

  handle(IPC_LIBRARY.startRecording, (input: StartRecordingInput) => service.startRecording(input))
  handle(IPC_LIBRARY.stopRecording, () => service.stopRecording())
  handle(IPC_LIBRARY.setPaused, (paused: boolean) => service.setPaused(paused))
  handle(IPC_LIBRARY.capture, () => service.capture())
  handle(IPC_LIBRARY.status, () => service.status)
  handle(IPC_LIBRARY.hasProfile, (folderId: string) => service.hasProfile(folderId))
  handle(IPC_LIBRARY.clearProfile, (folderId: string) => service.clearProfile(folderId))

  /**
   * Export asks for a destination with the OS save dialog rather than writing
   * somewhere chosen for the user, then reveals the file so they can pick it up.
   */
  handle(
    IPC_LIBRARY.exportRecording,
    async (recordingId: string, format: ExportFormat, name: string): Promise<ExportResultDto> => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export clickpath',
        defaultPath: suggestFileName(name, format),
        filters: [
          format === 'xlsx'
            ? { name: 'Excel workbook', extensions: ['xlsx'] }
            : { name: 'CSV', extensions: ['csv'] }
        ]
      })
      if (canceled || !filePath) return { cancelled: true }

      const result = await service.exportRecording({ recordingId, format, filePath })
      // Shows the file in Finder/Explorer without opening it in Excel uninvited.
      shell.showItemInFolder(result.filePath)
      return { ...result, cancelled: false }
    }
  )
}

/** Broadcasts a live-recording event to every open window. */
export function broadcast(getWindows: () => BrowserWindow[], event: LibraryEvent): void {
  for (const window of getWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_LIBRARY.event, event)
  }
}
