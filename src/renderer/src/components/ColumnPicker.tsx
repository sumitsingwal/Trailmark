import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_STEP_COLUMNS,
  LOCATOR_PRESET,
  STEP_COLUMNS,
  toggleColumn,
  type StepColumnKey
} from '@shared/step-columns'

interface Props {
  columns: readonly StepColumnKey[]
  onChange: (columns: StepColumnKey[]) => void
}

/** Chooses which fields the step table shows. The choice is remembered by the app. */
export default function ColumnPicker(props: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  // Close on a click elsewhere or on Escape, the way a menu is expected to behave.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const groups = ['Business', 'Locator'] as const

  return (
    <div className="picker" ref={container}>
      <button
        className="picker__button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        title="Choose which fields to show"
      >
        Columns ({props.columns.length})
      </button>

      {open && (
        <div className="picker__menu" role="menu">
          <div className="picker__presets">
            <button className="link" onClick={() => props.onChange([...DEFAULT_STEP_COLUMNS])}>
              Clickpath
            </button>
            <button className="link" onClick={() => props.onChange([...LOCATOR_PRESET])}>
              Locator detail
            </button>
            <button
              className="link"
              onClick={() => props.onChange(STEP_COLUMNS.map((column) => column.key))}
            >
              Everything
            </button>
          </div>

          {groups.map((group) => (
            <div key={group} className="picker__group">
              <p className="picker__heading">{group}</p>
              {STEP_COLUMNS.filter((column) => column.group === group).map((column) => {
                const checked = props.columns.includes(column.key)
                const isLast = checked && props.columns.length === 1
                return (
                  <label key={column.key} className="check picker__item">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isLast}
                      title={isLast ? 'At least one column has to stay visible' : undefined}
                      onChange={() => props.onChange(toggleColumn(props.columns, column.key))}
                    />
                    <span>{column.label}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
