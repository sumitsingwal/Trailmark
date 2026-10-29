import { describe, expect, it } from 'vitest'
import { readPngSize } from '../../src/storage/png.ts'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function png(width: number, height: number, chunkType = 'IHDR'): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(13)
  const dimensions = Buffer.alloc(8)
  dimensions.writeUInt32BE(width, 0)
  dimensions.writeUInt32BE(height, 4)
  return Buffer.concat([
    SIGNATURE,
    length,
    Buffer.from(chunkType, 'latin1'),
    dimensions,
    Buffer.alloc(5)
  ])
}

describe('readPngSize', () => {
  it('reads the dimensions from the header', () => {
    expect(readPngSize(png(1280, 3200))).toEqual({ width: 1280, height: 3200 })
  })

  it('handles a full-page screenshot taller than any screen', () => {
    expect(readPngSize(png(1440, 21_000))).toEqual({ width: 1440, height: 21_000 })
  })

  it('refuses anything that is not a PNG', () => {
    expect(readPngSize(Buffer.from('GIF89a and then some padding bytes here'))).toBeUndefined()
    expect(readPngSize(Buffer.alloc(64))).toBeUndefined()
  })

  it('refuses a truncated file rather than reading past the end', () => {
    expect(readPngSize(png(100, 100).subarray(0, 20))).toBeUndefined()
    expect(readPngSize(Buffer.alloc(0))).toBeUndefined()
  })

  it('refuses a PNG whose first chunk is not IHDR', () => {
    expect(readPngSize(png(100, 100, 'IDAT'))).toBeUndefined()
  })

  it('treats a zero dimension as invalid', () => {
    expect(readPngSize(png(0, 100))).toBeUndefined()
    expect(readPngSize(png(100, 0))).toBeUndefined()
  })
})
