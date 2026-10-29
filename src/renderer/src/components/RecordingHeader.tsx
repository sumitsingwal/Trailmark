import type { FolderDto, RecordingDetailDto } from '@shared/library'

interface Props {
  detail: RecordingDetailDto
  folders: FolderDto[]
  /** True when this very recording is the one being recorded right now. */
  live: boolean
}

/**
 * Identifies the open recording.
 *
 * Read-only on purpose: renaming, refiling, and deleting all live in the recording's
 * row menu in the sidebar, so there is one place to do them rather than two that can
 * disagree — and they work without opening the recording first.
 */
export default function RecordingHeader(props: Props): React.JSX.Element {
  const { recording } = props.detail
  const folder = props.folders.find((f) => f.id === recording.folderId)

  return (
    <div className="rechead">
      <h2>{recording.name}</h2>
      <p className="muted rechead__facts">
        {folder?.name ?? 'Library'} · {recording.startUrl} · {props.detail.steps.length} steps ·{' '}
        {recording.screenshotCount} screenshots
        {props.live && ' · recording now'}
      </p>
    </div>
  )
}
