import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ControlCommandSchema,
  PageEventSchema,
  type DriverEvent,
  type PageEvent,
  type RecommendedLocator,
  type RecordedStep
} from './events.ts'
import { installRecorder, type InjectedArgs } from './injected/recorder.ts'
import { installLocatorBuilder, type LocatorBuilderArgs } from './injected/locator.ts'
import { installControlBar, type OverlayArgs } from './injected/overlay.ts'
import { summariseLocators } from './locator-rules.ts'
import { redactUrl } from './redact.ts'
import { captureModifierLabel } from '../shared/shortcuts.ts'

/** Name of the binding the injected recorder calls. Namespaced to avoid collisions. */
const BINDING = '__trailmark_send'
/** Elements carrying this attribute are recorder UI and are never recorded. */
const IGNORE_ATTRIBUTE = 'data-trailmark-ignore'
/** Global the locator builder installs for the recorder to call. */
const LOCATOR_GLOBAL = '__trailmark_locator'
/** Binding the control bar calls. */
const CONTROL_BINDING = '__trailmark_control'
/**
 * Cookies saved alongside a profile.
 *
 * A persistent profile keeps local storage and IndexedDB, but Chromium discards
 * *session* cookies when it closes — and plenty of enterprise applications sign you
 * in with exactly those. Saving them explicitly is what makes "sign in once per
 * project" actually hold.
 */
const COOKIE_FILE = 'trailmark-cookies.json'
/** Written under the app's previous name; still read so a sign-in is not lost. */
const LEGACY_COOKIE_FILE = 'tcg-cookies.json'

export interface RecordingSessionOptions {
  startUrl: string
  headless?: boolean
  /**
   * Chromium to drive. A packaged app passes the copy shipped inside it; leaving this
   * undefined lets Playwright use its own cache, which is right in development.
   */
  executablePath?: string
  /**
   * Directory for a persistent browser profile. When set, cookies and local storage
   * survive between recordings, so the user signs in to the application under test
   * once per project instead of once per walkthrough.
   */
  profileDir?: string
  /** Called once per validated step, in the order the session accepted them. */
  onStep: (step: RecordedStep) => void
  /** Reports events that failed validation rather than swallowing them. */
  onRejected?: (reason: string, raw: unknown) => void
  /**
   * A captured expected-page image. `afterSeq` is the step it belongs to — the one
   * the user had just performed when they pressed Capture.
   */
  onScreenshot?: (shot: ScreenshotCapture) => void | Promise<void>
  /** A note the user typed in the control bar, against the same step. */
  onNote?: (note: { text: string; afterSeq: number | null }) => void
  /** The user pressed Stop in the control bar. */
  onStopRequested?: () => void
  onPauseChanged?: (paused: boolean) => void
}

export interface ScreenshotCapture {
  data: Buffer
  atMs: number
  /** Sequence number of the step this is the expected result for, if any. */
  afterSeq: number | null
  url: string
  pageTitle: string
}

/**
 * Owns one recording: a Chromium instance, the injected recorder inside it, and the
 * event stream coming back out.
 *
 * The page → driver direction is treated as untrusted. The application under test
 * shares a realm with the injected recorder and can call the exposed binding itself,
 * so every payload is schema-validated before it becomes a step.
 */
export class RecordingSession {
  private seq = 0
  private stopped = false
  private initialNavigationEmitted = false
  /**
   * Steps are numbered the moment they are observed, but a driver-side event needs an
   * await to read the page title. Without a queue a navigation could be emitted ahead
   * of the click that caused it, which is exactly backwards in a clickpath.
   */
  private readonly pending = new Map<number, RecordedStep>()
  private nextToEmit = 0
  private paused = false
  /** Sequence of the most recently emitted step, for attaching captures and notes. */
  private lastEmittedSeq: number | null = null

  /** Null for a persistent context, which manages its own browser process. */
  private readonly browser: Browser | null
  private readonly context: BrowserContext
  readonly page: Page
  private readonly startedAt: number
  private readonly options: RecordingSessionOptions

