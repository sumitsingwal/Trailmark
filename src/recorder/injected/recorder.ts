/**
 * Code that runs inside the recorded page.
 *
 * Constraints this file must respect:
 *  - `installRecorder` is serialised to source by Playwright's addInitScript, so it
 *    may not reference anything outside its own body — no imports, no closures, no
 *    module-scope constants. Everything it needs is defined inside it or passed in.
 *  - It shares a realm with the application under test, so every global it creates is
 *    namespaced `__trailmark_` and every listener is passive and capture-phase, so the page's
 *    own handlers cannot stop the recorder by calling stopPropagation.
 *  - Sensitive field values are masked here, at the source. Plaintext credentials never
 *    cross the binding, which means they cannot be leaked by anything downstream.
 */

export interface InjectedArgs {
  /** Name of the function exposed by the driver to receive events. */
  bindingName: string
  /** Epoch ms when the recording started, so every frame agrees on a time origin. */
  startedAt: number
  /** Attribute marking recorder-owned UI, whose events must never be recorded. */
  ignoreAttribute: string
  /** Global installed by the locator builder; absent means locators are skipped. */
  locatorGlobal: string
}

export function installRecorder(args: InjectedArgs): void {
  const w = window as unknown as Record<string, unknown>

  // addInitScript runs per document; re-entry would double every event.
  if (w['__trailmark_installed']) return
  w['__trailmark_installed'] = true

  const SENSITIVE_AUTOCOMPLETE = [
    'current-password',
    'new-password',
    'one-time-code',
    'cc-number',
    'cc-csc',
    'cc-exp'
  ]
  const SENSITIVE_NAME = /pass|pwd|secret|token|cvv|cvc|ssn|otp|card.?num|account.?num/i
  const MASK = '********'
  const MAX_LABEL = 200

  const IMPLICIT_ROLE: Record<string, string> = {
    a: 'link',
    button: 'button',
    select: 'combobox',
    textarea: 'textbox'
  }

  // Set by the driver when the user pauses. Gating here as well as in the driver
  // stops keystrokes accumulating while paused and surfacing on resume.
  w['__trailmark_paused'] = false
  w['__trailmark_setPaused'] = (paused: boolean): void => {
    if (paused) flushPendingInput()
    w['__trailmark_paused'] = paused
  }

  function send(event: Record<string, unknown>): void {
    if (w['__trailmark_paused'] === true) return
    const binding = w[args.bindingName] as ((e: unknown) => void) | undefined
    if (typeof binding !== 'function') return
    try {
      binding(event)
    } catch {
      // A failed send must never break the page being recorded.
    }
  }

  function now(): number {
    return Math.max(0, Date.now() - args.startedAt)
  }

  function clean(text: string | null | undefined): string {
    if (!text) return ''
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
  }

  function isIgnored(el: Element | null): boolean {
    return !!el && !!el.closest(`[${args.ignoreAttribute}]`)
  }

  function isSensitive(el: Element): boolean {
    const input = el as HTMLInputElement
    if ((input.type || '').toLowerCase() === 'password') return true
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase()
    if (SENSITIVE_AUTOCOMPLETE.some((token) => autocomplete.includes(token))) return true
    const haystack = `${el.getAttribute('name') || ''} ${el.id || ''} ${
      el.getAttribute('placeholder') || ''
    }`
    return SENSITIVE_NAME.test(haystack)
  }

  /**
   * True for a checkbox/radio, or a label that forwards clicks to one.
   *
   * Clicking one of these fires both a click and a change. Recording both would put
   * the same action in the clickpath twice ("Click Express delivery" followed by
   * "Tick Express delivery"), so the click is dropped and the toggle — which also
   * carries the resulting state — is kept.
   */
  function isToggleProxy(el: Element): boolean {
    const tag = el.tagName.toLowerCase()
    if (tag === 'input') {
      const type = ((el as HTMLInputElement).type || '').toLowerCase()
      return type === 'checkbox' || type === 'radio'
    }
    if (tag === 'label') {
      const label = el as HTMLLabelElement
      const control =
        label.control ?? (label.htmlFor ? document.getElementById(label.htmlFor) : null)
      if (control && control.tagName.toLowerCase() === 'input') {
        const type = ((control as HTMLInputElement).type || '').toLowerCase()
        return type === 'checkbox' || type === 'radio'
      }
    }
    return false
  }

  function testIdOf(el: Element): string | undefined {
    const attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy']
    for (const attr of attrs) {
      const value = el.getAttribute(attr)
      if (value) return value.slice(0, 200)
    }
    return undefined
  }

  function roleOf(el: Element): string | undefined {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit.slice(0, 60)
    const tag = el.tagName.toLowerCase()
    if (tag === 'input') {
      const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
      return 'textbox'
    }
    return IMPLICIT_ROLE[tag]
  }

  /** Text of the <label> associated with a form control, either via `for` or nesting. */
  function associatedLabel(el: Element): string {
    if (el.id) {
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (byFor) return clean(byFor.textContent)
    }
    const wrapping = el.closest('label')
    if (wrapping) return clean(wrapping.textContent)
    return ''
  }

  function describe(el: Element): Record<string, unknown> {
    const tag = el.tagName.toLowerCase()
    const input = el as HTMLInputElement

    let label = ''
    let labelSource = 'none'

    const aria = clean(el.getAttribute('aria-label'))
    const labelledBy = el.getAttribute('aria-labelledby')
    const labelledByText = labelledBy
      ? clean(
          labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ')
        )
      : ''

    if (aria) {
      label = aria
      labelSource = 'aria-label'
    } else if (labelledByText) {
      label = labelledByText
      labelSource = 'aria-label'
    } else {
      const associated = associatedLabel(el)
      const placeholder = clean(el.getAttribute('placeholder'))
      const title = clean(el.getAttribute('title'))
      const text = clean(el.textContent)
      // Buttons carry their name as value or text; fields carry theirs in a <label>.
      const valueLabel =
        tag === 'input' && ['submit', 'button', 'reset'].includes((input.type || '').toLowerCase())
          ? clean(input.value)
          : ''

      if (valueLabel) {
        label = valueLabel
        labelSource = 'value'
      } else if (associated) {
        label = associated
        labelSource = 'label'
      } else if (text && tag !== 'input' && tag !== 'select' && tag !== 'textarea') {
        label = text
        labelSource = 'text'
      } else if (placeholder) {
        label = placeholder
        labelSource = 'placeholder'
      } else if (title) {
        label = title
        labelSource = 'title'
      }
    }

    const info: Record<string, unknown> = {
      tag,
      label,
      labelSource
    }
    if (input.type) info['type'] = String(input.type).slice(0, 40)
    if (el.id) info['id'] = el.id.slice(0, 200)
    const name = el.getAttribute('name')
    if (name) info['name'] = name.slice(0, 200)
    const testId = testIdOf(el)
    if (testId) info['testId'] = testId
    const role = roleOf(el)
    if (role) info['role'] = role
    return info
  }

  /**
   * Locators must be built now, while the element is still in the DOM the user acted
   * on. A click can replace the whole page; asking afterwards would describe a page
   * that no longer exists.
   */
  function locatorsFor(el: Element): unknown {
    const builder = w[args.locatorGlobal] as ((e: Element) => unknown) | undefined
    if (typeof builder !== 'function') return undefined
    try {
      return builder(el)
    } catch {
      // A locator failure must never cost us the step itself.
      return undefined
    }
  }

  function context(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      at: now(),
      url: location.href.slice(0, 4000),
      pageTitle: (document.title || '').slice(0, 500)
    }
    // window.top can be cross-origin; a throw here means we are framed.
    let framed: boolean
    try {
      framed = window.top !== window.self
    } catch {
      framed = true
    }
    if (framed) base['frameUrl'] = location.href.slice(0, 4000)
    return base
  }

  /**
   * Typing arrives as a stream of `input` events. Recording one step per keystroke
   * would be useless in a clickpath, so keystrokes are accumulated and flushed as a
   * single step when focus leaves the field, Enter/Tab is pressed, or the recording
   * stops.
   */
  let pendingEl: Element | null = null
  let pendingValue = ''
  let pendingMasked = false

  function flushPendingInput(): void {
    if (!pendingEl) return
    const el = pendingEl
    const value = pendingValue
    const masked = pendingMasked
    pendingEl = null
    pendingValue = ''
    pendingMasked = false
    send({
      ...context(),
      type: 'input',
      target: describe(el),
      locators: locatorsFor(el),
      value,
      masked
    })
  }

  w['__trailmark_flush'] = flushPendingInput

  document.addEventListener(
    'input',
    (event) => {
      const el = event.target as Element | null
      if (!el || isIgnored(el)) return
      const tag = el.tagName?.toLowerCase()
      if (tag !== 'input' && tag !== 'textarea') return
      const type = ((el as HTMLInputElement).type || '').toLowerCase()
      // Checkboxes and radios are reported by the change handler as toggles.
      if (type === 'checkbox' || type === 'radio') return

      if (pendingEl && pendingEl !== el) flushPendingInput()
      pendingEl = el
      pendingMasked = isSensitive(el)
      pendingValue = pendingMasked
        ? MASK
        : String((el as HTMLInputElement).value || '').slice(0, 2000)
    },
    true
  )

  document.addEventListener(
    'focusout',
    (event) => {
      if (pendingEl && event.target === pendingEl) flushPendingInput()
    },
    true
  )

  document.addEventListener(
    'change',
    (event) => {
      const el = event.target as Element | null
      if (!el || isIgnored(el)) return
      const tag = el.tagName?.toLowerCase()

      if (tag === 'select') {
        flushPendingInput()
        const select = el as HTMLSelectElement
        const option = select.selectedOptions[0]
        send({
          ...context(),
          type: 'select',
          target: describe(el),
          locators: locatorsFor(el),
          value: String(select.value || '').slice(0, 2000),
          optionLabel: clean(option?.textContent)
        })
        return
      }

      const type = ((el as HTMLInputElement).type || '').toLowerCase()
      if (type === 'checkbox' || type === 'radio') {
        flushPendingInput()
        send({
          ...context(),
          type: 'toggle',
          target: describe(el),
          locators: locatorsFor(el),
          checked: !!(el as HTMLInputElement).checked
        })
      }
    },
    true
  )

  document.addEventListener(
    'click',
    (event) => {
      const raw = event.target as Element | null
      if (!raw || isIgnored(raw)) return
      // Clicking an icon inside a button should record the button, not the icon.
      const el =
        raw.closest(
          'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"]'
        ) || raw

      if (isIgnored(el)) return
      // A click that only moves focus into the field being typed in is not a step.
      if (pendingEl && pendingEl !== el) flushPendingInput()
      // The change handler will report this as a toggle; two steps for one action
      // would be noise in the clickpath.
      if (isToggleProxy(el)) return

      const modifiers: string[] = []
      const mouse = event as MouseEvent
      if (mouse.altKey) modifiers.push('Alt')
      if (mouse.ctrlKey) modifiers.push('Control')
      if (mouse.metaKey) modifiers.push('Meta')
      if (mouse.shiftKey) modifiers.push('Shift')

      send({
        ...context(),
        type: 'click',
        target: describe(el),
        locators: locatorsFor(el),
        modifiers
      })
    },
    true
  )

  document.addEventListener(
    'keydown',
    (event) => {
      const key = (event as KeyboardEvent).key
      if (key !== 'Enter' && key !== 'Tab' && key !== 'Escape') return
      const el = event.target as Element | null
      if (isIgnored(el)) return
      // Enter submits and Tab commits; either way the typed value is now final.
      flushPendingInput()
      send({
        ...context(),
        type: 'key',
        key,
        target: el && el.tagName ? describe(el) : undefined
      })
    },
    true
  )

  // A navigation discards pending keystrokes unless they are flushed first.
  window.addEventListener('pagehide', flushPendingInput, true)
  window.addEventListener('beforeunload', flushPendingInput, true)
}
