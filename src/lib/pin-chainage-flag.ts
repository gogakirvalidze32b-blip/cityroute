/**
 * Trigger authority for PIN audio: the kilometre (chainage) trigger or the
 * legacy GPS-proximity/hybrid trigger. Exactly ONE of them is active per route
 * (ExamDriveSession returns before the legacy path when chainage is active).
 *
 *  Vercel PREVIEW builds   → chainage is the ACTIVE trigger for Routes 1–4 by
 *                            default. Optional build-time override:
 *                              VITE_PIN_CHAINAGE_TRIGGER_ROUTES=route-2,route-4  (subset)
 *                              VITE_PIN_CHAINAGE_TRIGGER_ROUTES=none             (all legacy)
 *  Production builds,      → legacy trigger, hard-wired: the activation code is
 *  local dev, plain builds   removed at build time (production) or never reached.
 *
 * Emergency rollback (any environment, only ever DISABLES chainage, and wins
 * over every other setting):
 *   open the app with  ?pinTrigger=legacy   → legacy trigger for this browser tab
 *   open the app with  ?pinTrigger=chainage → clears the rollback again
 * The choice is kept in sessionStorage so it survives navigation and reloads in
 * that tab, and is gone when the tab is closed.
 */

export const CHAINAGE_TRIGGER_ROLLOUT_ORDER = ['route-2', 'route-4', 'route-1', 'route-3'] as const

/**
 * True in `npm run dev` and Vercel Preview builds only. Field diagnostics (GPS
 * trace recorder, per-fix [PIN KM] / [ROUTE MATCH] logs) and the trigger flag
 * are gated on it. `import.meta.env.VERCEL_ENV` is a build-time constant
 * (vite.config.ts `define`), so production bundles fold this to `false`.
 */
export const FIELD_DIAGNOSTICS_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VERCEL_ENV === 'preview'

/**
 * True only in Vercel Preview builds — the ONLY environment where the
 * kilometre trigger may become the active PIN audio trigger. Production and
 * local builds fold this to `false` at build time.
 */
export const CHAINAGE_ACTIVATION_ALLOWED: boolean = import.meta.env.VERCEL_ENV === 'preview'

export const PIN_TRIGGER_OVERRIDE_STORAGE_KEY = 'cityroute-pin-trigger-override'
export const PIN_TRIGGER_URL_PARAM = 'pinTrigger'

/** Values of VITE_PIN_CHAINAGE_TRIGGER_ROUTES that switch every route to legacy. */
const ALL_LEGACY_VALUES = new Set(['none', 'legacy', 'off'])

export type ChainageTriggerGateInput = {
  /** Activation allowed (Vercel Preview build). */
  readonly activationAllowed: boolean
  /** Raw VITE_PIN_CHAINAGE_TRIGGER_ROUTES value (unset = all four routes). */
  readonly routesVariable: string | undefined
  /** `?pinTrigger=` URL value, if any. */
  readonly urlOverride: string | null
  /** Stored rollback for this tab, if any. */
  readonly storedOverride: string | null
}

/** True when the `?pinTrigger=legacy` emergency rollback is in force. */
export function isLegacyRollback(urlOverride: string | null, storedOverride: string | null): boolean {
  return (urlOverride ?? storedOverride) === 'legacy'
}

/** Pure gate: which routes use the kilometre trigger. Fails closed. */
export function chainageTriggerRoutesFor(input: ChainageTriggerGateInput): Set<string> {
  if (!input.activationAllowed) return new Set()
  if (isLegacyRollback(input.urlOverride, input.storedOverride)) return new Set()
  const raw = (input.routesVariable ?? '').trim()
  if (raw === '') return new Set(CHAINAGE_TRIGGER_ROLLOUT_ORDER)
  if (ALL_LEGACY_VALUES.has(raw.toLowerCase())) return new Set()
  return new Set(
    raw
      .split(',')
      .map((slug) => slug.trim())
      .filter((slug) => (CHAINAGE_TRIGGER_ROLLOUT_ORDER as readonly string[]).includes(slug)),
  )
}

/** Reads `?pinTrigger=` once and remembers the off-switch for this tab. */
function currentOverride(): { url: string | null; stored: string | null } {
  if (typeof window === 'undefined') return { url: null, stored: null }
  let url: string | null = null
  try {
    url = new URLSearchParams(window.location.search).get(PIN_TRIGGER_URL_PARAM)
  } catch {
    url = null
  }
  let stored: string | null = null
  try {
    if (url === 'legacy') window.sessionStorage.setItem(PIN_TRIGGER_OVERRIDE_STORAGE_KEY, 'legacy')
    else if (url === 'chainage') window.sessionStorage.removeItem(PIN_TRIGGER_OVERRIDE_STORAGE_KEY)
    stored = window.sessionStorage.getItem(PIN_TRIGGER_OVERRIDE_STORAGE_KEY)
  } catch {
    stored = null
  }
  return { url: url === 'legacy' || url === 'chainage' ? url : null, stored }
}

let testOverride: Set<string> | null = null

/**
 * Is the kilometre trigger the active PIN audio trigger for this route?
 * Production: always false (the rest of this function is removed from the
 * bundle). The `?pinTrigger=legacy` rollback wins over everything, including
 * the test-only setter, so the emergency path is testable end to end.
 */
export function isChainageTriggerEnabled(slug: string): boolean {
  if (!FIELD_DIAGNOSTICS_ENABLED) return false
  const override = currentOverride()
  if (isLegacyRollback(override.url, override.stored)) return false
  if (testOverride !== null) return testOverride.has(slug)
  return chainageTriggerRoutesFor({
    activationAllowed: CHAINAGE_ACTIVATION_ALLOWED,
    routesVariable: import.meta.env.VITE_PIN_CHAINAGE_TRIGGER_ROUTES as string | undefined,
    urlOverride: override.url,
    storedOverride: override.stored,
  }).has(slug)
}

/** Tests only: force the enabled route set (null = back to env). */
export function setChainageTriggerRoutesForTesting(routes: Iterable<string> | null): void {
  testOverride = routes === null ? null : new Set(routes)
}

export type PinTriggerShadowEvent = {
  readonly routeSlug: string
  /** 'shadow' = computed only (legacy in control); 'active' = new trigger in control. */
  readonly mode: 'shadow' | 'active'
  readonly play: number | null
  readonly passSilently: readonly number[]
  readonly progressMeters: number
  readonly gpsTimestampMs: number
}

type Listener = (event: PinTriggerShadowEvent) => void
const listeners = new Set<Listener>()

export function onPinTriggerEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function reportPinTriggerEvent(event: PinTriggerShadowEvent): void {
  listeners.forEach((listener) => listener(event))
}
