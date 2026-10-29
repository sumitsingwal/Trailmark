import { useEffect, useState } from 'react'
import type { FolderDto, StartRecordingInput } from '@shared/library'
import { buildFolderTree, flattenTree } from '@shared/folder-tree'

interface Props {
  folders: FolderDto[]
  defaultFolderId: string
  busy: boolean
  onCancel: () => void
  onStart: (input: StartRecordingInput) => void
  onClearProfile: (folderId: string) => Promise<void>
  hasProfile: (folderId: string) => Promise<boolean>
}

export default function NewRecordingDialog(props: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [folderId, setFolderId] = useState(props.defaultFolderId)
  const [reuseProfile, setReuseProfile] = useState(true)
  const [savedSignIn, setSavedSignIn] = useState(false)

  const nodes = flattenTree(buildFolderTree(props.folders))
  const canStart = name.trim().length > 0 && url.trim().length > 0 && !props.busy

  // Whether this folder already has a signed-in browser profile to reuse.
  useEffect(() => {
    let current = true
    void props.hasProfile(folderId).then((has) => {
      if (current) setSavedSignIn(has)
    })
    return () => {
      current = false
    }
  }, [folderId, props])

  const start = (): void => {
    if (!canStart) return
    props.onStart({ name: name.trim(), startUrl: url.trim(), folderId, reuseProfile })
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="New recording">
      <div className="modal__card">
        <h2>New recording</h2>
        <p className="muted">
          A browser opens with the recorder bar. Walk the flow, press Capture where an expected page
          matters, then Stop.
        </p>

        <label htmlFor="rec-name">Name</label>
        <input
          id="rec-name"
          autoFocus
          value={name}
          placeholder="Checkout — happy path"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && start()}
        />

        <label htmlFor="rec-url">Start URL</label>
        <input
          id="rec-url"
          value={url}
          placeholder="app.internal/login"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && start()}
        />

        <label htmlFor="rec-folder">Folder</label>
        <select
          id="rec-folder"
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="root">Library</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {' '.repeat(node.depth * 2)}
              {node.name}
            </option>
          ))}
        </select>

        <div className="modal__profile">
          <label className="check">
            <input
              type="checkbox"
              checked={reuseProfile}
              onChange={(event) => setReuseProfile(event.target.checked)}
            />
            <span>
              Reuse this folder&rsquo;s browser profile
              {savedSignIn ? ' — a sign-in is saved' : ' — nothing saved yet'}
            </span>
          </label>
          {savedSignIn && (
            <button
              className="link"
              onClick={() => void props.onClearProfile(folderId).then(() => setSavedSignIn(false))}
            >
              Forget saved sign-in
            </button>
          )}
        </div>
        <p className="muted modal__hint">
          Each folder has its own browser profile, so a sign-in made here is kept for every
          recording in this folder, and never shared with other folders.
        </p>

        <div className="modal__actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="primary" disabled={!canStart} onClick={start}>
            {props.busy ? 'Opening browser…' : 'Start recording'}
          </button>
        </div>
      </div>
    </div>
  )
}
