import { describe, expect, it } from 'vitest'
import { captureModifierLabel, captureShortcutLabel } from '../../src/shared/shortcuts.ts'

describe('capture shortcut label', () => {
  it('uses the macOS symbols on a Mac', () => {
    expect(captureModifierLabel(true)).toBe('⌘⇧')
    expect(captureShortcutLabel(true)).toBe('⌘⇧+S')
  })

  it('spells out the modifiers elsewhere', () => {
    expect(captureModifierLabel(false)).toBe('Ctrl+Shift')
    expect(captureShortcutLabel(false)).toBe('Ctrl+Shift+S')
  })
})
