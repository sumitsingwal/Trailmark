/**
 * Renders the application icon.
 *
 * Uses the Chromium that Playwright already provides rather than adding an image
 * library: the icon is described as HTML, screenshotted at 1024, and turned into an
 * .icns with macOS's own iconutil.
 *
 *   node scripts/make-icon.mjs            # renders every variant and a preview sheet
 *   node scripts/make-icon.mjs t-trail    # also installs that one as the app icon
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'icon-variants')

/**
 * Palette taken from the app's own accent colours, so the icon and the window agree.
 * The squircle sits inside a 10% margin, which is the proportion macOS expects.
 */
const INK = '#f4f7ff'
const ACCENT = '#78b0ff'

const shell = (body, extra = '') => `
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 1024px; height: 1024px; background: transparent; }
    .plate {
      position: absolute; inset: 100px;
      border-radius: 205px;
      background: linear-gradient(150deg, #3a6fd8 0%, #2f5bb7 45%, #1e3a78 100%);
      box-shadow: inset 0 -14px 40px rgba(0,0,0,.28), inset 0 14px 30px rgba(255,255,255,.14);
      display: grid; place-items: center;
      overflow: hidden;
      font-family: 'SF Pro Display', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
      color: ${INK};
    }
    ${extra}
  </style>
  <div class="plate">${body}</div>
`

/** Dotted trail rising to a solid marker — the name, drawn. */
const trail = (opacity = 1) => `
  <svg class="trail" viewBox="0 0 100 100" style="opacity:${opacity}">
    <path d="M14 78 C 32 78, 38 54, 56 44 S 76 34, 86 24"
          fill="none" stroke="${ACCENT}" stroke-width="5.5"
          stroke-linecap="round" stroke-dasharray="0.1 13" />
    <circle cx="86" cy="22" r="10" fill="${INK}" />
  </svg>
`

const VARIANTS = {
  // Two-letter monogram. Reads cleanly, but see the note about "TM".
  'tm-monogram': shell(
    `<span class="mark">TM</span>`,
    `.mark { font-size: 330px; font-weight: 700; letter-spacing: -18px; text-indent: -18px; }`
  ),

  // A single letter for legibility at small sizes, with the trail beneath it rather
  // than crossing it — overlapping the stem muddied both at small sizes.
  't-trail': shell(
    `<div class="stack"><span class="mark">T</span>
      <svg class="under" viewBox="0 0 100 26">
        <path d="M8 19 C 26 19, 34 9, 62 7" fill="none" stroke="${ACCENT}"
              stroke-width="6" stroke-linecap="round" stroke-dasharray="0.1 14" />
        <circle cx="84" cy="6" r="9" fill="${INK}" />
      </svg>
    </div>`,
    `.stack { display: grid; place-items: center; gap: 26px; transform: translateY(-14px); }
     .mark { font-size: 400px; font-weight: 700; line-height: .82; }
     .under { width: 470px; height: 122px; overflow: visible; }`
  ),

  // The monogram with the trail as an underline: letters, plus the idea.
  'tm-trail': shell(
    `<div class="stack"><span class="mark">TM</span>
      <svg class="under" viewBox="0 0 100 26">
        <path d="M6 18 C 26 18, 36 8, 62 6" fill="none" stroke="${ACCENT}"
              stroke-width="6" stroke-linecap="round" stroke-dasharray="0.1 14" />
        <circle cx="84" cy="5" r="9" fill="${INK}" />
      </svg>
    </div>`,
    `.stack { display: grid; place-items: center; gap: 30px; transform: translateY(-10px); }
     .mark { font-size: 290px; font-weight: 700; letter-spacing: -16px; text-indent: -16px; line-height: .9; }
     .under { width: 470px; height: 110px; overflow: visible; }`
  ),

  // No letters at all: the trail and its mark carry the whole idea.
  'trail-mark': shell(
    `${trail(1)}`,
    `.trail { width: 620px; height: 620px; }`
  ),

  // Wordmark, for contexts where the full name is wanted.
  wordmark: shell(
    `<div class="stack"><span class="word">Trail</span><span class="word word--b">mark</span></div>`,
    `.stack { display: grid; place-items: center; gap: 4px; }
     .word { font-size: 168px; font-weight: 700; letter-spacing: -6px; line-height: .92; }
     .word--b { color: ${ACCENT}; }`
  )
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

for (const [name, html] of Object.entries(VARIANTS)) {
  await page.setContent(html)
  // omitBackground keeps the corners transparent, which the rounded plate needs.
  await page.screenshot({ path: join(outDir, `${name}.png`), omitBackground: true })
  console.log(`  ${name}.png`)
}

// A sheet showing each variant at the sizes they are actually seen at.
const sizes = [256, 128, 64, 32]
const row = (name) =>
  `<div class="row"><p>${name}</p>${sizes
    .map((s) => `<img src="${name}.png" width="${s}" height="${s}" />`)
    .join('')}</div>`
const sheet = `
  <style>
    body { margin: 0; padding: 28px 32px; background: #14161d; color: #e6e8ee;
           font: 13px 'SF Pro Text', -apple-system, sans-serif; }
    .row { display: flex; align-items: flex-end; gap: 22px; margin-bottom: 26px; }
    .row p { width: 130px; margin: 0 0 6px; color: #9aa1b4; }
    img { image-rendering: auto; }
  </style>
  ${Object.keys(VARIANTS).map(row).join('')}
`
await writeFile(join(outDir, 'preview.html'), sheet, 'utf8')
await page.setViewportSize({ width: 700, height: 240 * Object.keys(VARIANTS).length })
await page.goto(`file://${join(outDir, 'preview.html')}`)
await page.screenshot({ path: join(outDir, 'preview.png'), fullPage: true })
console.log('  preview.png')

await browser.close()

// ---- install the chosen variant -------------------------------------------
const chosen = process.argv[2]
if (chosen) {
  if (!VARIANTS[chosen]) {
    console.error(`Unknown variant "${chosen}". Options: ${Object.keys(VARIANTS).join(', ')}`)
    process.exit(1)
  }

  const source = join(outDir, `${chosen}.png`)
  const iconPng = join(root, 'resources', 'icon.png')
  execFileSync('cp', [source, iconPng])

  // macOS wants an .icns; iconutil builds one from a sized iconset.
  const iconset = join(root, 'resources', 'icon.iconset')
  await rm(iconset, { recursive: true, force: true })
  await mkdir(iconset, { recursive: true })
  for (const size of [16, 32, 64, 128, 256, 512]) {
    for (const [suffix, pixels] of [[`${size}x${size}`, size], [`${size}x${size}@2x`, size * 2]]) {
      if (pixels > 1024) continue
      execFileSync('sips', ['-z', String(pixels), String(pixels), source, '--out',
        join(iconset, `icon_${suffix}.png`)], { stdio: 'ignore' })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'resources', 'icon.icns')])
  await rm(iconset, { recursive: true, force: true })

  console.log(`\nInstalled "${chosen}" as the app icon (resources/icon.png and icon.icns)`)
}
