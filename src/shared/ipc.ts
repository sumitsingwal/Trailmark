/** IPC channel names, shared so main and preload cannot drift apart. */
export const IPC_LIBRARY = {
  listFolders: 'library:listFolders',
  createFolder: 'library:createFolder',
  deleteFolder: 'library:deleteFolder',
  listRecordings: 'library:listRecordings',
  getRecording: 'library:getRecording',
  renameRecording: 'library:renameRecording',
  moveRecording: 'library:moveRecording',
  deleteRecording: 'library:deleteRecording',
  updateStep: 'library:updateStep',
  deleteStep: 'library:deleteStep',
  markStepSensitive: 'library:markStepSensitive',
  moveStep: 'library:moveStep',
  deleteScreenshot: 'library:deleteScreenshot',
  startRecording: 'library:startRecording',
  stopRecording: 'library:stopRecording',
  setPaused: 'library:setPaused',
  capture: 'library:capture',
  status: 'library:status',
  exportRecording: 'library:exportRecording',
  hasProfile: 'library:hasProfile',
  clearProfile: 'library:clearProfile',
  /** Main → renderer push channel for live recording updates. */
  event: 'library:event'
} as const

/** Scheme used to serve screenshots to the renderer. */
export const MEDIA_SCHEME = 'trailmark-media'
