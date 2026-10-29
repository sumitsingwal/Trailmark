import { useEffect, useState } from 'react'
import type { StepDto } from '@shared/library'
import { STEP_COLUMNS, type StepColumnKey } from '@shared/step-columns'

interface Props {
  steps: StepDto[]
  columns: readonly StepColumnKey[]
  onEdit: (
    stepId: string,
    changes: { action?: string; expectedResult?: string; note?: string }
  ) => void
  onDelete: (stepId: string) => void
  /** Asks to mask a value the recorder did not recognise as sensitive. */
  onMarkSensitive: (step: StepDto) => void
  onMove: (stepId: string, direction: -1 | 1) => void
  onOpenShot: (src: string) => void
}

/**
 * An input that keeps its own draft while focused and saves on blur.
 *
 * Saving per keystroke would write to the database on every character; re-rendering
 * from props while typing would fight the cursor. Drafting locally avoids both.
 */
function Editable({
  value,
  placeholder,
  onSave
}: {
  value: string
  placeholder: string
  onSave: (next: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

  // Accept updates from elsewhere (a live step arriving, a reload) unless the user
  // is mid-edit in this very field.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  return (
    <textarea
      className="cell-edit"
      rows={1}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft !== value) onSave(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/** Read-only text that can be selected and copied — locators usually are. */
function Fixed({ value, mono = false }: { value: string; mono?: boolean }): React.JSX.Element {
  if (!value) return <span className="muted">—</span>
  return <span className={mono ? 'cell-mono' : 'cell-text'}>{value}</span>
}

export default function StepTable(props: Props): React.JSX.Element {
  if (props.steps.length === 0) {
    return (
      <p className="empty">
        No steps recorded yet. Clicks, typing, and page changes in the recorder browser appear here
        as you go.
      </p>
    )
  }

  const visible = STEP_COLUMNS.filter((column) => props.columns.includes(column.key))

  const renderCell = (step: StepDto, key: StepColumnKey): React.JSX.Element => {
    switch (key) {
      case 'action':
        return (
          <Editable
            value={step.action}
            placeholder="Describe the action"
            onSave={(action) => props.onEdit(step.id, { action })}
          />
        )
      case 'expected':
        return (
          <Editable
            value={step.expectedResult}
            placeholder="What should happen?"
            onSave={(expectedResult) => props.onEdit(step.id, { expectedResult })}
          />
        )
      case 'notes':
        return (
          <Editable
            value={step.note}
            placeholder="Note"
            onSave={(note) => props.onEdit(step.id, { note })}
          />
        )
      case 'page':
        return <Fixed value={step.pageTitle} />
      case 'url':
        return <Fixed value={step.url} mono />
      case 'input':
        return (
          <span className={step.masked ? 'cell-masked' : 'cell-text'}>
            {step.inputValue || '—'}
          </span>
        )
      case 'xpath':
        return <Fixed value={step.locator.xpath} mono />
      case 'unique':
        return step.locator.xpathMatches === null ? (
          <span className="muted">—</span>
        ) : step.locator.xpathMatches === 1 ? (
          <span className="cell-text">Yes</span>
        ) : (
          <span className="locator__warn">No — {step.locator.xpathMatches}</span>
        )
      case 'screenshot':
        return step.screenshot ? (
          <button
            className="thumb"
            title="Open screenshot"
            onClick={() => props.onOpenShot(step.screenshot!.src)}
          >
            <img src={step.screenshot.src} alt="" loading="lazy" />
          </button>
        ) : (
          <span className="muted">—</span>
        )
    }
  }

  return (
    <div className="table-wrap">
      <table className="steps">
        <thead>
          <tr>
            <th className="col-n">#</th>
            {visible.map((column) => (
              <th key={column.key} style={{ width: column.width }} title={column.hint}>
                {column.label}
              </th>
            ))}
            <th className="col-act" />
          </tr>
        </thead>
        <tbody>
          {props.steps.map((step, index) => (
            <tr key={step.id} className={step.masked ? 'is-masked' : ''}>
              <td className="col-n">
                {index + 1}
                <span className="step-type">{step.type}</span>
              </td>

              {visible.map((column) => (
                <td
                  key={column.key}
                  className={column.key === 'screenshot' ? 'col-shot' : undefined}
                >
                  {renderCell(step, column.key)}
                </td>
              ))}

              <td className="col-act">
                {(step.type === 'input' || step.type === 'select') &&
                !step.masked &&
                step.inputValue ? (
                  <button
                    className="icon"
                    title="Mark this value as sensitive"
                    onClick={() => props.onMarkSensitive(step)}
                  >
                    🔒
                  </button>
                ) : (
                  // Holds the space so the other row actions line up down the table.
                  <span className="icon col-act__slot" aria-hidden="true">
                    🔒
                  </span>
                )}
                <button
                  className="icon"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => props.onMove(step.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="icon"
                  title="Move down"
                  disabled={index === props.steps.length - 1}
                  onClick={() => props.onMove(step.id, 1)}
                >
                  ↓
                </button>
                <button
                  className="icon danger"
                  title="Delete step"
                  onClick={() => props.onDelete(step.id)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
