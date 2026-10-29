/**
 * The capture shortcut, as shown to people.
 *
 * The recorder bar and the in-app help both name it, so both read it from here —
 * otherwise the help would eventually describe a shortcut the recorder no longer has.
 * The key itself is matched in the injected overlay, which cannot import anything.
 */

/** Modifier prefix for the capture shortcut, e.g. "⌘⇧" on macOS. */
export function captureModifierLabel(mac: boolean): string {
  return mac ? '⌘⇧' : 'Ctrl+Shift'
}

/** The full capture shortcut, e.g. "⌘⇧+S" or "Ctrl+Shift+S". */
export function captureShortcutLabel(mac: boolean): string {
  return `${captureModifierLabel(mac)}+S`
}
