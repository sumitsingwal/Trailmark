import type { LocatorBundle, LocatorCandidate, LocatorKind, RecommendedLocator } from './events.ts'

/**
 * Ranking rules for locators.
 *
 * Deliberately separated from the in-page builder: the page can report DOM facts
 * (does this selector match one element or seven?), but judging which of those facts
 * makes a durable locator is a rule, and rules belong somewhere they can be tested
 * without a browser.
 */

/**
 * Priority order, most durable first.
 *
 * This extends the order recorded in CLAUDE.md §16 with `label` inserted after
 * `role`: for form fields the visible label is what survives a redesign, and it is
 * what a reader of the clickpath recognises.
 */
export const LOCATOR_PRIORITY: readonly LocatorKind[] = [
  'testid',
  'id',
  'role',
  'label',
  'xpath',
  'css',
  'name'
]

/**
 * Class and id tokens that a build tool generated and that will change on the next
 * deploy. Offering one of these as a locator is worse than offering nothing, because
 * it looks specific while being guaranteed to rot.
 */
const GENERATED_PATTERNS: readonly RegExp[] = [
  /^(css|sc|jss|emotion|makeStyles|styled)-/i, // CSS-in-JS runtime classes
  /^[A-Za-z0-9]+_[A-Za-z0-9]+__[A-Za-z0-9]{4,}$/, // CSS modules: Button_root__2Ab3x
  /__[A-Za-z0-9]{5,}$/, // trailing module hash
  /-[a-f0-9]{6,}$/i, // hex suffix: header-a1b2c3d4
  /\d{5,}/, // long digit runs, usually record ids
  /^(?=.*[a-z])(?=.*\d)[a-z0-9]{10,}$/i // undifferentiated hash-looking token
]

export function isGeneratedToken(token: string): boolean {
  if (!token) return false
  return GENERATED_PATTERNS.some((pattern) => pattern.test(token))
}

/** The classes on an element that should not be trusted in a locator. */
export function unstableClasses(classes: readonly string[]): string[] {
  return classes.filter(isGeneratedToken)
}

function priorityOf(kind: LocatorKind): number {
  const index = LOCATOR_PRIORITY.indexOf(kind)
  return index === -1 ? LOCATOR_PRIORITY.length : index
}

function reasonFor(candidate: LocatorCandidate, unique: boolean): string {
  if (!unique) {
    return `Best available, but matches ${candidate.matches} elements — needs a human eye.`
  }
  switch (candidate.kind) {
    case 'testid':
      return 'Test id is unique and survives redesigns.'
    case 'id':
      return 'Element id is unique on the page.'
    case 'role':
      return 'Role and accessible name are unique.'
    case 'label':
      return 'Field label is unique and matches what the user sees.'
    case 'xpath':
      return 'Relative XPath anchored on the nearest stable ancestor.'
    case 'css':
      return 'CSS selector — no more durable locator was unique.'
    case 'name':
      return 'Form field name is unique within the page.'
  }
}

/**
 * Picks the locator to put in the "Recommended" column.
 *
 * A unique match always beats a more durable kind that is ambiguous: a locator that
 * selects the wrong element is not a locator. Only when nothing is unique does this
 * fall back to the least-ambiguous candidate, and it says so plainly rather than
 * presenting a guess as an answer.
 */
export function chooseRecommended(
  candidates: readonly LocatorCandidate[],
  classes: readonly string[] = []
): RecommendedLocator | undefined {
  if (candidates.length === 0) return undefined

  const generated = new Set(unstableClasses(classes))
  const usable = candidates.filter((candidate) => {
    // A CSS selector built from a generated class is a trap; drop it entirely.
    if (candidate.kind !== 'css') return true
    return ![...generated].some((cls) => candidate.expression.includes(cls))
  })
  const pool = usable.length > 0 ? usable : candidates

  const byPriority = [...pool].sort((a, b) => {
    const delta = priorityOf(a.kind) - priorityOf(b.kind)
    return delta !== 0 ? delta : a.matches - b.matches
  })

  const unique = byPriority.find((candidate) => candidate.matches === 1)
  const chosen =
    unique ??
    [...byPriority].sort(
      (a, b) => a.matches - b.matches || priorityOf(a.kind) - priorityOf(b.kind)
    )[0]

  if (!chosen) return undefined

  return {
    kind: chosen.kind,
    expression: chosen.expression,
    ...(chosen.playwright ? { playwright: chosen.playwright } : {}),
    matches: chosen.matches,
    unique: chosen.matches === 1,
    reason: reasonFor(chosen, chosen.matches === 1)
  }
}

/** Everything the export needs about one element's locators, computed in one place. */
export function summariseLocators(bundle: LocatorBundle): {
  recommended?: RecommendedLocator
  unstable: string[]
} {
  const unstable = unstableClasses(bundle.classes)
  const recommended = chooseRecommended(bundle.candidates, bundle.classes)
  return { ...(recommended ? { recommended } : {}), unstable }
}
