/**
 * Tab refocus (Return): supabase-js re-emits SIGNED_IN for the SAME user. That must not flip the
 * app to "loading" (which unmounts the active exam), must not wipe a good profile when the
 * background profile fetch fails, and SIGNED_OUT / a different user must still be handled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

type Cb = (event: string, session: unknown) => void
const h = vi.hoisted(() => ({
  cb: null as null | ((event: string, session: unknown) => void),
  profileFetch: null as null | (() => Promise<{ data: unknown; error: unknown }>),
}))

vi.mock('@/lib/device', () => ({
  getDeviceFingerprint: () => 'fp',
  parseDeviceBindResult: () => ({ status: 'ok' }),
}))
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: (cb: Cb) => {
        h.cb = cb
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => h.profileFetch!() }) }) }),
    rpc: async () => ({ data: null, error: null }),
  }),
}))

const profile = (id: string) => ({
  id,
  subscription_status: 'active',
  subscription_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  subscription_plan: 'full',
})

const seen: boolean[] = []
let mounts = 0
let unmounts = 0
import { useEffect } from 'react'
function Probe() {
  const { loading, hasAccess, user } = useAuth()
  seen.push(loading)
  return <div data-testid="s">{loading ? 'loading' : hasAccess ? 'access' : 'noaccess'}:{user?.id ?? 'none'}</div>
}
function Child() {
  useEffect(() => {
    mounts++
    return () => { unmounts++ }
  }, [])
  return null
}
function Gate() {
  const { loading } = useAuth()
  return loading ? <p>loading</p> : <><Child /><Probe /></>
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

describe('AuthContext – tab refocus', () => {
  beforeEach(() => { seen.length = 0; mounts = 0; unmounts = 0; h.cb = null })

  it('SIGNED_IN for the same user does NOT unmount the app subtree', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()
    expect(screen.getByTestId('s').textContent).toBe('access:u1')
    expect(mounts).toBe(1)

    // Real networks are not instant: the refocus profile fetch takes a while.
    h.profileFetch = async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { data: profile('u1'), error: null }
    }
    for (const ev of ['SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_IN']) {
      await act(async () => { h.cb!(ev, { user: { id: 'u1' } }) })
      await act(async () => { await new Promise((r) => setTimeout(r, 10)) }) // mid-fetch
      expect(screen.queryByText('loading')).toBeNull()
      await tick(); await tick()
    }
    expect(screen.getByTestId('s').textContent).toBe('access:u1')
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
  })

  it('a failing BACKGROUND profile fetch keeps the profile (no redirect to Home)', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()
    h.profileFetch = async () => ({ data: null, error: new Error('network') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { h.cb!('SIGNED_IN', { user: { id: 'u1' } }) })
    await tick()
    expect(screen.getByTestId('s').textContent).toBe('access:u1')
    expect(unmounts).toBe(0)
  })

  it('SIGNED_OUT still clears the user and profile', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()
    await act(async () => { h.cb!('SIGNED_OUT', null) })
    await tick()
    expect(screen.getByTestId('s').textContent).toBe('noaccess:none')
  })

  it('a DIFFERENT user still goes through the full loading path', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()
    h.profileFetch = async () => { await new Promise((r) => setTimeout(r, 30)); return { data: profile('u2'), error: null } }
    await act(async () => { h.cb!('SIGNED_IN', { user: { id: 'u2' } }) })
    await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    expect(screen.getByText('loading')).toBeTruthy()
    await tick(); await tick(); await tick()
    expect(screen.getByTestId('s').textContent).toBe('access:u2')
  })
})
