import { useEffect, useRef } from 'react'

interface Props {
  title: string
  /** What exactly is about to happen, in plain terms. */
  body: string
  confirmLabel: string
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Confirmation for an action that cannot be undone.
 *
 * Deleting a recording takes its steps and its screenshots with it, and the action
 * now sits in a hover menu where a misclick is easy. Cancel is focused rather than
 * the destructive button, so Enter on reflex does nothing.
 */
export default function ConfirmDialog(props: Props): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancel.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [props])

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="modal__card modal__card--narrow">
        <h2>{props.title}</h2>
        <p className="muted">{props.body}</p>
        <div className="modal__actions">
          <button ref={cancel} onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className={props.destructive ? 'danger-solid' : 'primary'}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