  // Fields are assigned explicitly rather than via parameter properties: the project
  // keeps to erasable syntax so any file can be run directly by Node.
  private constructor(
    browser: Browser | null,
    context: BrowserContext,
    page: Page,
    startedAt: number,
    options: RecordingSessionOptions
  ) {
    this.browser = browser
    this.context = context
    this.page = page
    this.startedAt = startedAt
    this.options = options
  }

  static async start(options: RecordingSessionOptions): Promise<RecordingSession> {
    const startedAt = Date.now()
    const headless = options.headless ?? false
    const launchOptions = {
      headless,
      ...(options.executablePath ? { executablePath: options.executablePath } : {})
    }

    let browser: Browser | null = null
    let context: BrowserContext

    if (options.profileDir) {
      // A persistent context owns its own browser process; there is no separate
      // Browser object to manage, and closing the context shuts everything down.
      context = await chromium.launchPersistentContext(options.profileDir, {
        ...launchOptions,
        viewport: null
      })
    } else {
      browser = await chromium.launch(launchOptions)
      // A dedicated context keeps the recording's cookies and storage away from
      // anything else.
      context = await browser.newContext({ viewport: null })
    }

    if (options.profileDir) await restoreCookies(context, options.profileDir)

    // A persistent context opens with a blank page already present; reusing it avoids
    // leaving an empty tab behind.
    const existing = context.pages()[0]
    const page = existing ?? (await context.newPage())
    const session = new RecordingSession(browser, context, page, startedAt, options)
    await session.install()
    await session.attach(page)

    // Later pages (target=_blank, window.open) inherit the init script but still need
    // their navigation observed.
    context.on('page', (opened) => {
      if (opened === page) return
      void session.onPopup(opened)
    })

    await page.goto(options.startUrl, { waitUntil: 'domcontentloaded' })
    session.emitDriverEvent(session.reserve(), {
      at: 0,
      type: 'navigate',
      url: page.url(),
      pageTitle: await safeTitle(page),
      kind: 'initial'
    })
    session.initialNavigationEmitted = true

    return session
  }

  private async install(): Promise<void> {
    await this.context.exposeBinding(BINDING, (_source, raw: unknown) => {
      this.acceptPageEvent(raw)
    })

    // Order matters: the recorder calls the builder, so the builder must already be
    // installed when the first interaction happens.
    const locatorArgs: LocatorBuilderArgs = { globalName: LOCATOR_GLOBAL }
    await this.context.addInitScript(installLocatorBuilder, locatorArgs)

    await this.context.exposeBinding(CONTROL_BINDING, (source, raw: unknown) => {
      void this.handleControl(source.page, raw)
    })
    const overlayArgs: OverlayArgs = {
      controlBinding: CONTROL_BINDING,
      ignoreAttribute: IGNORE_ATTRIBUTE,
      hotkeyLabel: captureModifierLabel(process.platform === 'darwin')
    }
    await this.context.addInitScript(installControlBar, overlayArgs)

    const args: InjectedArgs = {
      bindingName: BINDING,
      startedAt: this.startedAt,
      ignoreAttribute: IGNORE_ATTRIBUTE,
      locatorGlobal: LOCATOR_GLOBAL
    }
    // Runs in every document of every page in this context, including iframes and
    // pages opened later, and re-runs after each navigation.
    await this.context.addInitScript(installRecorder, args)
  }

