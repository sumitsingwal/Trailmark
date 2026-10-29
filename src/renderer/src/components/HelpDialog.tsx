import { useEffect } from 'react'
import { captureShortcutLabel } from '@shared/shortcuts'

interface Props {
  onClose: () => void
}

const MAC = navigator.userAgent.includes('Mac')

/**
 * One screen of help, opened from the top bar.
 *
 * Deliberately short: it covers what cannot be seen from the UI — where a capture
 * attaches, what is masked, where data lives — rather than restating what each button
 * says. Anything longer goes stale as soon as the UI changes.
 */
export default function HelpDialog(props: Props): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [props])

  const shortcut = captureShortcutLabel(MAC)

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Help"
      onClick={props.onClose}
    >
      <div
        className="modal__card modal__card--wide help"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="help__head">
          <h2>How Trailmark works</h2>
          <button className="icon" aria-label="Close help" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <section>
          <h3>Recording a walkthrough</h3>
          <ol>
            <li>
              Pick or create a folder for the project, then press <strong>New</strong>.
            </li>
            <li>Give the recording a name and the URL the flow starts from.</li>
            <li>
              A separate browser opens with a recorder bar. Walk through the flow as you normally
              would — every page, click, and entry is recorded.
            </li>
            <li>
              After each step whose result matters, press <strong>Capture</strong> to save a
              screenshot of the expected page.
            </li>
            <li>
              Press <strong>Stop</strong>. The recording appears in the list on the left.
            </li>
          </ol>
        </section>

        <section>
          <h3>Capturing the expected page</h3>
          <p>
            A capture attaches to the step you <em>just performed</em>. Click Sign In, wait for the
            next page, then capture — capturing before the click puts the screenshot on the step
            before it.
          </p>
          <p>
            Shortcut: <kbd>{shortcut}</kbd>, from anywhere in the recorded browser. The recorder bar
            is hidden from screenshots, and its own buttons are never recorded as steps.
          </p>
        </section>

        <section>
          <h3>Reviewing and exporting</h3>
          <p>
            Open a recording to edit the wording of each action, fill in the expected result, add
            notes, reorder or delete steps. <strong>Columns</strong> chooses which fields the table
            shows. Rename, move, or delete a recording from the ⋯ menu on its row.{' '}
            <strong>Export Excel</strong> embeds the screenshots and also saves them as PNG files
            next to the workbook.
          </p>
        </section>

        <section>
          <h3>The locator columns</h3>
          <p>
            <strong>Relative XPath</strong> is a selector the automation team can use to find the
            element. <strong>Unique?</strong> says whether it matched exactly one element on the
            page at the moment you interacted with it. &ldquo;No&rdquo; with a count means several
            elements matched — the selector needs a person to check it before it is used in a
            script.
          </p>
        </section>

        <section>
          <h3>Sign-ins</h3>
          <p>
            Each folder keeps its own browser profile, so sign in once and every recording in that
            folder starts signed in. Sign-ins are never shared between folders or with your own
            browser. To remove one, choose <strong>Forget saved sign-in</strong> when starting a new
            recording in that folder.
          </p>
        </section>

        <section>
          <h3>Your data</h3>
          <p>
            Password fields, card numbers, and similar fields are stored as <code>********</code>,
            and secrets in URLs are removed before they are saved. Notes and expected results are
            stored as you type them — keep credentials out of them. If the recorder missed a
            sensitive value, use 🔒 on that step to replace it with <code>********</code> for good.
          </p>
          <p>
            Nothing leaves this computer. Recordings, screenshots, and saved sign-ins live in{' '}
            <code>{MAC ? '~/Library/Application Support/Trailmark' : '%APPDATA%\\Trailmark'}</code>.
            Treat that folder as sensitive: saved sign-ins are live sessions.
          </p>
        </section>
      </div>
    </div>
  )
}
