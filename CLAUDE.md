# Trailmark

> Sections marked `TBD` are still undecided — Claude should ask rather than assume.
> Resolved decisions live in §16.

## 1. The Idea

Trailmark is a desktop application for macOS and Windows that records a walkthrough of a web application
and turns it into a test-case clickpath document. The performance and automation testing teams
currently produce these clickpaths by hand in Excel; this app produces the same document as a
by-product of doing the walkthrough once.

## 2. Problem & Motivation

- **Problem:** manual clickpath preparation. Someone shadows a walkthrough, writes each step into
  a spreadsheet, screenshots pages separately, and hand-writes selectors for the automation team.
- **Who:** every performance and automation team member. Today the work is funnelled through one
  dedicated person who maintains the clickpath docs in Excel — a bottleneck and a single point of failure.
- **Why now:** the activity is mechanical and error-prone. Recording it during the walkthrough that
  already happens removes the second pass entirely.

## 3. Goals

- Record browser actions from inside the app.
- Capture URL navigation, clicks, user input, and on-demand "expected page" screenshots.
- Capture a locator bundle per element (relative XPath, id, class, name, role, text) so the output
  serves the automation team, not just the business reader.
- Review recordings in-app, organised into folders.
- Export a clickpath to Excel/CSV.

## 4. Non-Goals (v1)

- Not a test *runner* — we produce documents, we do not execute or assert against the app under test.
- No code generation (Playwright/Selenium script export) in v1. Candidate for a later phase; the
  locator data we capture is deliberately sufficient for it.
- No mobile / native-app recording. Web only.
- No cloud sync, multi-user collaboration, or server component. Everything is local.
- No recording inside the user's own Chrome profile (see §16, 2026-09-28 decision).
- No editing of the application under test.

## 5. Users & Use Cases

| User | What they want to do | Trigger |
| --- | --- | --- |
| Performance tester | Produce a clickpath doc for a business flow to script a load test | New flow enters scope for a perf cycle |
| Automation engineer | Get step-by-step actions with reliable selectors to write an automated suite | New regression flow to automate |
| Business/SME walkthrough lead | Demonstrate a flow once and have it documented automatically | Scheduled walkthrough session |
| Test lead | Review and organise clickpaths across releases | Ongoing |

Primary walkthrough (happy path):

1. Open the app, create or pick a folder (e.g. "Release 24.3 / Checkout").
2. Click **New Recording**, give it a name and a start URL.
3. The app opens a controlled Chromium window with a floating recorder bar.
4. Perform the flow normally. Every navigation, click, and input is recorded silently.
5. At each point that matters, click **Capture expected page** (or hotkey) — the screenshot attaches
   to the step just performed as its expected result.
6. Click **Stop**. The recording appears in the library.
7. Review the steps: rename the recording, file it in the right folder, edit action
   wording, fill in "expected result" text, delete stray steps, re-order them, and
   choose which fields the table shows.
8. **Export → Excel**. Hand the file to the perf/automation team.

## 6. Inputs & Outputs

- **Input:** a live web application, driven by hand in the app's controlled browser. Start URL plus
  optional saved login session per project.
- **Output:** an `.xlsx` (primary) or `.csv` clickpath, with screenshots embedded in the workbook
  and also written alongside as PNG files.

Export columns — business block first, locator block second (collapsed by default so the sheet
still reads like the manual doc):

| Block | Columns |
| --- | --- |
| Business | Step #, Action, Page, URL, Input value, Expected result, Screenshot, Notes |
| Locator | Relative XPath, Unique? (does the XPath match exactly one element) |

Nine further columns were retired from the export and the step table on 2026-10-21; the
recorder still captures their data. See §17.

Example in → out:

```
User types "user1" into the username box, clicks Sign In, then hits Capture.

| 1 | Navigate to Login          | Login | /login | —     | Login page shown | —       |
| 2 | Enter Username             | Login | /login | user1 | —                | —       |
| 3 | Click "Sign In"            | Login | /login | —     | Home page loads  | 001.png |

Locator block for step 3:
Relative XPath: //form[@id='login']//button[normalize-space()='Sign In']   Unique?: Yes
```

Rules:
- Password and other sensitive fields are **masked** — value stored as `********`, never the plaintext
  (see §16). The user can mark any field as sensitive during review.
