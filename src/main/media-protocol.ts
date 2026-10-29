import { readFile } from 'node:fs/promises'
import { join, normalize, relative, isAbsolute } from 'node:path'
import { protocol } from 'electron'
import { MEDIA_SCHEME } from '@shared/ipc'
import type { Screenshot } from '../storage/store.ts'

/**
 * Serves recorded screenshots to the renderer.
 *
 * A custom scheme rather than file:// or a data URL: file:// from a renderer is a
 * security hole, and full-page screenshots are large enough that base64-encoding them
 * through IPC would be wasteful on every render.
 *
 * The handler resolves strictly inside the media directory. The renderer is treated
 * as untrusted — it will display content derived from recorded pages — so a request
 * for ../../../etc/passwd has to fail on the path check, not on good intentions.
 */

export function mediaUrlFor(shot: Screenshot): string {
  return `${MEDIA_SCHEME}://shot/${encodeURIComponent(shot.recordingId)}/${encodeURIComponent(shot.fileName)}`
}

/** Must be called before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

export function serveMedia(mediaDir: string): void {
  const root = normalize(mediaDir)

  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // trailmark-media://shot/<recordingId>/<fileName>
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (parts.length !== 2) return new Response('Not found', { status: 404 })

      const [recordingId, fileName] = parts as [string, string]
      if (!fileName.endsWith('.png')) return new Response('Forbidden', { status: 403 })

      const resolved = normalize(join(root, recordingId, 'shots', fileName))
      const inside = relative(root, resolved)
      if (inside.startsWith('..') || isAbsolute(inside)) {
        return new Response('Forbidden', { status: 403 })
      }

      const body = await readFile(resolved)
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
