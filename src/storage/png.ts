/**
 * Minimal PNG header reader.
 *
 * Screenshot dimensions belong in the library so the export can size images without
 * opening every file. Reading the 24-byte header is enough for that, and avoids
 * pulling an image library in for two integers.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface PngSize {
  width: number
  height: number
}

/**
 * Returns the dimensions, or undefined if the buffer is not a PNG whose first chunk
 * is IHDR. Deliberately strict: a wrong guess would put nonsense in the library.
 */
export function readPngSize(buffer: Buffer): PngSize | undefined {
  // 8-byte signature + 4-byte length + "IHDR" + 8 bytes of width/height.
  if (buffer.length < 24) return undefined
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) return undefined
  if (buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return undefined

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width === 0 || height === 0) return undefined
  return { width, height }
}
