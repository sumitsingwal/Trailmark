/**
 * Copies Playwright's Chromium into vendor/ms-playwright so electron-builder can ship
 * it inside the app.
 *
 * Without this the installer depends on whatever is in the building machine's
 * Playwright cache, which the person installing it will not have. Run before
 * packaging (the dist scripts do this automatically).
 *
 * Platform-specific: Playwright installs the browser for the current platform only,
 * so a Windows installer must be built on Windows (or in CI) to get a Windows
 * Chromium. Building a mac installer with a Windows Chromium is not possible here.
 */
import { chromium } from 'playwright'
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(projectRoot, 'vendor', 'ms-playwright')

/** The `chromium-<revision>` directory that holds the whole browser. */
function browserRoot(executablePath) {
  const parts = executablePath.split(sep)
  const index = parts.findIndex((part) => /^chromium(_headless_shell)?-\d+$/.test(part))
  if (index === -1) return null
  return { dir: parts.slice(0, index + 1).join(sep), name: parts[index] }
}

async function directorySize(path) {
  const { execSync } = await import('node:child_process')
  try {
    return execSync(`du -sh "${path}"`, { encoding: 'utf8' }).split('\t')[0]
  } catch {
    return 'unknown size'
  }
}

const executable = chromium.executablePath()
if (!executable || !existsSync(executable)) {
  console.error('Chromium is not installed. Run: npx playwright install chromium')
  process.exit(1)
}

const found = browserRoot(executable)
if (!found) {
  console.error(`Could not work out the browser directory from ${executable}`)
  process.exit(1)
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

const destination = join(target, found.name)
console.log(`Bundling ${found.name} for ${process.platform}/${process.arch}…`)
await cp(found.dir, destination, { recursive: true, verbatimSymlinks: true })

await stat(destination)

// Records what this bundle is for. The browser is platform- and architecture-specific,
// so a dmg built here can only be installed on the same kind of machine.
const { writeFile } = await import('node:fs/promises')
await writeFile(join(target, 'PLATFORM'), `${process.platform}-${process.arch}\n`, 'utf8')

console.log(`  ${destination}  (${await directorySize(destination)})`)
console.log(`  for ${process.platform}-${process.arch} only — build other platforms on those machines`)
