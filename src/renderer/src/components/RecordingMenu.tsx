import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FolderDto, RecordingDto } from '@shared/library'
import { buildFolderTree, flattenTree } from '@shared/folder-tree'

interface Props {
  recording: RecordingDto
  folders: FolderDto[]
  /** True when this recording is the one being recorded right now. */
  live: boolean
  onRename: () => void
  onMove: (folderId: string) => void
  onDelete: () => void
}

/**
 * Per-recording actions, in the list rather than only on the opened recording.
 *
 * Positioned with `position: fixed` against the button's own rectangle: the recordings
 * list scrolls, and a popover laid out inside it would be clipped by the overflow.
 */
export default function RecordingMenu(props: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [movingOpen, setMovingOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const rect = button.current?.getBoundingClientRect()
    if (!rect) return
    // Flip upwards when there is not room below.
    const estimatedHeight = movingOpen ? 260 : 120
    const below = window.innerHeight - rect.bottom
    setPosition({
      top: below < estimatedHeight ? Math.max(8, rect.top - estimatedHeight) : rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - 210)
    })
  }, [open, movingOpen])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (menu.current?.contains(target) || button.current?.contains(target)) return
      setOpen(false)
      setMovingOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        setMovingOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const close = (): void => {
    setOpen(false)
    setMovingOpen(false)
  }

  const nodes = flattenTree(buildFolderTree(props.folders))

  return (
    <>
      <button
        ref={button}
        className="rowmenu__button"
        aria-label={`Actions for ${props.recording.name}`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((was) => !was)
        }}
      >
        ⋯
      </button>

      {open && (
        <div
          ref={menu}
          className="rowmenu"
          role="menu"
          style={{ top: position.top, left: position.left }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="rowmenu__item"
            role="menuitem"
            onClick={() => {
              close()
              props.onRename()
            }}
          >
            Rename
          </button>

          <button
            className="rowmenu__item"
            role="menuitem"
            aria-expanded={movingOpen}
            // Profiles are per folder, so moving mid-recording would file the saved
            // sign-in under the folder it left.
            disabled={props.live}
            title={props.live ? 'Stop the recording before moving it' : undefined}
            onClick={() => setMovingOpen((was) => !was)}
          >
            Move to{movingOpen ? ' ▾' : ' ▸'}
          </button>

          {movingOpen && (
            <div className="rowmenu__folders">
              {[{ id: 'root', name: 'Library', depth: 0 }, ...nodes].map((node) => {
                const current = node.id === props.recording.folderId
                return (
                  <button
                    key={node.id}
                    className={`rowmenu__item rowmenu__folder ${current ? 'is-current' : ''}`}
                    role="menuitem"
                    disabled={current}
                    style={{ paddingLeft: `${16 + node.depth * 12}px` }}
                    onClick={() => {
                      close()
                      props.onMove(node.id)
                    }}
                  >
                    {node.name}
                    {current && <span className="rowmenu__tick">✓</span>}
                  </button>
                )
              })}
            </div>
          )}

          <div className="rowmenu__sep" />

          <button
            className="rowmenu__item rowmenu__item--danger"
            role="menuitem"
            disabled={props.live}
            title={props.live ? 'Stop the recording before deleting it' : undefined}
            onClick={() => {
              close()
              props.onDelete()
            }}
          >
            Delete…
          </button>
        </div>
      )}
    </>
  )
}
