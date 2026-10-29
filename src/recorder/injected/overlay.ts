/**
 * The recorder's control bar, injected into the recorded page.
 *
 * It lives in the page rather than in the app window on purpose: clicking a button in
 * a separate window during a walkthrough would steal focus from the browser, change
 * what the page sees, and pollute the recording.
 *
 * Isolation matters here — this markup sits inside an application we do not control:
 *  - a closed shadow root, so the app's CSS cannot reach in and our CSS cannot leak out
 *  - the host carries the ignore attribute, and event retargeting means everything
 *    inside it reaches the recorder's listeners as the host, so nothing it does is
 *    ever recorded as a step
 *  - the whole bar is hidden while a screenshot is taken, so it never appears in the
 *    expected-page image
 *
 * Like the other injected modules it is serialised to source, so it must not
 * reference anything outside its own body.
 */

export interface OverlayArgs {
  /** Binding the bar calls to send commands to the driver. */
  controlBinding: string
  /** Attribute that marks this UI as recorder-owned. */
  ignoreAttribute: string
  /** Modifier combination for capture, e.g. "Shift+Meta". */
  hotkeyLabel: string
}

export function installControlBar(args: OverlayArgs): void {
  const w = window as unknown as Record<string, unknown>
  if (w['__trailmark_overlay_installed']) return
  w['__trailmark_overlay_installed'] = true

  function send(command: Record<string, unknown>): void {
    const binding = w[args.controlBinding] as ((c: unknown) => void) | undefined
    if (typeof binding !== 'function') return
    try {
      binding(command)
    } catch {
      // Losing a control command must never break the page being recorded.
    }
  }

  // The capture hotkey is installed in every frame, so it works wherever focus is,
  // but the bar itself is only drawn once, in the top document.
  document.addEventListener(
    'keydown',
    (event) => {
      const e = event as KeyboardEvent
      const modifier = e.metaKey || e.ctrlKey
      if (!modifier || !e.shiftKey) return
      const key = (e.key || '').toLowerCase()
      if (key !== 's') return
      e.preventDefault()
      e.stopPropagation()
      send({ command: 'capture' })
    },
    true
  )

  let framed: boolean
  try {
    framed = window.top !== window.self
  } catch {
    framed = true
  }
  if (framed) return

  function draw(): void {
    if (!document.body) return

    const host = document.createElement('div')
    host.setAttribute(args.ignoreAttribute, '')
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;'
    document.body.append(host)

    // Closed, so the recorded application cannot reach into the bar.
    const shadow = host.attachShadow({ mode: 'closed' })
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .bar {
          position: fixed; right: 16px; bottom: 16px;
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: 10px;
          background: #14161d; color: #e6e8ee;
          font: 500 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          box-shadow: 0 6px 24px rgba(0,0,0,.35); border: 1px solid #2a2f3d;
          user-select: none;
        }
        .dot {
          width: 9px; height: 9px; border-radius: 50%; background: #f2717b;
          animation: pulse 1.6s ease-in-out infinite;
        }
        .dot.paused { background: #e3b341; animation: none; }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
        .time { font-variant-numeric: tabular-nums; opacity: .75; min-width: 34px; }
        button {
          font: inherit; color: inherit; cursor: pointer;
          background: #232838; border: 1px solid #333a4d; border-radius: 6px;
          padding: 5px 9px;
        }
        button:hover { background: #2c3245; }
        button.primary { background: #2f5bb7; border-color: #3b6ad0; }
        button.primary:hover { background: #3767cc; }
        button.stop { background: #6d2730; border-color: #8a323d; }
        .note { display: none; gap: 6px; }
        .note.open { display: flex; }
        input {
          font: inherit; color: inherit; background: #1b1f2b;
          border: 1px solid #333a4d; border-radius: 6px; padding: 5px 8px; width: 190px;
        }
        .hint { opacity: .55; font-size: 11px; }
      </style>
      <div class="bar" part="bar">
        <span class="dot" id="dot"></span>
        <span class="time" id="time">0:00</span>
        <button class="primary" id="capture" title="Screenshot this page as the expected result of the step you just performed (${args.hotkeyLabel}+S)">Capture</button>
        <button id="note">Note</button>
        <button id="pause">Pause</button>
        <button class="stop" id="stop">Stop</button>
        <span class="note" id="noteBox">
          <input id="noteText" placeholder="Note for the last step" />
          <button id="noteSave">Add</button>
        </span>
        <span class="hint">${args.hotkeyLabel}+S</span>
      </div>
    `

    const byId = (id: string): HTMLElement | null => shadow.getElementById(id)
    const dot = byId('dot')
    const time = byId('time')
    const pauseButton = byId('pause')
    const noteBox = byId('noteBox')
    const noteText = byId('noteText') as HTMLInputElement | null

    const startedAt = Date.now()
    let paused = false

    const tick = (): void => {
      if (!time) return
      const seconds = Math.floor((Date.now() - startedAt) / 1000)
      const mm = Math.floor(seconds / 60)
      const ss = String(seconds % 60).padStart(2, '0')
      time.textContent = `${mm}:${ss}`
    }
    tick()
    const timer = window.setInterval(tick, 1000)

    byId('capture')?.addEventListener('click', () => send({ command: 'capture' }))

    byId('note')?.addEventListener('click', () => {
      noteBox?.classList.toggle('open')
      if (noteBox?.classList.contains('open')) noteText?.focus()
    })

    const saveNote = (): void => {
      const text = (noteText?.value ?? '').trim()
      if (!text) return
      send({ command: 'note', text: text.slice(0, 500) })
      if (noteText) noteText.value = ''
      noteBox?.classList.remove('open')
    }
    byId('noteSave')?.addEventListener('click', saveNote)
    noteText?.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault()
        saveNote()
      }
    })

    pauseButton?.addEventListener('click', () => {
      paused = !paused
      pauseButton.textContent = paused ? 'Resume' : 'Pause'
      dot?.classList.toggle('paused', paused)
      send({ command: paused ? 'pause' : 'resume' })
    })

    byId('stop')?.addEventListener('click', () => {
      window.clearInterval(timer)
      send({ command: 'stop' })
    })

    // Called by the driver around a screenshot, so the bar never appears in the image.
    w['__trailmark_setOverlayVisible'] = (visible: boolean): void => {
      host.style.display = visible ? '' : 'none'
    }
  }

  if (document.body) {
    draw()
  } else {
    // addInitScript runs before the document has a body.
    document.addEventListener('DOMContentLoaded', draw, { once: true })
  }
}
