import { useEffect, useRef, useState } from 'react'
import type { FolderDto, RecordingDto } from '@shared/library'
import { buildFolderTree, flattenTree } from '@shared/folder-tree'
import RecordingMenu from './RecordingMenu'

interface Props {
  folders: FolderDto[]
  recordings: RecordingDto[]
  selectedFolderId: string
  selectedRecordingId: string | null
  busy: boolean
  /** The recording being recorded right now, if any. */
  liveRecordingId: string | null
  onSelectFolder: (id: string) => void
  onSelectRecording: (id: string) => void
  onCreateFolder: (name: string, parentId: string) => void
  onDeleteFolder: (id: string) => void
  onNewRecording: () => void
  onRenameRecording: (id: string, name: string) => void
  onMoveRecording: (id: string, folderId: string) => void
  onDeleteRecording: (recording: RecordingDto) => void
}

const STATUS_LABEL: Record<RecordingDto['status'], string> = {
  recording: 'recording',
  completed: '',
  aborted: 'stopped early'
}

export default function Sidebar(props: Props): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId) renameInput.current?.select()
  }, [renamingId])

  const startRename = (recording: RecordingDto): void => {
    setRenameDraft(recording.name)
    setRenamingId(recording.id)
  }

  const commitRename = (recording: RecordingDto): void => {
    setRenamingId(null)
    const trimmed = renameDraft.trim()
    // A blank name is a slip, not an instruction.
    if (!trimmed || trimmed === recording.name) return
    props.onRenameRecording(recording.id, trimmed)
  }

  const nodes = flattenTree(buildFolderTree(props.folders))

  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed) props.onCreateFolder(trimmed, props.selectedFolderId)
    setName('')
    setAdding(false)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__section">
        <div className="sidebar__heading">
          <span>Folders</span>
          <button className="icon" title="New folder" onClick={() => setAdding(true)}>
            +
          </button>
        </div>

        <ul className="tree">
          <li>
            <button
              className={`tree__item ${props.selectedFolderId === 'root' ? 'is-selected' : ''}`}
              onClick={() => props.onSelectFolder('root')}
            >
              <span className="tree__name">Library</span>
            </button>
          </li>
          {nodes.map((node) => (
            <li key={node.id}>
              <button
                className={`tree__item ${props.selectedFolderId === node.id ? 'is-selected' : ''}`}
                style={{ paddingLeft: `${12 + node.depth * 14}px` }}
                onClick={() => props.onSelectFolder(node.id)}
              >
                <span className="tree__name">{node.name}</span>
                {node.recordingCount > 0 && (
                  <span className="tree__count">{node.recordingCount}</span>
                )}
                <span
                  className="tree__delete"
                  role="button"
                  tabIndex={0}
                  title="Delete this folder, and everything nested inside it"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onDeleteFolder(node.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') props.onDeleteFolder(node.id)
                  }}
                >
                  ✕
                </span>
              </button>
            </li>
          ))}
        </ul>

        {adding && (
          <div className="sidebar__add">
            <input
              autoFocus
              value={name}
              placeholder="Folder name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') {
                  setName('')
                  setAdding(false)
                }
              }}
              onBlur={submit}
            />
          </div>
        )}
      </div>

      <div className="sidebar__section sidebar__section--grow">
        <div className="sidebar__heading">
          <span>Recordings</span>
          <button className="primary small" disabled={props.busy} onClick={props.onNewRecording}>
            New
          </button>
        </div>

        {props.recordings.length === 0 ? (
          <p className="empty">
            Nothing here yet. Press <strong>New</strong> to record a walkthrough into this folder.
          </p>
        ) : (
          <ul className="reclist">
            {props.recordings.map((recording) =>
              renamingId === recording.id ? (
                <li key={recording.id} className="reclist__renaming">
                  <input
                    ref={renameInput}
                    value={renameDraft}
                    aria-label="Recording name"
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => commitRename(recording)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(recording)
                      if (event.key === 'Escape') setRenamingId(null)
                    }}
                  />
                </li>
              ) : (
                <li key={recording.id} className="reclist__row">
                  <button
                    className={`reclist__item ${
                      props.selectedRecordingId === recording.id ? 'is-selected' : ''
                    }`}
                    onClick={() => props.onSelectRecording(recording.id)}
                  >
                    <span className="reclist__name">{recording.name}</span>
                    <span className="reclist__meta">
                      {recording.stepCount} steps
                      {recording.screenshotCount > 0 && ` · ${recording.screenshotCount} 📷`}
                      {STATUS_LABEL[recording.status] && (
                        <em className={`badge badge--${recording.status}`}>
                          {STATUS_LABEL[recording.status]}
                        </em>
                      )}
                    </span>
                  </button>

                  <RecordingMenu
                    recording={recording}
                    folders={props.folders}
                    live={props.liveRecordingId === recording.id}
                    onRename={() => startRename(recording)}
                    onMove={(folderId) => props.onMoveRecording(recording.id, folderId)}
                    onDelete={() => props.onDeleteRecording(recording)}
                  />
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </aside>
  )
}
