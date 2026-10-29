/**
 * Builds locator candidates inside the recorded page.
 *
 * Like the recorder itself, this is serialised to source by addInitScript, so it must
 * be entirely self-contained. It installs itself on `window` under the given name and
 * the recorder calls it when an interaction happens.
 *
 * It reports DOM facts only — what each expression is, and how many elements it
 * matched at that instant. Judging which candidate is the most durable is a rule, and
 * lives in locator-rules.ts on the driver side where it can be tested without a
 * browser.
 *
 * Match counts have to be taken here and now. A click may replace the DOM, so a count
 * measured later would describe a page that no longer exists.
 */

export interface LocatorBuilderArgs {
  /** Global name the recorder will call to build a bundle. */
  globalName: string
}

export function installLocatorBuilder(args: LocatorBuilderArgs): void {
  const w = window as unknown as Record<string, unknown>
  if (w[args.globalName]) return

  const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy']
  const ANCHOR_TAGS = [
    'form',
    'dialog',
    'nav',
    'main',
    'header',
    'footer',
    'section',
    'table',
    'aside'
  ]
  const MAX_TEXT = 60
  const MAX_ANCESTORS = 12
  const MAX_SCAN = 5000

  interface Candidate {
    kind: string
    expression: string
    playwright?: string
    matches: number
  }

  function quote(value: string): string {
    // XPath has no escape character; a value containing both quote styles needs concat().
    if (!value.includes("'")) return `'${value}'`
    if (!value.includes('"')) return `"${value}"`
    const parts = value.split("'").map((part) => `'${part}'`)
    return `concat(${parts.join(', "\'", ')})`
  }

  function cssQuote(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }

  function clean(text: string | null | undefined): string {
    if (!text) return ''
    return text.replace(/\s+/g, ' ').trim()
  }

  /** The node tree the element actually lives in — a shadow root, or the document. */
  function rootOf(el: Element): Document | ShadowRoot {
    const root = el.getRootNode()
    return root instanceof ShadowRoot ? root : document
  }

  function countCss(el: Element, selector: string): number {
    try {
      return rootOf(el).querySelectorAll(selector).length
    } catch {
      return 0
    }
  }

  function countXPath(el: Element, expression: string): number {
    // document.evaluate cannot see inside a shadow root, so XPath is not offered there.
    if (rootOf(el) !== document) return 0
    try {
      const result = document.evaluate(
        expression,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      )
      return result.snapshotLength
    } catch {
      return 0
    }
  }

  function testIdOf(el: Element): { attr: string; value: string } | undefined {
    for (const attr of TEST_ID_ATTRS) {
      const value = el.getAttribute(attr)
      if (value) return { attr, value }
    }
    return undefined
  }

  function roleOf(el: Element): string {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'input') {
      const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
      return 'textbox'
    }
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    return ''
  }

  /** Approximates the accessible name closely enough to compare elements by it. */
  function accessibleName(el: Element): string {
    const aria = clean(el.getAttribute('aria-label'))
    if (aria) return aria
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => rootOf(el).querySelector(`#${CSS.escape(id)}`)?.textContent || '')
        .join(' ')
      if (clean(text)) return clean(text)
    }
    const input = el as HTMLInputElement
    const tag = el.tagName.toLowerCase()
    if (
      tag === 'input' &&
      ['submit', 'button', 'reset'].includes((input.type || '').toLowerCase())
    ) {
      return clean(input.value)
    }
    return clean(el.textContent)
  }

  function labelTextOf(el: Element): string {
    const root = rootOf(el)
    if (el.id) {
      const byFor = root.querySelector(`label[for=${cssQuote(el.id)}]`)
      if (byFor) return clean(byFor.textContent)
    }
    const wrapping = el.closest('label')
    if (wrapping) return clean(wrapping.textContent)
    return ''
  }

  /** Direct text of an element, ignoring text inside nested elements. */
  function ownText(el: Element): string {
    let text = ''
    for (const node of [...el.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
    }
    return clean(text)
  }

  function scanElements(el: Element): Element[] {
    return [...rootOf(el).querySelectorAll('*')].slice(0, MAX_SCAN)
  }

  function countByRoleAndName(el: Element, role: string, name: string): number {
    return scanElements(el).filter(
      (candidate) => roleOf(candidate) === role && accessibleName(candidate) === name
    ).length
  }

  function countByLabel(el: Element, label: string): number {
    return scanElements(el).filter(
      (candidate) =>
        /^(input|select|textarea)$/.test(candidate.tagName.toLowerCase()) &&
        labelTextOf(candidate) === label
    ).length
  }

  /**
   * Nearest ancestor that can anchor a relative XPath. Chosen purely on uniqueness,
   * which is a DOM fact; whether the anchor *looks* machine-generated is judged by
   * the ranking rules on the other side.
   */
  function findAnchor(el: Element): string | undefined {
    let node = el.parentElement
    let depth = 0
    while (node && depth < MAX_ANCESTORS && node.tagName.toLowerCase() !== 'body') {
      const testId = testIdOf(node)
      if (testId && countCss(el, `[${testId.attr}=${cssQuote(testId.value)}]`) === 1) {
        return `//*[@${testId.attr}=${quote(testId.value)}]`
      }
      if (node.id && countCss(el, `#${CSS.escape(node.id)}`) === 1) {
        return `//*[@id=${quote(node.id)}]`
      }
      const tag = node.tagName.toLowerCase()
      if (ANCHOR_TAGS.includes(tag)) {
        const ariaLabel = node.getAttribute('aria-label')
        if (ariaLabel && countCss(el, `${tag}[aria-label=${cssQuote(ariaLabel)}]`) === 1) {
          return `//${tag}[@aria-label=${quote(ariaLabel)}]`
        }
      }
      node = node.parentElement
      depth += 1
    }
    return undefined
  }

  /** Predicates that might identify this element, most meaningful first. */
  function xpathPredicates(el: Element): string[] {
    const predicates: string[] = []
    const testId = testIdOf(el)
    if (testId) predicates.push(`[@${testId.attr}=${quote(testId.value)}]`)
    if (el.id) predicates.push(`[@id=${quote(el.id)}]`)

    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel) predicates.push(`[@aria-label=${quote(ariaLabel)}]`)

    const text = ownText(el)
    if (text && text.length <= MAX_TEXT) predicates.push(`[normalize-space()=${quote(text)}]`)

    const name = el.getAttribute('name')
    if (name) predicates.push(`[@name=${quote(name)}]`)

    const placeholder = el.getAttribute('placeholder')
    if (placeholder) predicates.push(`[@placeholder=${quote(placeholder)}]`)

    const type = el.getAttribute('type')
    if (name && type) predicates.push(`[@name=${quote(name)} and @type=${quote(type)}]`)

    return predicates
  }

  function buildXPath(el: Element): Candidate | undefined {
    if (rootOf(el) !== document) return undefined
    const tag = el.tagName.toLowerCase()
    const anchor = findAnchor(el)
    const prefix = anchor ? `${anchor}//` : '//'

    const predicates = xpathPredicates(el)
    let fallback: Candidate | undefined

    for (const predicate of predicates) {
      const expression = `${prefix}${tag}${predicate}`
      const matches = countXPath(el, expression)
      if (matches === 1) return { kind: 'xpath', expression, matches }
      if (matches > 1 && !fallback) fallback = { kind: 'xpath', expression, matches }
    }

    // Nothing distinguished it on its own; fall back to position among its siblings.
    const parent = el.parentElement
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === el.tagName)
      const index = siblings.indexOf(el) + 1
      if (index > 0) {
        const expression = `${prefix}${tag}[${index}]`
        const matches = countXPath(el, expression)
        if (matches === 1) return { kind: 'xpath', expression, matches }
        if (!fallback && matches > 0) fallback = { kind: 'xpath', expression, matches }
      }
    }

    return fallback
  }

  function buildCss(el: Element): Candidate | undefined {
    const tag = el.tagName.toLowerCase()
    const attempts: string[] = []

    if (el.id) attempts.push(`#${CSS.escape(el.id)}`)
    const name = el.getAttribute('name')
    if (name) attempts.push(`${tag}[name=${cssQuote(name)}]`)
    const type = el.getAttribute('type')
    if (name && type) attempts.push(`${tag}[name=${cssQuote(name)}][type=${cssQuote(type)}]`)

    const classes = [...el.classList]
    for (const cls of classes) attempts.push(`${tag}.${CSS.escape(cls)}`)
    if (classes.length > 1)
      attempts.push(`${tag}${classes.map((c) => `.${CSS.escape(c)}`).join('')}`)

    // Scoped to the nearest identifiable ancestor, which disambiguates repeated forms.
    const scope = el.closest('[id]')
    if (scope && scope !== el) {
      const scopeSelector = `#${CSS.escape(scope.id)}`
      for (const attempt of [...attempts]) attempts.push(`${scopeSelector} ${attempt}`)
      attempts.push(`${scopeSelector} ${tag}`)
    }

    let fallback: Candidate | undefined
    for (const expression of attempts) {
      const matches = countCss(el, expression)
      if (matches === 1) return { kind: 'css', expression, matches }
      if (matches > 1 && !fallback) fallback = { kind: 'css', expression, matches }
    }
    return fallback
  }

  function build(el: Element): unknown {
    const candidates: Candidate[] = []
    const tag = el.tagName.toLowerCase()

    const testId = testIdOf(el)
    if (testId) {
      const expression = `[${testId.attr}=${cssQuote(testId.value)}]`
      candidates.push({
        kind: 'testid',
        expression,
        playwright: `getByTestId(${JSON.stringify(testId.value)})`,
        matches: countCss(el, expression)
      })
    }

    if (el.id) {
      const expression = `#${CSS.escape(el.id)}`
      candidates.push({
        kind: 'id',
        expression,
        playwright: `locator(${JSON.stringify(expression)})`,
        matches: countCss(el, expression)
      })
    }

    const role = roleOf(el)
    const name = accessibleName(el)
    if (role && name && name.length <= MAX_TEXT) {
      candidates.push({
        kind: 'role',
        expression: `role=${role}[name=${JSON.stringify(name)}]`,
        playwright: `getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`,
        matches: countByRoleAndName(el, role, name)
      })
    }

    const labelText = labelTextOf(el)
    if (labelText && /^(input|select|textarea)$/.test(tag)) {
      candidates.push({
        kind: 'label',
        expression: `label=${labelText}`,
        playwright: `getByLabel(${JSON.stringify(labelText)})`,
        matches: countByLabel(el, labelText)
      })
    }

    const fieldName = el.getAttribute('name')
    if (fieldName) {
      const expression = `${tag}[name=${cssQuote(fieldName)}]`
      candidates.push({ kind: 'name', expression, matches: countCss(el, expression) })
    }

    const xpath = buildXPath(el)
    if (xpath) candidates.push(xpath)

    const css = buildCss(el)
    if (css) candidates.push(css)

    return {
      candidates: candidates.slice(0, 12),
      inShadowDom: rootOf(el) !== document,
      classes: [...el.classList].slice(0, 30)
    }
  }

  w[args.globalName] = build
}