- Recorded **URLs are redacted** by parameter name, because a GET form or an OAuth callback
  puts secrets into the URL even when the field itself was masked.
- Generated/hashed class names are flagged as unstable rather than offered as a recommended locator,
  and a CSS selector built from one is dropped from consideration entirely.
- Uniqueness is evaluated live at capture time — the count of matching elements on the page then.

## 7. Scope of v1 (MVP)

- Launch controlled Chromium from the app, at a given start URL.
- Record: navigation, click, text input, select/dropdown, checkbox/radio, key presses (Enter/Tab).
- Locator bundle + recommended-locator selection + uniqueness count per interacted element.
- Floating recorder bar: Pause / Resume / Capture expected page / Add note / Stop, plus a
  keyboard shortcut (Cmd/Ctrl+Shift+S) that works from any frame.
- Local persistence of recordings, steps, and screenshots.
- Library UI: folder tree, recordings list, step-by-step viewer with inline editing.
- Export to `.xlsx` with embedded screenshots, and to `.csv`.
- Packaged, launchable builds for macOS and Windows.

Later, maybe:

- Playwright/Selenium script export from the same recording.
- Chrome-extension capture backend for apps that can only be reached in the managed browser.
- Re-record / update an existing recording in place, with a diff against the previous version.
- Word/PDF export, configurable export templates.
- iframe and shadow-DOM aware locators (basic handling in v1, hardened later).
- Indexed locators for repeated rows (`#lines li:nth-child(2) .remove`). Today a row in a
  dynamic list reports its locator as ambiguous rather than inventing a positional path.

## 8. Tech Stack & Constraints

- **Language / runtime:** TypeScript throughout; Node.js in the Electron main process.
  Build tooling runs on Node 24 LTS (installed at `~/.local/node`); Electron bundles its
  own Node for the app itself, so the two never need to match.
- **Shell:** Electron (cross-platform desktop, single codebase for macOS + Windows).
- **UI:** React + Vite in the renderer.
- **Browser control:** Playwright, driving a bundled Chromium. Chosen for CDP-level event fidelity,
  its locator engine, full-page screenshots, and profile isolation.
- **Storage:** SQLite (better-sqlite3) for projects/recordings/steps; screenshots as PNG files on
  disk under the app data directory. No database server.