  private async attach(page: Page): Promise<void> {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      const url = frame.url()
      if (!url || url === 'about:blank') return
      // The initial navigation is emitted by start() once the title is settled.
      if (!this.initialNavigationEmitted) return
      if (this.paused) return
      const seq = this.reserve()
      const at = this.elapsed()
      void (async () => {
        this.emitDriverEvent(seq, {
          at,
          type: 'navigate',
          url,
          pageTitle: await safeTitle(page),
          kind: 'load'
        })
      })()
    })
  }

  private async onPopup(opened: Page): Promise<void> {
    const seq = this.reserve()
    const at = this.elapsed()
    await this.attach(opened)
    try {
      await opened.waitForLoadState('domcontentloaded')
    } catch {
      // A popup can be closed before it settles; the event below still records it.
    }
    this.emitDriverEvent(seq, {
      at,
      type: 'popup',
      url: opened.url(),
      pageTitle: await safeTitle(opened)
    })
  }

  private elapsed(): number {
    return Math.max(0, Date.now() - this.startedAt)
  }

  // --- control bar --------------------------------------------------------

  private async handleControl(page: Page, raw: unknown): Promise<void> {
    if (this.stopped) return
    const parsed = ControlCommandSchema.safeParse(raw)
    if (!parsed.success) {
      this.options.onRejected?.(parsed.error.message, raw)
      return
    }

    switch (parsed.data.command) {
      case 'capture':
        await this.capture(page)
        return
      case 'note':
        // Attaches to the step the user had just performed, like a capture does.
        this.options.onNote?.({ text: parsed.data.text, afterSeq: this.lastEmittedSeq })
        return
      case 'pause':
      case 'resume':
        await this.setPaused(parsed.data.command === 'pause')
        return
      case 'stop':
        this.options.onStopRequested?.()
        return
    }
  }

  async setPaused(paused: boolean): Promise<void> {
    if (this.paused === paused) return
    this.paused = paused
    // Gating in the page as well stops keystrokes accumulating while paused and
    // arriving in a burst on resume.
    await this.broadcastPause(paused)
    this.options.onPauseChanged?.(paused)
  }

  get isPaused(): boolean {
    return this.paused
  }

  /**
   * Takes the expected-page screenshot.
   *
   * The control bar is hidden for the duration: the image is meant to show the
   * application, and a recorder widget in the corner of every screenshot would look
   * like part of the product under test.
   */
  async capture(page: Page): Promise<void> {
    const atMs = this.elapsed()
    const afterSeq = this.lastEmittedSeq
    await setOverlayVisible(page, false)
    try {
      const data = await page.screenshot({ fullPage: true, type: 'png' })
      await this.options.onScreenshot?.({
        data,
        atMs,
        afterSeq,
        url: redactUrl(page.url()),
        pageTitle: await safeTitle(page)
      })
    } finally {
      await setOverlayVisible(page, true)
    }
  }

  /** Sets the pause flag in every frame of every page, skipping unreachable ones. */
  private async broadcastPause(paused: boolean): Promise<void> {
    await Promise.all(
      this.context.pages().flatMap((page) =>
        page.frames().map(async (frame) => {
          try {
            await frame.evaluate((flag: boolean) => {
              const setPaused = (window as unknown as Record<string, unknown>)[
                '__trailmark_setPaused'
              ]
              if (typeof setPaused === 'function') (setPaused as (v: boolean) => void)(flag)
            }, paused)
          } catch {
            // Detached or cross-origin frames cannot be reached; nothing to recover.
          }
        })
      )
    )
  }

  /** Claim this event's place in the recording before any awaiting happens. */
  private reserve(): number {
    return this.seq++
  }

  private complete(seq: number, step: Omit<RecordedStep, 'seq'>): void {
    this.pending.set(seq, { ...redactStepUrls(step), seq } as RecordedStep)
    while (this.pending.has(this.nextToEmit)) {
      const ready = this.pending.get(this.nextToEmit)!
      this.pending.delete(this.nextToEmit)
      this.nextToEmit += 1
      if (!this.stopped) {
        this.lastEmittedSeq = ready.seq
        this.options.onStep(ready)
      }
    }
  }

  private acceptPageEvent(raw: unknown): void {
    if (this.stopped || this.paused) return
    const parsed = PageEventSchema.safeParse(raw)
    if (!parsed.success) {
      this.options.onRejected?.(parsed.error.message, raw)
      return
    }
    this.complete(this.reserve(), enrichLocators(parsed.data))
  }

  private emitDriverEvent(seq: number, event: DriverEvent): void {
    this.complete(seq, event)
  }

  /** Flush half-typed fields, then tear down. Safe to call more than once. */
  async stop(): Promise<void> {
    if (this.stopped) return
    await this.flushAll()
    this.stopped = true
    if (this.options.profileDir) await saveCookies(this.context, this.options.profileDir)
    await this.context.close().catch(() => undefined)
    await this.browser?.close().catch(() => undefined)
  }

  /**
   * Keystrokes are only emitted when a field is left. Stopping mid-field would
   * otherwise silently drop the last thing the user typed.
   */
  private async flushAll(): Promise<void> {
    const pages = this.context.pages()
    await Promise.all(
      pages.flatMap((page) =>
        page.frames().map(async (frame) => {
          try {
            await frame.evaluate(() => {
              const flush = (window as unknown as Record<string, unknown>)['__trailmark_flush']
              if (typeof flush === 'function') (flush as () => void)()
            })
          } catch {
            // Detached or cross-origin frames cannot be flushed; nothing to recover.
          }
        })
      )
    )
    // exposeBinding delivers asynchronously; give flushed events a turn to arrive.
    await this.page.waitForTimeout(50).catch(() => undefined)
  }
}

