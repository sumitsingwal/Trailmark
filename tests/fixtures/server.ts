import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Serves tests/fixtures/site over HTTP.
 *
 * The recorder is tested against this rather than a real site so the suite stays
 * deterministic and offline — a third-party page that changes its markup would turn
 * locator tests into flaky tests.
 */

const SITE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'site')

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
}

export interface FixtureServer {
  url: string
  close: () => Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const requested = (req.url ?? '/').split('?')[0] ?? '/'
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '')
    // Keep traversal inside the fixture directory even though this is test-only.
    const resolved = join(SITE_DIR, normalize(relative))
    if (!resolved.startsWith(SITE_DIR)) {
      res.writeHead(403).end('forbidden')
      return
    }

    readFile(resolved)
      .then((body) => {
        res.writeHead(200, {
          'content-type': CONTENT_TYPES[extname(resolved)] ?? 'application/octet-stream'
        })
        res.end(body)
      })
      .catch(() => {
        res.writeHead(404).end('not found')
      })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Fixture server did not bind to a port')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}
