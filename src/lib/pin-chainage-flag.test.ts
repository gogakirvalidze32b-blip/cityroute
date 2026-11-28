import { afterEach, describe, expect, it } from 'vitest'
import {
  CHAINAGE_ACTIVATION_ALLOWED,
  CHAINAGE_TRIGGER_ROLLOUT_ORDER,
  chainageTriggerRoutesFor,
  isChainageTriggerEnabled,
  PIN_TRIGGER_OVERRIDE_STORAGE_KEY,
  setChainageTriggerRoutesForTesting,
} from './pin-chainage-flag'

const ALL = ['route-2', 'route-4', 'route-1', 'route-3']
const preview = { activationAllowed: true, routesVariable: undefined, urlOverride: null, storedOverride: null }

describe('chainageTriggerRoutesFor (pure gate)', () => {
  it('Preview: chainage is the active trigger for Routes 1–4 by default (no variable needed)', () => {
    expect([...chainageTriggerRoutesFor(preview)].sort()).toEqual([...ALL].sort())
    expect([...chainageTriggerRoutesFor({ ...preview, routesVariable: '  ' })].sort()).toEqual([...ALL].sort())
    expect(CHAINAGE_TRIGGER_ROLLOUT_ORDER).toEqual(ALL)
  })

  it('never includes Route 5 or unknown routes', () => {
    expect(chainageTriggerRoutesFor(preview).has('route-5')).toBe(false)
    expect([...chainageTriggerRoutesFor({ ...preview, routesVariable: 'route-5,all,*' })]).toEqual([])
  })

  it('Production / local builds: never active, whatever the variable or URL says', () => {
    for (const routesVariable of [undefined, 'route-1,route-2,route-3,route-4', 'route-2']) {
      for (const urlOverride of [null, 'chainage']) {
        expect([...chainageTriggerRoutesFor({ ...preview, activationAllowed: false, routesVariable, urlOverride })]).toEqual([])
      }
    }
  })

  it('Preview build-time override: a subset, or "none" for an all-legacy build', () => {
    expect([...chainageTriggerRoutesFor({ ...preview, routesVariable: ' route-2 , route-4 ' })]).toEqual(['route-2', 'route-4'])
    for (const none of ['none', 'NONE', 'legacy', 'off']) {
      expect([...chainageTriggerRoutesFor({ ...preview, routesVariable: none })]).toEqual([])
    }
  })

  it('?pinTrigger=legacy rollback disables every route, from the URL or stored for the tab', () => {
    expect([...chainageTriggerRoutesFor({ ...preview, urlOverride: 'legacy' })]).toEqual([])
    expect([...chainageTriggerRoutesFor({ ...preview, storedOverride: 'legacy' })]).toEqual([])
  })

  it('?pinTrigger=chainage in the URL clears a stored rollback (Preview only)', () => {
    expect(chainageTriggerRoutesFor({ ...preview, urlOverride: 'chainage', storedOverride: 'legacy' }).size).toBe(4)
  })
})

describe('isChainageTriggerEnabled (runtime)', () => {
  afterEach(() => {
    setChainageTriggerRoutesForTesting(null)
    window.sessionStorage.removeItem(PIN_TRIGGER_OVERRIDE_STORAGE_KEY)
    window.history.replaceState(null, '', '/')
  })

  it('outside Vercel Preview (here: the test build) activation is not allowed → legacy for every route', () => {
    expect(CHAINAGE_ACTIVATION_ALLOWED).toBe(false)
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4', 'route-5']) {
      expect(isChainageTriggerEnabled(slug)).toBe(false)
    }
  })

  it('the ?pinTrigger=legacy rollback wins over every other setting and is remembered for the tab', () => {
    setChainageTriggerRoutesForTesting(ALL)
    expect(isChainageTriggerEnabled('route-2')).toBe(true)
    window.history.replaceState(null, '', '/route/route-2?pinTrigger=legacy')
    expect(ALL.map(isChainageTriggerEnabled)).toEqual([false, false, false, false])
    expect(window.sessionStorage.getItem(PIN_TRIGGER_OVERRIDE_STORAGE_KEY)).toBe('legacy')
    // Navigating within the tab (URL param gone) keeps the rollback.
    window.history.replaceState(null, '', '/route/route-3')
    expect(isChainageTriggerEnabled('route-3')).toBe(false)
    // ?pinTrigger=chainage clears it again.
    window.history.replaceState(null, '', '/route/route-3?pinTrigger=chainage')
    expect(isChainageTriggerEnabled('route-3')).toBe(true)
    expect(window.sessionStorage.getItem(PIN_TRIGGER_OVERRIDE_STORAGE_KEY)).toBeNull()
  })
})
