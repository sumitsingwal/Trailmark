import type { ExportDocument } from './rows.ts'

/**
 * CSV rendering.
 *
 * Quoting is the whole job here: locator expressions routinely contain commas,
 * quotes, and newlines — `//button[normalize-space()='Save, now']` is ordinary — and
 * an unescaped one silently shifts every later column.
 */

export function escapeCsvValue(value: string): string {
  // A leading =, +, -, or @ is executed as a formula by Excel on open. Prefixing a
  // single quote keeps the cell literal, which matters because these values come from
  // pages we do not control.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (!/[",\r\n]/.test(guarded)) return guarded
  return `"${guarded.replace(/"/g, '""')}"`
}

export function toCsv(document: ExportDocument): string {
  const lines: string[] = []
  lines.push(document.columns.map((column) => escapeCsvValue(column.header)).join(','))
  for (const row of document.rows) {
    lines.push(
      document.columns.map((column) => escapeCsvValue(row.values[column.key] ?? '')).join(',')
    )
  }
  // Trailing newline: some tools drop the last row without it.
  return `${lines.join('\r\n')}\r\n`
}
