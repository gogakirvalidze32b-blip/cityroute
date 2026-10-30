/**
 * Tab refocus (Return): supabase-js re-emits SIGNED_IN for the SAME user. That must not flip the
 * app to "loading" (which unmounts the active exam), must not wipe a good profile when the
 * background profile fetch fails, and SIGNED_OUT / a different user must still be handled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

type Cb = (event: string, session: unknown) => void
const h = vi.hoisted(() => ({
  cb: null as null | ((event: string, session: unknown) => void),
  profileFetch: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  sessionResponse: null as unknown,
  sessionError: null as unknown,
  planError: null as unknown,
  deactivateError: null as unknown,
  signOutOptions: null as unknown,
  signOut: null as null | (() => Promise<void>),
  rpcCalls: [] as string[],
  rpcArgs: [] as Array<{ name: string; args: unknown }>,
  profileUpdates: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      signOut: async (options: unknown) => {
        h.signOutOptions = options
        return { error: null }
      },
      onAuthStateChange: (cb: Cb) => {
        h.cb = cb
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => h.profileFetch!() }) }),
      update: (values: unknown) => {
        h.profileUpdates.push(values)
        return { eq: async () => ({ error: null }) }
      },
    }),
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push(name)
      h.rpcArgs.push({ name, args })
      if (name === 'deactivate_current_session') {
        return {
          data: { status: 'deactivated' },
          error: h.deactivateError,
        }
      }
      if (name === 'select_subscription_plan') {
        return {
          data: h.planError ? null : { status: 'ok', plan: 'premium' },
          error: h.planError,
        }
      }
      return { data: h.sessionResponse, error: h.sessionError }
    },
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
import { useEffect, useState } from 'react'
function Probe() {
  const { loading, hasAccess, user, deviceBlocked } = useAuth()
  seen.push(loading)
  return (
    <div data-testid="s">
      {loading ? 'loading' : hasAccess ? 'access' : 'noaccess'}:{user?.id ?? 'none'}
      {deviceBlocked && <span>{deviceBlocked}</span>}
    </div>
  )
}
function EntitlementProbe() {
  const { profile, hasAccess } = useAuth()
  return (
    <div data-testid="entitlement">
      {profile?.subscription_status}:{profile?.subscription_expires_at}:{hasAccess ? 'access' : 'denied'}
    </div>
  )
}
function Child() {
  useEffect(() => {
    mounts++
    return () => { unmounts++ }
  }, [])
  return null
}
function SignOutProbe() {
  const { signOut } = useAuth()
  useEffect(() => {
    h.signOut = signOut
  }, [signOut])
  return null
}
function RefreshProfileProbe() {
  const { refreshProfile } = useAuth()
  return <button onClick={() => void refreshProfile()}>Refresh profile</button>
}
function PlanSelector() {
  const { selectPlan } = useAuth()
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button onClick={() => void selectPlan('premium').then(setError)}>Save Premium plan</button>
      {error && <output data-testid="plan-error">{error}</output>}
    </>
  )
}
function Gate() {
  const { loading } = useAuth()
  return loading ? <p>loading</p> : <><Child /><Probe /><SignOutProbe /></>
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

describe('AuthContext – tab refocus', () => {
  beforeEach(() => {
    seen.length = 0
    mounts = 0
    unmounts = 0
    localStorage.clear()
    h.cb = null
    h.sessionResponse = { status: 'active' }
    h.sessionError = null
    h.planError = null
    h.deactivateError = null
    h.signOutOptions = null
    h.signOut = null
    h.rpcCalls.length = 0
    h.rpcArgs.length = 0
    h.profileUpdates.length = 0
  })

  it('saves the Trial plan through its session-guarded RPC without directly updating profiles', async () => {
    h.profileFetch = async () => ({
      data: {
        ...profile('u1'),
        subscription_status: 'trial',
        device_slots: 2,
      },
      error: null,
    })
    render(<AuthProvider><Gate /><PlanSelector /></AuthProvider>)
    await tick()
    await tick()

    await act(async () => { screen.getByRole('button', { name: 'Save Premium plan' }).click() })

    expect(h.rpcArgs).toContainEqual({
      name: 'select_subscription_plan',
      args: { chosen: 'premium' },
    })
    expect(h.profileUpdates).toEqual([])
    expect(localStorage.getItem('cityroute-plan-u1')).toBe('premium')
  })

  it('does not cache a plan or fall back to a profiles update when the secure RPC is rejected', async () => {
    h.profileFetch = async () => ({
      data: {
        ...profile('u1'),
        subscription_status: 'trial',
        subscription_plan: null,
        device_slots: 1,
      },
      error: null,
    })
    h.planError = { message: 'This session is no longer active; sign in again' }
    render(<AuthProvider><Gate /><PlanSelector /></AuthProvider>)
    await tick()
    await tick()

    await act(async () => { screen.getByRole('button', { name: 'Save Premium plan' }).click() })

    expect(await screen.findByTestId('plan-error')).toHaveTextContent(
      'This session is no longer active; sign in again',
    )
    expect(localStorage.getItem('cityroute-plan-u1')).toBeNull()
    expect(h.rpcArgs).toContainEqual({
      name: 'select_subscription_plan',
      args: { chosen: 'premium' },
    })
    expect(h.profileUpdates).toEqual([])
  })

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

  it('revokes trial access when the 12-hour window expires without a profile refetch', async () => {
    h.profileFetch = async () => ({
      data: {
        ...profile('u1'),
        subscription_status: 'trial',
        subscription_plan: 'premium',
        subscription_expires_at: new Date(Date.now() + 120).toISOString(),
      },
      error: null,
    })
    render(<AuthProvider><Gate /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('access:u1'))
    await waitFor(
      () => expect(screen.getByTestId('s').textContent).toBe('noaccess:u1'),
      { timeout: 1000 },
    )
  })

  it('denies access and shows the server reason when session activation is blocked', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.sessionResponse = { status: 'blocked', message: 'device limit reached' }
    render(<AuthProvider><Gate /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('s').textContent).toContain('noaccess:u1'))
    expect(screen.getByTestId('s').textContent).toContain('device limit reached')
    expect(h.rpcCalls).toEqual(['activate_current_session'])
  })

  it('preserves a loaded premium entitlement when a later session check is blocked', async () => {
    h.profileFetch = async () => ({
      data: {
        ...profile('u1'),
        subscription_status: 'active',
        subscription_plan: 'premium',
      },
      error: null,
    })
    render(
      <AuthProvider>
        <Gate />
        <EntitlementProbe />
        <RefreshProfileProbe />
      </AuthProvider>,
    )
    await tick()
    await tick()
    expect(screen.getByTestId('entitlement').textContent).toContain('active:')

    h.sessionResponse = { status: 'blocked', message: 'device limit reached' }
    await act(async () => { screen.getByRole('button', { name: 'Refresh profile' }).click() })
    await tick()

    expect(screen.getByTestId('entitlement').textContent).toContain('active:')
    expect(screen.getByTestId('entitlement').textContent).toContain(':denied')
    expect(screen.getByTestId('s').textContent).toContain('device limit reached')
  })

  it('denies access when session activation returns an RPC error', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.sessionError = { message: 'network unavailable' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Gate /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('s').textContent).toContain('noaccess:u1'))
    expect(screen.getByTestId('s').textContent).toContain('სესიის შემოწმება ვერ მოხერხდა')
    expect(h.rpcCalls).toEqual(['activate_current_session'])
  })

  it('denies access when session activation returns an unexpected response', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.sessionResponse = { status: 'unknown' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Gate /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('s').textContent).toContain('noaccess:u1'))
  })

  it('deactivates the session before signing out locally', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()

    await act(async () => { await h.signOut?.() })

    expect(h.rpcCalls).toContain('deactivate_current_session')
    expect(h.signOutOptions).toEqual({ scope: 'local' })
  })

  it('does not sign out locally when server-side session deactivation fails', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.deactivateError = { message: 'network unavailable' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()

    await expect(h.signOut?.()).rejects.toMatchObject({ message: 'network unavailable' })
    expect(h.rpcCalls).toContain('deactivate_current_session')
    expect(h.signOutOptions).toBeNull()
  })
})