/**
 * Applies the ranking rules to whatever the page reported.
 *
 * The page supplies DOM facts; which of them makes the most durable locator is
 * decided here, so the judgement is testable without a browser and stays consistent
 * between the recorder and the export.
 */
function enrichLocators(event: PageEvent): PageEvent & {
  recommended?: RecommendedLocator
  unstableClasses?: string[]
} {
  if (!('locators' in event) || !event.locators) return event
  const { recommended, unstable } = summariseLocators(event.locators)
  return {
    ...event,
    ...(recommended ? { recommended } : {}),
    ...(unstable.length > 0 ? { unstableClasses: unstable } : {})
  }
}

/**
 * Every URL on every step passes through here. A GET form submission carries whatever
 * was typed into the next URL, so redacting only navigation events would still leak
 * through the `url` stamped on ordinary page events.
 */
function redactStepUrls(step: Omit<RecordedStep, 'seq'>): Omit<RecordedStep, 'seq'> {
  const redacted: Record<string, unknown> = { ...step }
  if (typeof redacted['url'] === 'string') redacted['url'] = redactUrl(redacted['url'])
  if (typeof redacted['frameUrl'] === 'string') {
    redacted['frameUrl'] = redactUrl(redacted['frameUrl'] as string)
  }
  return redacted as Omit<RecordedStep, 'seq'>
}

/**
 * Writes the context's cookies next to its profile.
 *
 * These are session tokens in plaintext. They sit in the app's own data directory
 * alongside the profile Chromium already keeps, and the file is owner-only — but it
 * is a real trade for not signing in at the start of every walkthrough, and it is why
 * "Forget saved sign-in" exists.
 */
async function saveCookies(context: BrowserContext, profileDir: string): Promise<void> {
  try {
    const state = await context.storageState()
    writeFileSync(join(profileDir, COOKIE_FILE), JSON.stringify({ cookies: state.cookies }), {
      mode: 0o600
    })
  } catch {
    // Losing the sign-in is an inconvenience, not a reason to fail the recording.
  }
}

async function restoreCookies(context: BrowserContext, profileDir: string): Promise<void> {
  const current = join(profileDir, COOKIE_FILE)
  const file = existsSync(current) ? current : join(profileDir, LEGACY_COOKIE_FILE)
  if (!existsSync(file)) return
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { cookies?: unknown }
    if (Array.isArray(saved.cookies) && saved.cookies.length > 0) {
      await context.addCookies(saved.cookies as Parameters<BrowserContext['addCookies']>[0])
    }
  } catch {
    // A corrupt file just means signing in again.
  }
}

async function setOverlayVisible(page: Page, visible: boolean): Promise<void> {
  try {
    await page.evaluate((show) => {
      const toggle = (window as unknown as Record<string, unknown>)['__trailmark_setOverlayVisible']
      if (typeof toggle === 'function') (toggle as (v: boolean) => void)(show)
    }, visible)
  } catch {
    // No overlay in this page (or it is mid-navigation); the screenshot is still valid.
  }
}

async function safeTitle(page: Page): Promise<string> {
  try {
    return (await page.title()).slice(0, 500)
  } catch {
    return ''
  }
}
