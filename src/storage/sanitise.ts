import type { RecordedStep } from '../recorder/events.ts'
import { redactUrl } from '../recorder/redact.ts'

/**
 * The last line of defence before anything is written to disk.
 *
 * Masking already happens in the page and redaction already happens in the driver.
 * This repeats both at the storage boundary on purpose: those are the paths we know
 * about today, and a future one — an import, a replayed event, a bug — must not be
 * able to put a credential into the library file. Cheap to run, and the only place
 * where "no plaintext on disk" can be asserted as a property rather than a habit.
 */

export const STORED_MASK = '********'

/** Values that a masked field is allowed to hold. */
function isAcceptableMask(value: string): boolean {
  return value === STORED_MASK || value === ''
}

export interface SanitisedStep {
  step: RecordedStep
  /** What had to be scrubbed, so callers can log a real bug rather than ignore it. */
  violations: string[]
}

export function sanitiseStep(step: RecordedStep): SanitisedStep {
  const violations: string[] = []
  const next: Record<string, unknown> = { ...step }

  if (typeof next['url'] === 'string') {
    const redacted = redactUrl(next['url'])
    if (redacted !== next['url']) violations.push('url contained sensitive parameters')
    next['url'] = redacted
  }

  if (typeof next['frameUrl'] === 'string') {
    const redacted = redactUrl(next['frameUrl'])
    if (redacted !== next['frameUrl']) violations.push('frameUrl contained sensitive parameters')
    next['frameUrl'] = redacted
  }

  // A step flagged as masked must not carry the real value, whatever produced it.
  if (next['masked'] === true && typeof next['value'] === 'string') {
    if (!isAcceptableMask(next['value'])) {
      violations.push('masked field carried a plaintext value')
      next['value'] = STORED_MASK
    }
  }

  return { step: next as RecordedStep, violations }
}

/** The value written to the `input_value` column. */
export function storedInputValue(step: RecordedStep): string {
  if (step.type !== 'input') return step.type === 'select' ? step.value : ''
  return step.masked ? STORED_MASK : step.value
}
