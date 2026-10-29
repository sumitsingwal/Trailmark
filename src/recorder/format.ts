import type { ElementInfo, RecordedStep } from './events.ts'

/**
 * Turns a recorded step into the sentence a human reads in the clickpath.
 *
 * Pure and dependency-free so it can be unit-tested without a browser, and so the
 * Excel export in Phase 6 can reuse it rather than growing a second, drifting
 * description of the same events.
 */

/** What to call an element in prose: its label, falling back to id, name, then tag. */
export function elementName(target: ElementInfo): string {
  if (target.label) return target.label
  if (target.testId) return target.testId
  if (target.name) return target.name
  if (target.id) return target.id
  return target.tag
}

function fieldName(target: ElementInfo): string {
  const name = elementName(target)
  // Labels are often captured with their trailing colon or asterisk still attached.
  return name.replace(/[:*\s]+$/, '')
}

export function describeStep(step: RecordedStep): string {
  switch (step.type) {
    case 'navigate':
      return step.kind === 'initial'
        ? `Open ${step.pageTitle || step.url}`
        : `Navigate to ${step.pageTitle || step.url}`

    case 'popup':
      return `New tab opens: ${step.pageTitle || step.url}`

    case 'click': {
      const name = elementName(step.target)
      const role = step.target.role
      if (role === 'link') return `Click link "${name}"`
      if (role === 'button') return `Click "${name}"`
      return name === step.target.tag ? `Click ${step.target.tag}` : `Click "${name}"`
    }

    case 'input':
      return step.masked
        ? `Enter password in ${fieldName(step.target)}`
        : `Enter "${step.value}" in ${fieldName(step.target)}`

    case 'select':
      return `Select "${step.optionLabel || step.value}" in ${fieldName(step.target)}`

    case 'toggle': {
      const name = fieldName(step.target)
      if (step.target.role === 'radio') return `Choose "${name}"`
      return step.checked ? `Tick "${name}"` : `Untick "${name}"`
    }

    case 'key':
      return `Press ${step.key}`
  }
}

/**
 * The locator line shown beneath a step in the console harness, or undefined when the
 * step has no element (a navigation) or produced no usable candidate.
 */
export function formatLocatorLine(step: RecordedStep): string | undefined {
  if (!step.recommended) return undefined
  const { kind, expression, unique, matches } = step.recommended
  const warning = unique ? '' : `  ⚠ matches ${matches}`
  return `          ${kind}: ${expression}${warning}`
}

/** One-line rendering used by the console harness. */
export function formatStepLine(step: RecordedStep): string {
  const seq = String(step.seq + 1).padStart(3, ' ')
  const seconds = (step.at / 1000).toFixed(1).padStart(5, ' ')
  return `${seq}  ${seconds}s  ${describeStep(step)}`
}