- **Export:** ExcelJS for `.xlsx` with embedded images; plain writer for `.csv`.
- **Validation:** Zod 4 schemas on the recorder event stream (renderer ↔ main ↔ browser boundary).
- **Testing:** Vitest for units; Playwright Test driving the recorder against a local fixture site.
- **Packaging:** electron-builder — `.dmg` (arm64 + x64) and NSIS `.exe`.
- **LLM / API dependencies:** none. The app is fully offline.
- **Hard constraints:**
  - Offline-capable; no telemetry; no data leaves the machine.
  - Recorded data may include customer-like test data — treat local storage as sensitive.
  - Must not require the user to weaken their own browser (no `--remote-debugging-port`, no
    `<all_urls>` extension in the user's daily browser).
  - Bundled Chromium adds roughly 150 MB per platform to the installer — accepted for reliability.

## 9. Architecture Sketch

```
┌─────────────────────────── Electron app ───────────────────────────┐
│  Renderer (React)                    Main (Node)                   │
│  ┌──────────────────┐   IPC   ┌──────────────────────────────┐     │
│  │ Library / folders│◄───────►│ RecordingService             │     │
│  │ Step viewer+edit │         │ ExportService (xlsx/csv)     │     │
│  │ Recorder controls│         │ StorageService (SQLite+files)│     │
│  └──────────────────┘         └──────────────┬───────────────┘     │
└────────────────────────────────────────────  │  ──────────────────┘
                                               │ Playwright
                                   ┌───────────▼────────────┐
                                   │ Controlled Chromium    │
                                   │  • injected recorder   │
                                   │  • floating control bar│
                                   │  • isolated profile    │
                                   └────────────────────────┘
```

- The injected recorder runs in every frame, listens at capture phase, and emits normalised events.
- Locator computation happens in-page at event time (the DOM is guaranteed to still be there),
  the bundle is sent to main, and Playwright verifies uniqueness before the step is persisted.
- Navigation, dialogs, downloads, and new tabs are observed from the Playwright side, not the page —
  page script can't be trusted to report its own teardown.
- The control bar lives in a separate overlay root, is excluded from screenshots, and its own clicks
  are never recorded as steps.

## 10. Project Structure

```
Test-Case-Generator/
├─ package.json
├─ electron.vite.config.ts
├─ src/
│  ├─ main/            # Electron main: window, IPC handlers, lifecycle, library paths
│  ├─ recorder/        # Playwright driver + injected recorder bundle
│  │  ├─ driver.ts
│  │  ├─ injected/     # runs in page context: listeners, locator builder, overlay bar
│  │  └─ events.ts     # Zod event schemas shared across boundaries
│  ├─ storage/         # SQLite schema, migrations, file layout for screenshots
│  ├─ export/          # column definitions (rows.ts), xlsx + csv writers
│  ├─ renderer/        # React UI: library, folders, step viewer, settings
│  │  └─ src/components/  # Sidebar, StepTable, NewRecordingDialog
│  └─ shared/          # types shared main ↔ renderer
├─ tests/
│  ├─ unit/
│  ├─ fixtures/site/   # local HTML app used to test the recorder deterministically
│  └─ integration/
└─ resources/          # icons, entitlements
```

Runtime data (not in repo):
```
<userData>/library.db                      # one database for the whole library
                                           # <userData> = ~/Library/Application Support/Trailmark
<userData>/recordings/<recordingId>/shots/ # PNG screenshots, one folder per recording
<userData>/profiles/<folderId>/            # persistent browser profile per project
```

Packaging inputs (not in repo): `vendor/ms-playwright/` holds the Chromium copied in by
`npm run bundle:chromium`. It is platform- and architecture-specific.

## 11. Commands

| Purpose | Command |
| --- | --- |
| Install | `npm install` then `npx playwright install chromium` |
| Run (dev) | `npm run dev` |
| Test | `npm test` |
| Type check | `npm run typecheck` |
| Verify environment | `npm run verify:env` (runs the environment checks headlessly) |
| Record (console harness) | `npm run record` (fixture site) or `npm run record -- <url>` |
| Integration tests | `npm run test:e2e` (run `npm run build` first — the UI tests drive the built app) |
| Lint / format | `npm run lint` / `npm run format` |
| Build (current OS) | `npm run build` |
| Bundle Chromium | `npm run bundle:chromium` (run by the dist scripts) |
| Render the icon | `npm run icon` to preview variants, `npm run icon -- <variant>` to install one |
| Package macOS | `npm run dist:mac` |
| Package Windows | `npm run dist:win` (must be run on Windows) |
| Release (CI) | bump `version` in package.json, then `git tag v<version> && git push origin v<version>` |

`npm run record` opens a recorder browser and prints the step stream to stdout. With no
URL it serves the bundled fixture site, so the recorder can be exercised offline.

## 12. Conventions

- TypeScript strict mode; no `any` at module boundaries.
- Every cross-process message validated with a Zod schema — never trust page-context data.
- Main process owns all disk and database access; the renderer only talks IPC.
- Injected page code is dependency-free and namespaced (`__tcg_*`) to avoid colliding with the app under test.
- Pure functions for locator building and export mapping, so they are unit-testable without a browser.
- Conventional commits; one concern per commit.

## 13. Testing Strategy

Must be covered:
- Locator builder: unique id, duplicate class, generated class, nested form, text-only button,
  iframe, shadow DOM, dynamic list item. Table-driven against the fixture site.
- Event normalisation: click vs input vs change ordering, debounced typing collapsed into one step,
  navigation boundaries, new tab, browser back.
- Sensitive-field masking: `type=password`, `autocomplete="cc-number"`, and user-marked fields never
  persist plaintext — asserted at the storage layer, not just the UI.
- The control bar never appears in a captured screenshot, and never produces a step.
- Export: column mapping, screenshot embedding, CSV escaping and formula neutralisation,
  empty recordings, reordered steps, and a screenshot deleted from disk.
- No credential reaches an exported file — asserted against the raw .xlsx and .csv bytes.
- Storage migrations round-trip, and are idempotent when a library is reopened.
- The app window renders, persists a folder across a reload, and records end to end.
- Start URL validation: bare hosts, host:port, and schemes the recorder cannot drive.
- Library ordering is stable when two recordings share a timestamp.
- A saved sign-in survives a browser restart, does not leak between projects, and is
  absent when a clean browser was asked for.

Skipped, deliberately:
- Visual regression of the app's own UI.
- Cross-browser recording (Chromium only in v1).
- Real third-party sites in tests — the fixture site keeps tests deterministic and offline.

## 14b. Reviewer feedback (2026-09-29)

- Navigation after a form submission is recorded as its own step. Confirmed as wanted —
  the URL change is part of the clickpath.
- A recording can be renamed and moved between folders after the fact (2026-09-30).
- Those actions belong on the recording's row in the left panel, in a three-dot menu,
  not on the opened recording (2026-09-30).

## 14. Open Questions

- Which apps under test are behind SSO, and do any use a hardware key or device-trust check that
  would fight an isolated browser profile?
- Does the team have an existing Excel clickpath template the export must match column-for-column?
- Should folders map to releases, applications, or business domains?
- Is there an internal code-signing certificate available for the Windows build, and an Apple
  Developer account for notarisation? Without these, installers will warn on first launch.
- Retention: should recordings expire, and does anything prevent test data sitting on a laptop?
- Multiple tabs / popups in scope for v1 flows, or rare enough to defer?
- The project path contains a space (`Job Prep`). Harmless today because every native
  dependency is Node-API based, but `node-gyp` cannot compile from source under such a
  path. Worth moving the project to a space-free path before adding any dependency that
  needs source compilation.

## 15. Working Agreement (notes to Claude)

- Ask before adding a new dependency.
- Keep changes scoped to what I asked for; flag adjacent problems instead of fixing them silently.
- Prefer small, reviewable steps over large rewrites.
- Update this file when a `TBD` gets resolved or a decision changes.

## 16. Decision Log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-09-28 | Project started; CLAUDE.md scaffolded | Capture the idea and constraints before writing code |
| 2026-09-28 | Record via app-launched Playwright Chromium, not a browser extension or CDP attach to the user's Chrome | Most reliable capture (CDP-level events, locator engine, full-page shots) and most secure: isolated profile, no `<all_urls>` permission over the user's daily browsing, no open debug port exposing an authenticated browser to any local process |
| 2026-09-28 | Export carries both a business block and a locator block, including relative XPath and unique identifiers | One document serves both the performance and automation teams; removes the hand-written selector pass |
| 2026-09-28 | Recommended-locator priority: test-id → id → role+name → relative XPath → CSS, with a live uniqueness count | Stability order reflects what survives UI change; the count tells the automation team when a locator is ambiguous |
| 2026-09-28 | Screenshots are manual only, via a Capture button and hotkey; attach to the preceding step | User's call — auto-capture per action bloats recordings and Excel files; the marked moments are the ones that reach the doc |
| 2026-09-28 | Recorder control bar is injected into the recorded browser window, excluded from capture and from the step stream | Clicking a button in the app window would steal focus mid-walkthrough and pollute the recording |
| 2026-09-28 | Password/sensitive fields masked at the storage layer | Recording keystrokes otherwise writes credentials to disk in plaintext |
| 2026-09-28 | Phase 0 scaffold: Electron + electron-vite + React + TypeScript, packaging config first | Native-module ABI, Chromium bundling, and signing only break in packaged builds — surfacing them on day one rather than at ship time |
| 2026-09-28 | Renderer runs with context isolation on and no Node integration | It will eventually render content derived from recorded pages; treat it as untrusted from the start |
| 2026-09-28 | Windows installers built on Windows or in CI, not cross-built from macOS | NSIS cross-building needs Wine and is a known source of silent packaging differences |
| 2026-09-28 | Node 24.21.0 LTS installed from the official tarball into `~/.local/node` | No admin rights, no system directories touched, trivially removable; Electron ships its own Node so no version juggling is needed for this project |
| 2026-09-28 | Vite pinned to 7.x, TypeScript to 6.0.x | Upper bounds imposed by peers, not preference: `electron-vite@5` accepts Vite ≤7, and `typescript-eslint@8` caps TypeScript below 6.1 |
| 2026-09-28 | `better-sqlite3` v13 kept despite the node-gyp space-in-path error | It is Node-API based and ships per-platform prebuilds, so it loads unchanged under Electron; verified passing in both dev and packaged runs |
| 2026-09-28 | Added `--smoke` mode to the main process, exposed as `npm run verify:env` | Makes the Phase 0 environment panel assertable in CI instead of requiring a human to look at a window |
| 2026-09-28 | `app.setName()` called before first `getPath('userData')` | Keeps dev and packaged runs pointed at the same app data directory, so recordings do not scatter under "Electron" in development |
| 2026-09-28 | Phase 1: recorder split into an injected page script and a Playwright-side driver | Page script sees real user intent (labels, typing); the driver sees what a torn-down document cannot report (navigation, new tabs) |
| 2026-09-28 | Every payload from the page is Zod-validated before becoming a step | The app under test shares a realm with the injected recorder and can call the exposed binding itself; a forged event must not enter a clickpath |
| 2026-09-28 | Typing is accumulated and flushed on blur / Enter / Tab / stop, not recorded per keystroke | One step per character is useless in a clickpath; the flush-on-stop case prevents silently losing a half-typed field |
| 2026-09-28 | Steps take their sequence number when observed, and are emitted through an ordering queue | Driver events need an await to read the page title, which would otherwise let a navigation be recorded before the click that caused it |
| 2026-09-28 | URL redaction added after an integration test caught a leak | The fixture login form submits by GET, so masked field values reappeared in the next URL. Masking fields is not sufficient; URLs are redacted by parameter name |
| 2026-09-28 | Codebase restricted to erasable TypeScript syntax, with `.ts` extensions on relative imports | Lets Node run recorder files directly (`npm run record`) with no extra runner dependency; enforced by `erasableSyntaxOnly` |
| 2026-09-28 | Phase 2 split: the page reports DOM facts, the driver applies ranking rules | Match counts need a live DOM, but "which locator is most durable" is a rule — keeping it out of the page makes it testable without a browser and keeps recorder and export consistent |
| 2026-09-28 | Locator match counts are measured in the page at interaction time, not verified later by Playwright (refines §9) | A click can replace the DOM; a count taken afterwards would describe a page that no longer exists |
| 2026-09-28 | Locator priority extended to test-id → id → role+name → **label** → relative XPath → CSS | For form fields the visible label is both durable and what a clickpath reader recognises |
| 2026-09-28 | A unique lower-priority locator beats an ambiguous higher-priority one | A locator that selects the wrong element is not a locator, whatever its pedigree |
| 2026-09-28 | Ambiguity is reported, never papered over | Where nothing distinguishes an element, the recommendation states the match count and says it needs a human eye, rather than presenting a guess as precise |
| 2026-09-28 | Clicks on checkboxes/radios (and labels forwarding to them) are dropped in favour of the toggle | Found in a demo run: one tick was producing both "Click Express delivery" and "Tick Express delivery" |
| 2026-09-28 | One library database for all recordings, not one per recording (supersedes the §10 sketch) | The library view queries across recordings — by folder, newest first, with step counts — which a database per recording cannot serve without reading every file |
| 2026-09-28 | Screenshots stay as PNG files on disk; the database holds only their names | Keeps the database small and fast, and leaves the images usable without the app |
| 2026-09-28 | Each step is appended in its own committed transaction as it arrives | A walkthrough runs for many minutes; a crash at minute 18 should cost the last step, not the recording |
| 2026-09-28 | Masking and URL redaction repeat at the storage boundary, reporting violations rather than scrubbing silently | It is the only place "no plaintext on disk" can be asserted as a property; a future import or a recorder bug must not be able to bypass it. A test reads the raw .db bytes to prove it |
| 2026-09-28 | Steps carry both `seq` (capture order, immutable) and `position` (display order, editable) | Phase 5 reordering must not corrupt the record of what actually happened |
| 2026-09-28 | Library ordering breaks ties on rowid | Two recordings created in the same millisecond shared a created_at and listed in arbitrary order — found by a test that had been passing on timing luck |
| 2026-09-28 | Control bar lives in a closed shadow root inside the recorded page | The bar sits inside an application we do not control: closed keeps the app's CSS out and ours in, and stops the page reading or altering the recorder's UI. Event retargeting makes everything inside it arrive at our listeners as the ignore-marked host, so it is never recorded |
| 2026-09-28 | The bar is hidden for the duration of each screenshot | An expected-page image is meant to show the application; a recorder widget in the corner of every screenshot would read as part of the product under test |
| 2026-09-28 | Capture shortcut is handled in the page, in every frame, rather than as an OS-level shortcut | The recorded browser has focus during a walkthrough, and an in-page listener reaches every frame. An Electron global shortcut becomes worthwhile once the app window is involved (Phase 5/7) |
| 2026-09-28 | Captures and notes attach to the last emitted step, by sequence number | That is the action the user had just performed when they pressed the button, which is what "expected result" means in the clickpath |
| 2026-09-28 | Pause is gated in both the driver and the page | The driver decides authoritatively, but gating in the page too stops keystrokes accumulating while paused and arriving in a burst on resume |
| 2026-09-28 | Screenshot files are written before their database row is inserted | An image with no row is recoverable clutter; a row pointing at a file that was never written would break the export |
| 2026-09-28 | All app behaviour lives in LibraryService, with no Electron imports; IPC handlers are thin adapters | Lets live recording, validation, and review logic be tested against a real database and a stub session, without booting a window — 28 unit tests that would otherwise need Electron |
| 2026-09-28 | Screenshots are served to the renderer over a custom `tcg-media:` scheme | file:// from a renderer is a security hole and base64 through IPC would re-encode megabytes on every render. The handler resolves strictly inside the media directory, so traversal fails on the path check |
| 2026-09-28 | Editable cells keep a local draft and save on blur | Saving per keystroke would write to the database on every character; re-rendering from props mid-edit would fight the cursor |
| 2026-09-28 | Folders in a cycle are surfaced at the top level rather than skipped | A bad parent reference made them unreachable from the root, so they vanished from the sidebar while still occupying the database. Found by a unit test written for the case |
| 2026-09-28 | Start URL rejects unusable schemes by name, while treating host:port as a host | `javascript:` was being rejected for the wrong reason — the scheme check never ran, because it required `://`. `localhost:3000` must keep working |
| 2026-09-28 | The app UI is tested by driving the built bundle through Playwright's Electron support | No new dependency, and it exercises what actually ships rather than the sources |
| 2026-09-28 | Both export formats are built from one pure row-mapping module | Excel and CSV would otherwise drift apart; the mapping is also then testable without reading spreadsheets back |
| 2026-09-28 | Excel freezes the business columns and groups the locator block, collapsed | The sheet still reads like the manual clickpath for a business reviewer, and the automation team expands one outline to get selectors |
| 2026-09-28 | CSV neutralises values starting with =, +, -, or @ | Those cells come from pages we do not control, and Excel executes them as formulas on open |
| 2026-09-28 | Screenshots are embedded *and* copied next to the exported file | Reviewers paste images into tickets, and a workbook is an awkward place to get one back out of. `embedScreenshots: false` produces a small workbook that references the copies |
| 2026-09-28 | Full-page screenshots are scaled for display only, never re-encoded | A capture can be twenty thousand pixels tall; the row height is set to the drawn size while the image data is left alone |
| 2026-09-28 | Export asks for a destination via the OS save dialog, then reveals the file | Writing to a location chosen for the user is worse than asking, and opening Excel uninvited is worse still |
| 2026-09-28 | Chromium is copied into the app at package time and resolved from `process.resourcesPath` | Playwright's default is a per-user cache that only exists where `playwright install` has been run, so a build handed to a colleague could not record. The packaged env check now fails loudly if no browser was bundled |
| 2026-09-28 | Installers target the host architecture only | The bundled browser is platform- and architecture-specific: an Intel dmg built on Apple Silicon would ship an arm64 browser that cannot run. Other platforms must be built on those platforms, or in CI |
| 2026-09-28 | Persistent browser profile per folder, not per recording | A folder is a project, and signing in once per project is the point |
| 2026-09-28 | Session cookies are saved beside the profile and restored on the next run | Found by a test: a persistent profile keeps local storage but Chromium discards session cookies on close, and plenty of enterprise applications sign you in with exactly those. The file holds live tokens, is written owner-only, and is why "Forget saved sign-in" exists |
| 2026-09-28 | Signing and notarisation are driven only by environment variables | No credential is committed; with none set the build is unsigned and warns on first launch |
| 2026-09-29 | Excel locator columns are grouped but no longer hidden | Reported by the reviewer: the collapsed outline made the block look like missing data. The data was always there; being able to see it matters more than a tidy default |
| 2026-09-29 | The Screenshot column holds a path into the copied screenshots folder, not a bare file name | CSV cannot embed an image, so the cell has to lead the reader to the file |
| 2026-09-29 | The step table's columns are chosen by the reviewer and remembered | A recording carries more fields than fit on screen; presets cover the clickpath reader and the automation reader without forcing one compromise |
| 2026-09-29 | The app and the export share one locator-detail extraction | Otherwise the screen and the spreadsheet would eventually disagree about the same step |
| 2026-09-30 | A recording's name and folder are editable from the review screen | The name typed before a walkthrough is a guess; the useful one is known afterwards. Recordings also need refiling once there are a few of them. The service methods existed since Phase 5 — only the UI was missing |
| 2026-09-30 | Moving a recording follows it: the sidebar selects the destination folder | Otherwise the detail pane shows a recording the visible list no longer contains |
| 2026-09-30 | Moving is refused while that recording is live | Sign-in profiles are per folder, so a mid-recording move would file its saved session under the folder it left |
| 2026-09-30 | Rename / Move to / Delete moved into a three-dot menu on each row in the sidebar, and removed from the detail header | Reviewer's call, and the better pattern: the actions work without opening the recording first, and one place to do them cannot disagree with a second |
| 2026-09-30 | Deleting a recording now asks for confirmation, naming what will be lost | It was unguarded before, and a hover menu makes a misclick much easier. Cancel takes focus so Enter on reflex does nothing |
| 2026-09-30 | The row menu is positioned with `position: fixed` against the button's rectangle | The recordings list scrolls, and a popover laid out inside it is clipped by the overflow |
| 2026-09-30 | Deleting a folder now confirms first, naming the recordings and nested folders at risk | Reported by the reviewer as inconsistent with recordings, and it was the wrong way round: a folder deletion is the more destructive of the two |
| 2026-09-30 | Folder deletion gathers descendants explicitly and deletes them | `parent_id` carries no foreign key, so the database never cascaded folder deletion. A child folder outlived its parent and — because orphans are shown at the top level — resurfaced there as if it had been moved. Its recordings, screenshots, and saved sign-in stayed too |
| 2026-09-30 | Deleting a folder removes its saved sign-in profile | Session tokens were being left on disk with nothing referencing them |
| 2026-09-30 | A live recording anywhere beneath a folder blocks its deletion, not only one directly in it | The old check looked at the folder itself, so deleting a grandparent could pull the ground out from under a running session |
| 2026-09-30 | Renamed from the placeholder Test-Case-Generator to **Trailmark** | The trail of steps, and the marks placed with Capture. Distinctive, no collision in the QA tooling space, and it reads properly in a title bar and a bundle id |
| 2026-09-30 | A one-time migration moves the app data directory from the old product name | `app.setName()` decides where userData lives, so a rename relocates it and every recording, screenshot, and saved sign-in would appear to have vanished. The migration never overwrites an entry already present at the destination |
| 2026-09-30 | The migration runs before the environment check, not only before the library opens | Found while testing it: the check opens the library, so on the smoke path it created an empty one at the new location and blocked the real one from moving |
| 2026-09-30 | Only the app's own data migrates; Chromium and Electron caches are left behind | They are disposable and rebuilt on demand, and carrying stale cache state under a new name buys nothing |
| 2026-09-30 | Internal `__tcg_*` globals, `data-tcg-ignore`, the `tcg-media:` scheme, and the cookie file were renamed too | They stood for the placeholder name. The cookie file is still read under its old name so a saved sign-in is not silently lost |
| 2026-09-30 | App icon is a **TM** monogram over a dotted trail, on the app's own accent blue | Letters keep it legible at 32px, and the trail beneath is what separates it from reading as a ™ trademark badge — a trademark symbol never has one |
| 2026-09-30 | The icon is described in HTML and rendered with the Chromium Playwright already provides | No image library or design tool is added to the project, and the source of the icon is editable text that lives with the code |
| 2026-10-21 | Export and step table reduced to the Relative XPath and Unique? in the locator block; Element dropped from the business block | Reviewer's call after reading real exports: the other columns were not going to be used. Element repeated what the Action already says ("Click "Sign In"") |
| 2026-10-21 | The retired columns are hidden, not uncaptured — the recorder still records the full locator bundle | Relative XPath anchors on test-id and id, and sensitive-field masking reads name and id, so those attributes are read regardless. Keeping the rest costs a few hundred bytes a step; dropping it would leave every recording from now on without it if the columns are ever wanted back. See §17 |
| 2026-10-21 | Unique? now describes the Relative XPath, not the recommended locator | The recommended locator is no longer shown; the uniqueness column has to describe the locator the reader actually sees |
| 2026-10-29 | In-app help: one short Help panel (top bar `?`, and a link on the empty detail pane), plus hints where the UI is ambiguous — empty states, the Capture tooltip, the per-folder sign-in in New Recording, and header tooltips on the locator columns | The app exists to remove a one-person bottleneck, so colleagues must be able to pick it up cold, and it is offline with no docs site. The help covers only what the UI cannot show — where a capture attaches, the shortcut, what is masked, where data lives — because a longer manual would go stale with every UI change. No onboarding tour until a real user's confusion says what it should cover |
| 2026-10-29 | The capture shortcut's label lives in `src/shared/shortcuts.ts`, read by both the recorder bar and the help | So the help cannot name a shortcut the recorder no longer has |
| 2026-10-29 | A reviewer can mark an input or dropdown step as sensitive (🔒 on the row), which was promised in §6 but missing | Automatic masking matches by field type and name, so a customer reference in an ordinary text box was stored in plain text with no way to remove it |
| 2026-10-29 | Marking is permanent: the value is overwritten, not hidden, in the input column, the stored event, and any text on the step that quotes it | Hiding would leave the plaintext on disk, which is the thing being fixed. The confirmation says so, and that exported files and screenshots are not touched |
| 2026-10-29 | Marking also redacts the field's parameter, by its `name`, from every URL in the recording | A GET form carries the value into the next page's address — the same leak the 2026-09-28 URL redaction was added for |
| 2026-10-29 | `secure_delete` is on, and the WAL is checkpointed and truncated after a mark | Otherwise the overwritten row survives in free pages or WAL frames. A test reads the raw .db, -wal and -shm bytes while the library is still open |
| 2026-10-29 | Marking is refused while that recording is live | The form may not have been submitted yet, so the URL carrying the value would arrive after the redaction ran |
| 2026-10-29 | Installers are built by GitHub Actions (`.github/workflows/release.yml`) on a `v*` tag push and attached to a GitHub Release; the repository is public | One runner per platform and architecture (Apple Silicon Mac, Intel Mac, Windows) is the only way to get each installer the right bundled Chromium without owning all three machines. Installers never go into git history |
| 2026-10-29 | The release fails if the tag does not match `package.json`'s version | Otherwise a `v0.2.0` release could ship installers that call themselves 0.1.0 |
| 2026-10-29 | Installer file names always carry platform and arch (`Trailmark-0.1.0-mac-arm64.dmg`, `Trailmark-0.1.0-win-x64-setup.exe`) | electron-builder's default leaves the arch off the Intel dmg, which is ambiguous next to the arm64 one on a release page |

## 17. Removed Functionality

Retired, not deleted: the data behind each of these is still captured and stored with
every step, so recordings made since keep it. To restore a column, add it back to
`EXPORT_COLUMNS` in `src/export/rows.ts` and `STEP_COLUMNS` in
`src/shared/step-columns.ts`, a case to `StepTable.tsx`, and the field to `locatorDetails`
and `StepDto.locator`. The "Where it came from" column says which stored field to read.

| Removed | Date | Where it came from | Why |
| --- | --- | --- | --- |
| Element (business block) | 2026-10-21 | `step.elementLabel` | Repeats the Action text |
| Recommended locator | 2026-10-21 | `step.recommended` / `recommendedExpression` — ranked test-id → id → role → label → XPath → CSS | Not expected to be used by the team |
| Locator type | 2026-10-21 | `recommendedKind` | Only meaningful alongside the recommended locator |
| ID | 2026-10-21 | `target.id` | Not expected to be used |
| Name | 2026-10-21 | `target.name` | Not expected to be used |
| Test ID | 2026-10-21 | `target.testId` | Not expected to be used |
| Class | 2026-10-21 | `locators.classes`, generated ones marked "(generated)" | Not expected to be used |
| CSS | 2026-10-21 | `locators.candidates` kind `css`, with match count | Not expected to be used |
| Playwright | 2026-10-21 | `recommended.playwright`, else the role / test-id candidate | Not expected to be used; relevant again if Playwright script export (§7) is picked up |
