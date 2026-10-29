# Trailmark

Record a walkthrough of a web application once and get a test-case clickpath in Excel,
with steps, screenshots, and selectors. A desktop app for macOS and Windows that runs
fully offline.

Named for what it captures: the trail through an application, and the marks you place
along it.

## Why

Performance and automation teams write clickpaths by hand: someone shadows a
walkthrough, types each step into a spreadsheet, takes screenshots separately, and
writes selectors for the automation team afterwards. Trailmark records those steps while
the walkthrough happens, so that second pass disappears.

## What it does

- **Records in a controlled browser.** Navigation, clicks, typing, dropdowns,
  checkboxes, radios, and Enter/Tab/Escape, including inside iframes, new tabs, and
  open shadow roots. Typing becomes one step per field, not one per keystroke.
- **Captures expected pages on demand.** Press **Capture** (or ⌘⇧S / Ctrl+Shift+S) after
  a step and the screenshot becomes that step's expected result. The recorder bar never
  appears in screenshots and its clicks are never recorded.
- **Gives the automation team a selector.** Each step gets a relative XPath plus a
  **Unique?** flag: whether it matched exactly one element when the step was recorded.
- **Lets you review before you share.** Organise recordings into folders, edit the wording
  of each action, write expected results, add notes, reorder or delete steps, and choose
  which columns the table shows.
- **Exports to Excel or CSV.** Excel embeds the screenshots, freezes the business columns,
  and groups the locator columns. Both formats also copy the screenshots next to the file
  as PNGs.
- **Remembers sign-ins per project.** Each folder keeps its own browser profile, so you
  sign in to the application under test once per project rather than once per walkthrough.

### Example output

```
| # | Action                     | Page  | URL    | Input value | Expected result | Screenshot |
| 1 | Open Login                 | Login | /login | —           | Login page shown | —          |
| 2 | Enter "user1" in Username  | Login | /login | user1       | —               | —          |
| 3 | Enter password in Password | Login | /login | ********    | —               | —          |
| 4 | Click "Sign In"            | Login | /login | —           | Home page loads | 001.png    |

Locator block for step 4:
Relative XPath: //form[@id='login']//button[normalize-space()='Sign In']    Unique?: Yes
```

## Privacy and data handling

Recordings can contain customer-like test data, so Trailmark treats local storage as
sensitive:

- **Nothing leaves the machine.** No server, no telemetry, no network calls of its own.
- **Sensitive fields are masked before they are saved.** This covers passwords, card
  numbers, one-time codes, and fields named like them. They are stored as `********`,
  never as plaintext.
- **Secrets are stripped from URLs.** Tokens, codes, and similar parameters are redacted
  by name, because a GET form or an OAuth callback can put them in the next URL.
- **Missed values can be masked afterwards.** Use 🔒 on a step. This overwrites the value
  for good, including any later URL that carried it.
- **Your own browser is never touched.** Recording happens in a separate, isolated
  Chromium. There is no extension and no debugging port.

Data lives in `~/Library/Application Support/Trailmark` on macOS and
`%APPDATA%\Trailmark` on Windows: one `library.db`, a screenshot folder per recording,
and a browser profile per folder. Saved sign-ins are live sessions, so treat that
directory accordingly. **Forget saved sign-in** in the New Recording dialog removes one.

## Using it

1. Create a folder for the project, for example `Release 24.3 / Checkout`.
2. Press **New**, then enter a name and a start URL.
3. Walk through the flow in the browser that opens. Press **Capture** after each step
   whose result matters.
4. Press **Stop**, then review the steps in the app.
5. Choose **Export Excel** or **CSV**.

The `?` in the app's top bar opens a one-page guide.

## Development

### Prerequisites

- Node.js 22.12 or later (developed on 24 LTS)
- Playwright's Chromium, installed with `npx playwright install chromium`

### Getting started

```bash
npm install
npx playwright install chromium
npm run dev
```

`npm run record` exercises the recorder without the app. It opens a recorder browser
against the bundled fixture site, or against a URL you pass (`npm run record -- <url>`),
and prints the step stream to the terminal.

### Commands

| Purpose | Command |
| --- | --- |
| Run (dev) | `npm run dev` |
| Unit tests | `npm test` |
| Integration tests | `npm run build && npm run test:e2e` |
| Type check | `npm run typecheck` |
| Lint / format | `npm run lint` / `npm run format` |
| Verify environment | `npm run verify:env` |
| Recorder console harness | `npm run record` |
| Build | `npm run build` |
| Package for macOS | `npm run dist:mac` |
| Package for Windows | `npm run dist:win` (run on Windows) |
| Render the app icon | `npm run icon` |

The integration tests drive the built app, which is why they need `npm run build`
first. All tests run offline against a local fixture site in `tests/fixtures/site/`.

### Stack

Electron, React and Vite, TypeScript, Playwright (bundled Chromium), SQLite via
better-sqlite3, ExcelJS, Zod, and Vitest.

### Project layout

```
src/
  main/        Electron main process: window, IPC, library service
  recorder/    Playwright driver, plus the script injected into recorded pages
  storage/     SQLite schema, migrations, screenshot files
  export/      Column mapping, plus the .xlsx and .csv writers
  renderer/    React UI
  shared/      Types and helpers shared by main and renderer
tests/
  unit/        Vitest, no browser needed
  integration/ Recorder and app UI, driven by Playwright
  fixtures/    The local test site
```

## Packaging

```bash
npm run dist:mac     # produces release/Trailmark-*.dmg
npm run dist:win     # produces the NSIS installer; run on Windows
```

The installer bundles its own Chromium (about 150 MB), so it works on a machine that has
never had Playwright installed. That browser is platform- and architecture-specific,
so build each target on the platform it is for, or in CI. Don't cross-build.

Builds are unsigned unless these environment variables are set (nothing is committed):

| Platform | Variables |
| --- | --- |
| macOS signing | `CSC_LINK`, `CSC_KEY_PASSWORD` |
| macOS notarisation | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows signing | `CSC_LINK`, `CSC_KEY_PASSWORD` |

An unsigned build shows a warning on first launch.

## Roadmap

Not in v1, but candidates for later:

- Playwright and Selenium script export from a recording
- Re-recording a flow in place, with a diff against the previous version
- Word and PDF export, and configurable export templates
- Indexed locators for rows in repeated lists

## Further reading

[CLAUDE.md](./CLAUDE.md) holds the full product brief, architecture, testing strategy, and
a log of every design decision and the reason behind it.

## License

Not licensed for redistribution (`UNLICENSED` in `package.json`). All rights reserved.
