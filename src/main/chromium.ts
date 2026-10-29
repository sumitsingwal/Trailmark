import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Finds the Chromium the recorder should drive.
 *
 * A packaged app must use the copy shipped inside it: Playwright's default is a
 * per-user cache directory that only exists on a machine where `playwright install`
 * has been run, so a build handed to a colleague would otherwise fail to record
 * anything. In development the cache is exactly what we want, so this returns
 * undefined and lets Playwright decide.
 */

/** Relative paths to the executable inside a `chromium-<rev>` directory. */
const CANDIDATES: Record<string, readonly string[]> = {
  darwin: [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium'
  ],
  win32: ['chrome-win/chrome.exe'],
  linux: ['chrome-linux/chrome']
}

export interface ChromiumLocation {
  executablePath?: string
  /** Where it came from, for the diagnostics panel. */
  source: 'bundled' | 'playwright-cache'
  detail: string
}

export function locateChromium(): ChromiumLocation {
  if (!app.isPackaged) {
    return {
      source: 'playwright-cache',
      detail: "Development build — using Playwright's own browser cache."
    }
  }

  const root = join(process.resourcesPath, 'ms-playwright')
  if (!existsSync(root)) {
    return {
      source: 'playwright-cache',
      detail: `No bundled browser at ${root}; falling back to the Playwright cache.`
    }
  }

  let browserDirs: string[]
  try {
    browserDirs = readdirSync(root).filter((name) => name.startsWith('chromium-'))
  } catch {
    browserDirs = []
  }

  for (const dir of browserDirs) {
    for (const relative of CANDIDATES[process.platform] ?? []) {
      const candidate = join(root, dir, relative)
      if (existsSync(candidate)) {
        return { executablePath: candidate, source: 'bundled', detail: candidate }
      }
    }
  }

  return {
    source: 'playwright-cache',
    detail: `Bundled browser directory exists but no executable was found under ${root}.`
  }
}
