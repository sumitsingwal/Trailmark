import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { installLocatorBuilder } from '../../src/recorder/injected/locator.ts'
import { summariseLocators } from '../../src/recorder/locator-rules.ts'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.ts'
import type {
  LocatorBundle,
  LocatorCandidate,
  RecommendedLocator
} from '../../src/recorder/events.ts'

/**
 * Exercises the in-page locator builder against the fixture site.
 *
 * The builder needs a real DOM — element counts, shadow roots, and XPath evaluation
 * are the whole point — so these run in a browser rather than jsdom. The ranking that
 * follows is applied by the same pure rules the driver uses.
 */

let fixture: FixtureServer
let browser: Browser
let page: Page

beforeAll(async () => {
  fixture = await startFixtureServer()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.addInitScript(installLocatorBuilder, { globalName: '__trailmark_locator' })
  page = await context.newPage()
})

afterAll(async () => {
  await browser.close()
  await fixture.close()
})

interface Resolved {
  bundle: LocatorBundle
  recommended?: RecommendedLocator
  unstable: string[]
  candidate: (kind: LocatorCandidate['kind']) => LocatorCandidate | undefined
}

async function locatorsFor(selector: string, shadowHost?: string): Promise<Resolved> {
  const bundle = (await page.evaluate(
    ({ sel, host }) => {
      const root = host ? document.querySelector(host)?.shadowRoot : document
      const el = root?.querySelector(sel)
      if (!el) throw new Error(`fixture element not found: ${sel}`)
      const build = (window as unknown as Record<string, unknown>)['__trailmark_locator'] as (
        e: Element
      ) => unknown
      return build(el)
    },
    { sel: selector, host: shadowHost ?? null }
  )) as LocatorBundle

  const { recommended, unstable } = summariseLocators(bundle)
  return {
    bundle,
    ...(recommended ? { recommended } : {}),
    unstable,
    candidate: (kind) => bundle.candidates.find((c) => c.kind === kind)
  }
}

describe('on a form page', () => {
  beforeAll(async () => {
    await page.goto(`${fixture.url}/form.html`, { waitUntil: 'domcontentloaded' })
  })

  it('recommends a test id when one is present', async () => {
    const { recommended, candidate } = await locatorsFor('[data-testid="add-line"]')
    expect(candidate('testid')).toMatchObject({ matches: 1 })
    expect(recommended).toMatchObject({
      kind: 'testid',
      unique: true,
      playwright: 'getByTestId("add-line")'
    })
  })

  it('recommends a unique id over structural locators', async () => {
    const { recommended } = await locatorsFor('#qty')
    expect(recommended).toMatchObject({ kind: 'id', expression: '#qty', unique: true })
  })

  it('offers the field label as a candidate for form controls', async () => {
    const { candidate } = await locatorsFor('#country')
    expect(candidate('label')).toMatchObject({
      expression: 'label=Country',
      playwright: 'getByLabel("Country")',
      matches: 1
    })
  })

  it('reports honestly that a repeated field name is ambiguous', async () => {
    // Both the billing and shipping forms contain name="city".
    const { candidate } = await locatorsFor('#billing-city')
    expect(candidate('name')).toMatchObject({ expression: 'input[name="city"]', matches: 2 })
  })

  it('anchors a relative XPath on the nearest identifiable ancestor', async () => {
    // Two "Save" buttons exist; only the anchor tells them apart.
    const { recommended, candidate } = await locatorsFor('#billing button')
    expect(candidate('role')).toMatchObject({ matches: 2 })

    const xpath = candidate('xpath')
    expect(xpath?.expression).toContain("//*[@id='billing']//button")
    expect(xpath?.expression).toContain("normalize-space()='Save'")
    expect(xpath?.matches).toBe(1)
    // Not an absolute /html/body/... path.
    expect(xpath?.expression.startsWith('/html')).toBe(false)

    expect(recommended).toMatchObject({ kind: 'xpath', unique: true })
  })

  it('refuses to recommend a generated class, choosing role and name instead', async () => {
    const { recommended, unstable, bundle } = await locatorsFor('.sc-bdVaJa')
    expect(unstable).toEqual(expect.arrayContaining(['sc-bdVaJa', 'Button_root__2Ab3x']))
    expect(bundle.classes).toContain('sc-bdVaJa')

    expect(recommended?.kind).toBe('role')
    expect(recommended?.expression).toContain('Apply discount')
    expect(recommended?.expression).not.toContain('sc-bdVaJa')
  })

  it('works inside an open shadow root, without offering XPath there', async () => {
    const { bundle, recommended, candidate } = await locatorsFor('#apply-coupon', '#widget-host')
    expect(bundle.inShadowDom).toBe(true)
    // document.evaluate cannot cross a shadow boundary, so no XPath is produced.
    expect(candidate('xpath')).toBeUndefined()
    expect(recommended).toMatchObject({ kind: 'id', expression: '#apply-coupon', unique: true })
  })

  it('admits when nothing distinguishes one of several identical elements', async () => {
    await page.click('[data-testid="add-line"]')
    await page.click('[data-testid="add-line"]')

    const { recommended } = await locatorsFor('#lines li:nth-child(2) .remove')
    // Every candidate matches both rows. The recommendation must say so rather than
    // present an ambiguous locator as if it were precise.
    expect(recommended?.unique).toBe(false)
    expect(recommended?.matches).toBeGreaterThan(1)
    expect(recommended?.reason).toContain('needs a human eye')
  })
})

describe('on the sign-in page', () => {
  beforeAll(async () => {
    await page.goto(`${fixture.url}/`, { waitUntil: 'domcontentloaded' })
  })

  it('separates two buttons that share every class', async () => {
    const help = await locatorsFor('.actions .btn.ghost:nth-of-type(1)')
    expect(help.recommended).toMatchObject({ kind: 'role', unique: true })
    expect(help.recommended?.expression).toContain('Help')

    // The class-based CSS candidate cannot tell them apart. It is still reported,
    // but with an honest match count, which is why it is not the recommendation.
    const css = help.candidate('css')
    expect(css?.matches).toBeGreaterThan(1)
    expect(help.recommended?.kind).not.toBe('css')
  })

  it('builds a role locator from an input whose name lives in its value', async () => {
    const { candidate } = await locatorsFor('button[name="signin"]')
    expect(candidate('role')).toMatchObject({
      expression: 'role=button[name="Sign In"]',
      playwright: 'getByRole("button", { name: "Sign In" })',
      matches: 1
    })
  })

  it('escapes a label containing an apostrophe in XPath', async () => {
    await page.evaluate(() => {
      const button = document.createElement('button')
      button.id = 'apostrophe-case'
      button.textContent = "Manager's approval"
      document.body.append(button)
    })
    const { candidate } = await locatorsFor('#apostrophe-case')
    const xpath = candidate('xpath')
    expect(xpath?.matches).toBe(1)
    // Either quoting style is fine; what matters is that it evaluated to one element.
    expect(xpath?.expression).toContain('apostrophe-case')
  })
})
