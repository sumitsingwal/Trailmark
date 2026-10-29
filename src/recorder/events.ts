import { z } from 'zod'

/**
 * The recorder's wire format.
 *
 * Everything crossing the page → main boundary is parsed through these schemas.
 * Page context is untrusted: the application under test runs its own JavaScript in
 * the same realm as the injected recorder and can reach the binding we expose, so
 * nothing is believed without validation.
 *
 * Phase 1 captures a deliberately small element descriptor. The full locator bundle
 * (relative XPath, uniqueness counts, recommended locator) arrives in Phase 2 and
 * extends ElementInfo rather than replacing it.
 */

export const ElementInfoSchema = z.object({
  tag: z.string().max(40),
  /** input type, where the element has one. */
  type: z.string().max(40).optional(),
  id: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  testId: z.string().max(200).optional(),
  role: z.string().max(60).optional(),
  /** Best human-readable name: aria-label, associated label, or trimmed text. */
  label: z.string().max(300),
  /** Where the label came from, so Phase 2 can weigh locator candidates. */
  labelSource: z.enum(['aria-label', 'label', 'placeholder', 'value', 'text', 'title', 'none'])
})
export type ElementInfo = z.infer<typeof ElementInfoSchema>

/**
 * Locator candidates, built in the page at the moment of the interaction.
 *
 * `matches` is the number of elements the expression selected *then*. It has to be
 * measured at event time: by the time the driver could ask, the click may already
 * have replaced the DOM that the locator described.
 */
export const LocatorKindSchema = z.enum(['testid', 'id', 'role', 'label', 'xpath', 'css', 'name'])
export type LocatorKind = z.infer<typeof LocatorKindSchema>

export const LocatorCandidateSchema = z.object({
  kind: LocatorKindSchema,
  /** The literal selector, in the syntax named by `kind`. */
  expression: z.string().max(2000),
  /** Equivalent Playwright call, where one reads better than the raw selector. */
  playwright: z.string().max(2000).optional(),
  matches: z.number().int().nonnegative()
})
export type LocatorCandidate = z.infer<typeof LocatorCandidateSchema>

export const LocatorBundleSchema = z.object({
  candidates: z.array(LocatorCandidateSchema).max(12),
  /** Open shadow roots cannot be crossed by XPath, so xpath candidates are absent. */
  inShadowDom: z.boolean(),
  classes: z.array(z.string().max(200)).max(30)
})
export type LocatorBundle = z.infer<typeof LocatorBundleSchema>

/** Chosen by the ranking rules on the driver side, never reported by the page. */
export interface RecommendedLocator {
  kind: LocatorKind
  expression: string
  playwright?: string
  matches: number
  unique: boolean
  reason: string
}

const PageEventBase = {
  /** Milliseconds since the recording started, as measured in the page. */
  at: z.number().nonnegative(),
  url: z.string().max(4000),
  pageTitle: z.string().max(500),
  /** Set when the event came from an iframe rather than the top document. */
  frameUrl: z.string().max(4000).optional()
}

export const PageEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...PageEventBase,
    type: z.literal('click'),
    target: ElementInfoSchema,
    locators: LocatorBundleSchema.optional(),
    modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).max(4)
  }),
  z.object({
    ...PageEventBase,
    type: z.literal('input'),
    target: ElementInfoSchema,
    locators: LocatorBundleSchema.optional(),
    /** Already masked in the page when the field is sensitive — see `masked`. */
    value: z.string().max(2000),
    masked: z.boolean()
  }),
  z.object({
    ...PageEventBase,
    type: z.literal('select'),
    target: ElementInfoSchema,
    locators: LocatorBundleSchema.optional(),
    value: z.string().max(2000),
    /** The option's visible text, which is what belongs in the clickpath. */
    optionLabel: z.string().max(300)
  }),
  z.object({
    ...PageEventBase,
    type: z.literal('toggle'),
    target: ElementInfoSchema,
    locators: LocatorBundleSchema.optional(),
    checked: z.boolean()
  }),
  z.object({
    ...PageEventBase,
    type: z.literal('key'),
    key: z.enum(['Enter', 'Tab', 'Escape']),
    target: ElementInfoSchema.optional()
  })
])
export type PageEvent = z.infer<typeof PageEventSchema>

/**
 * Driver-side events. These are observed from Playwright rather than reported by the
 * page: a document that is being torn down cannot be trusted to announce its own
 * navigation, and a page that never loads cannot report anything at all.
 */
export const DriverEventSchema = z.discriminatedUnion('type', [
  z.object({
    at: z.number().nonnegative(),
    type: z.literal('navigate'),
    url: z.string(),
    pageTitle: z.string(),
    /** 'initial' for the start URL, 'in-page' for history API routing in SPAs. */
    kind: z.enum(['initial', 'load', 'in-page'])
  }),
  z.object({
    at: z.number().nonnegative(),
    type: z.literal('popup'),
    url: z.string(),
    pageTitle: z.string()
  })
])
export type DriverEvent = z.infer<typeof DriverEventSchema>

export const RecorderEventSchema = z.union([PageEventSchema, DriverEventSchema])
export type RecorderEvent = z.infer<typeof RecorderEventSchema>

/**
 * An event once the session has stamped it with its position in the recording and
 * applied the locator ranking rules.
 */
export type RecordedStep = RecorderEvent & {
  seq: number
  recommended?: RecommendedLocator
  /** Classes on the target that a build tool generated; never used as locators. */
  unstableClasses?: string[]
}

export type RecorderEventType = RecorderEvent['type']

/**
 * Commands sent from the control bar. Validated like everything else from the page:
 * the recorded application shares the realm and could call the binding itself, and a
 * forged "stop" would end someone's walkthrough.
 */
export const ControlCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('capture') }),
  z.object({ command: z.literal('pause') }),
  z.object({ command: z.literal('resume') }),
  z.object({ command: z.literal('stop') }),
  z.object({ command: z.literal('note'), text: z.string().min(1).max(500) })
])
export type ControlCommand = z.infer<typeof ControlCommandSchema>
