/**
 * Tab refocus (Return): supabase-js re-emits SIGNED_IN for the SAME user. That must not flip the
 * app to "loading" (which unmounts the active exam), must fail closed when a fresh profile fetch
 * fails, and SIGNED_OUT / a different user must still be handled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

type Cb = (event: string, session: unknown) => void
const h = vi.hoisted(() => ({
  cb: null as null | ((event: string, session: unknown) => void),
  profileFetch: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  authSession: { user: { id: 'u1' }, access_token: 'token-u1' } as unknown,
  authSessionError: null as unknown,
  sessionResponse: { status: 'active', access_active: true } as unknown,
  sessionError: null as unknown,
  entitlementResponse: {
    status: 'ok',
    entitlement: 'legacy',
    payment_status: null,
    payment_amount: null,
    payment_currency: null,
    device_limit: 2,
    access_active: true,
  } as unknown,
  entitlementError: null as unknown,
  activeSessionResponse: true as unknown,
  accessResponse: true as unknown,
  accessError: null as unknown,
  planError: null as unknown,
  deactivateError: null as unknown,
  deactivateResponse: { status: 'deactivated', deactivated_sessions: 1 } as unknown,
  deactivateWait: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  signOutCallback: false,
  signOutOptions: null as unknown,
  signOut: null as null | (() => Promise<void>),
  rpcCalls: [] as string[],
  rpcArgs: [] as Array<{ name: string; args: unknown }>,
  events: [] as string[],
  flow: [] as string[],
  profileUpdates: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: async () => {
        h.flow.push('getSession')
        return { data: { session: h.authSession }, error: h.authSessionError }
      },
      signOut: async (options: unknown) => {
        h.events.push('local signOut')
        h.signOutOptions = options
        if (h.signOutCallback) h.cb?.('SIGNED_OUT', null)
        return { error: null }
      },
      onAuthStateChange: (cb: Cb) => {
        h.cb = cb
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            h.flow.push('profile')
            return h.profileFetch!()
          },
        }),
      }),
      update: (values: unknown) => {
        h.profileUpdates.push(values)
        return { eq: async () => ({ error: null }) }
      },
    }),
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push(name)
      h.rpcArgs.push({ name, args })
      if (name === 'activate_current_session') h.flow.push('activate')
      if (name === 'deactivate_current_session') {
        h.events.push('deactivate_current_session')
        return h.deactivateWait ? h.deactivateWait() : {
          data: h.deactivateResponse,
          error: h.deactivateError,
        }
      }
      if (name === 'has_current_active_session') {
        return { data: h.activeSessionResponse, error: null }
      }
      if (name === 'has_active_access') {
        return { data: h.accessResponse, error: h.accessError }
      }
      if (name === 'get_current_account_entitlement') {
        h.flow.push('entitlement')
        return { data: h.entitlementResponse, error: h.entitlementError }
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

it('denies access when the authoritative entitlement snapshot cannot be loaded', async () => {
  h.profileFetch = async () => ({ data: profile('u1'), error: null })
  h.entitlementError = { message: 'snapshot unavailable' }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <AuthProvider>
      <Gate />
      <EntitlementProbe />
    </AuthProvider>,
  )

  await waitFor(() => expect(screen.getByTestId('s').textContent).toContain('noaccess:u1'))
  expect(screen.getByTestId('s').textContent).toContain(
    'გამოწერისა და გადახდის სტატუსი სერვერიდან ვერ ჩაიტვირთა',
  )
  expect(screen.getByTestId('entitlement').textContent).toContain('no-entitlement')
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
  const { profile, entitlement, entitlementStatusUnavailable, hasAccess } = useAuth()
  return (
    <>
    <div data-testid="entitlement">
      {profile?.subscription_status}:{profile?.subscription_expires_at}:{profile?.subscription_plan ?? 'no-plan'}:
      {entitlement?.source ?? 'no-entitlement'}:{entitlement?.paymentStatus ?? 'no-payment'}:
      {entitlement?.deviceLimit ?? 'no-limit'}:{hasAccess ? 'access' : 'denied'}
    </div>
    <output data-testid="entitlement-status">
      {entitlementStatusUnavailable ? 'unknown' : 'verified'}
    </output>
    </>
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
  const { signOut, signOutWarning } = useAuth()
  useEffect(() => {
    h.signOut = signOut
  }, [signOut])
  return <output data-testid="sign-out-warning">{signOutWarning}</output>
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
    h.authSession = { user: { id: 'u1' }, access_token: 'token-u1' }
    h.authSessionError = null
    h.sessionResponse = { status: 'active', access_active: true }
    h.sessionError = null
    h.entitlementResponse = {
      status: 'ok',
      entitlement: 'legacy',
      payment_status: null,
      payment_amount: null,
      payment_currency: null,
      device_limit: 2,
      access_active: true,
    }
    h.entitlementError = null
    h.activeSessionResponse = true
    h.accessResponse = true
    h.accessError = null
    h.planError = null
    h.deactivateError = null
    h.deactivateResponse = { status: 'deactivated', deactivated_sessions: 1 }
    h.deactivateWait = null
    h.signOutCallback = false
    h.signOutOptions = null
    h.signOut = null
    h.rpcCalls.length = 0
    h.rpcArgs.length = 0
    h.events.length = 0
    h.flow.length = 0
    h.profileUpdates.length = 0
  })

  it('activates the current Auth session before loading profile and entitlement', async () => {
    h.profileFetch = async () => ({
      data: { ...profile('u1'), subscription_status: 'trial' },
      error: null,
    })
    render(
      <AuthProvider>
        <Gate />
        <EntitlementProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('access:u1'))

    const activationIndex = h.flow.indexOf('activate')
    const profileIndex = h.flow.indexOf('profile')
    const entitlementIndex = h.flow.indexOf('entitlement')
    expect(activationIndex).toBeGreaterThan(-1)
    expect(activationIndex).toBeLessThan(profileIndex)
    expect(profileIndex).toBeLessThan(entitlementIndex)
    expect(h.rpcCalls[0]).toBe('activate_current_session')
    expect(screen.getByTestId('entitlement').textContent).toContain('trial:')
  })

  it('loads paid Premium only after the current session is activated', async () => {
    h.profileFetch = async () => ({
      data: { ...profile('u1'), subscription_status: 'active', subscription_plan: 'premium' },
      error: null,
    })
    h.entitlementResponse = {
      status: 'ok',
      entitlement: 'paid',
      payment_status: 'verified',
      payment_amount: 9900,
      payment_currency: 'GEL',
      device_limit: 1,
      access_active: true,
    }
    render(
      <AuthProvider>
        <Gate />
        <EntitlementProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('access:u1'))

    expect(h.flow.indexOf('activate')).toBeLessThan(h.flow.indexOf('profile'))
    expect(h.flow.indexOf('profile')).toBeLessThan(h.flow.indexOf('entitlement'))
    expect(screen.getByTestId('entitlement').textContent).toContain('paid:verified:1:access')
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
    expect(localStorage.getItem('cityroute-plan-u1')).toBeNull()
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

  it('does not use a cached local plan as Premium entitlement', async () => {
    localStorage.setItem('cityroute-plan-u1', 'premium')
    h.profileFetch = async () => ({
      data: {
        ...profile('u1'),
        subscription_status: 'expired',
        subscription_plan: null,
      },
      error: null,
    })
    h.sessionResponse = { status: 'active', access_active: false }
    h.accessResponse = false
    render(
      <AuthProvider>
        <Gate />
        <EntitlementProbe />
      </AuthProvider>,
    )
    await tick()
    await tick()

    expect(screen.getByTestId('entitlement').textContent).toContain('expired:')
    expect(screen.getByTestId('entitlement').textContent).toContain(
      ':no-plan:legacy:no-payment:2:denied',
    )
    expect(screen.getByTestId('s').textContent).toBe('noaccess:u1')
  })

  it('preserves existing session access but marks entitlement unknown when the snapshot RPC is not installed', async () => {
    h.profileFetch = async () => ({
      data: {
        ...profile('u1'),
        subscription_status: 'trial',
      },
      error: null,
    })
    h.entitlementError = {
      code: 'PGRST202',
      message: 'Could not find function public.get_current_account_entitlement in schema cache',
    }
    render(
      <AuthProvider>
        <Gate />
        <EntitlementProbe />
      </AuthProvider>,
    )
    await tick()
    await tick()

    expect(screen.getByTestId('s').textContent).toBe('access:u1')
    expect(screen.getByTestId('entitlement').textContent).toContain(':no-entitlement:')
    expect(screen.getByTestId('entitlement-status').textContent).toBe('unknown')
    expect(h.rpcCalls).toContain('has_active_access')
    expect(h.rpcCalls).not.toContain('deactivate_current_session')
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
    expect(h.rpcCalls).not.toContain('deactivate_current_session')
  })

  it('denies access and clears stale profile data when a BACKGROUND profile fetch fails', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /><EntitlementProbe /></AuthProvider>)
    await tick(); await tick()
    h.profileFetch = async () => ({ data: null, error: new Error('network') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { h.cb!('SIGNED_IN', { user: { id: 'u1' } }) })
    await tick()
    expect(screen.getByTestId('s').textContent).toContain('noaccess:u1')
    expect(screen.getByTestId('s').textContent).toContain('ანგარიშის მონაცემები სერვერიდან ვერ ჩაიტვირთა')
    expect(screen.getByTestId('entitlement').textContent).toContain(
      'no-entitlement:no-payment:no-limit:denied',
    )
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
    h.authSession = { user: { id: 'u2' }, access_token: 'token-u2' }
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
    render(
      <AuthProvider>
        <Gate />
        <EntitlementProbe />
        <RefreshProfileProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('s').textContent).toContain('noaccess:u1'))
    expect(screen.getByTestId('s').textContent).toContain('device limit reached')
    expect(screen.getByTestId('entitlement').textContent).toContain('no-entitlement')
    expect(screen.getByTestId('entitlement').textContent).toContain(':denied')
    expect(h.rpcCalls).toEqual(['activate_current_session'])
    expect(h.flow).not.toContain('profile')
    expect(h.flow).not.toContain('entitlement')

    h.sessionResponse = { status: 'active', access_active: true }
    await act(async () => { screen.getByRole('button', { name: 'Refresh profile' }).click() })
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('access:u1'))
    expect(screen.getByTestId('entitlement').textContent).toContain('active:')
  })

  it('clears loaded entitlement when a refreshed activation is blocked', async () => {
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

    expect(screen.getByTestId('entitlement').textContent).toContain('no-entitlement')
    expect(screen.getByTestId('s').textContent).toContain('device limit reached')
    expect(h.flow.slice(-1)).toEqual(['activate'])
  })

  it('denies access when session activation returns an RPC error', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.sessionError = { message: 'network unavailable' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Gate /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('s').textContent).toContain('noaccess:u1'))
    expect(screen.getByTestId('s').textContent).toContain(
      'სესიის გააქტიურება ვერ მოხერხდა: network unavailable',
    )
    expect(h.rpcCalls).toEqual(['activate_current_session'])
    expect(h.flow).not.toContain('profile')
    expect(h.flow).not.toContain('entitlement')
  })

  it('denies access when session activation returns an unexpected response', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.sessionResponse = { status: 'unknown' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Gate /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('s').textContent).toContain('noaccess:u1'))
    expect(h.flow).not.toContain('profile')
    expect(h.flow).not.toContain('entitlement')
  })

  it('does not activate or load account data when the current Auth session belongs to another user', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick()
    await tick()

    h.authSession = { user: { id: 'u2' }, access_token: 'token-u2' }
    await act(async () => { h.cb!('SIGNED_IN', { user: { id: 'u1' } }) })
    await tick()

    expect(h.rpcCalls.filter((name) => name === 'activate_current_session')).toHaveLength(1)
    expect(h.flow.slice(-1)).toEqual(['getSession'])
    expect(screen.getByTestId('s').textContent).toContain(
      'მოქმედი Auth სესია ვერ დადასტურდა',
    )
  })

  it('deactivates the session before signing out locally', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()

    await act(async () => { await h.signOut?.() })

    expect(h.rpcCalls).toContain('deactivate_current_session')
    expect(h.rpcArgs).toContainEqual({ name: 'deactivate_current_session', args: undefined })
    expect(h.events).toEqual(['deactivate_current_session', 'local signOut'])
    expect(h.signOutOptions).toEqual({ scope: 'local' })
    expect(screen.getByTestId('sign-out-warning')).toBeEmptyDOMElement()
  })

  it('clears authorized UI while waiting for current-device server revocation', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    let resolveRevocation: ((result: { data: unknown; error: unknown }) => void) | null = null
    h.deactivateWait = () => new Promise((resolve) => { resolveRevocation = resolve })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick()
    await tick()

    let pendingSignOut: Promise<void> | undefined
    await act(async () => {
      pendingSignOut = h.signOut?.()
      await Promise.resolve()
    })
    expect(screen.getByTestId('s').textContent).toBe('noaccess:none')
    expect(h.signOutOptions).toBeNull()

    await act(async () => {
      resolveRevocation?.({
        data: { status: 'deactivated', deactivated_sessions: 1 },
        error: null,
      })
      await pendingSignOut
    })
    expect(h.signOutOptions).toEqual({ scope: 'local' })
    expect(screen.getByTestId('sign-out-warning')).toBeEmptyDOMElement()
  })

  it('treats an already inactive session as a successful logout', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.deactivateResponse = { status: 'inactive', deactivated_sessions: 0 }
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()

    await act(async () => { await h.signOut?.() })

    expect(h.signOutOptions).toEqual({ scope: 'local' })
    expect(screen.getByTestId('sign-out-warning')).toBeEmptyDOMElement()
  })

  it('signs out locally and warns when server-side session deactivation fails', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.deactivateError = { message: 'network unavailable' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()

    await act(async () => { await h.signOut?.() })

    expect(h.rpcCalls).toContain('deactivate_current_session')
    expect(h.signOutOptions).toEqual({ scope: 'local' })
    expect(screen.getByTestId('sign-out-warning')).toHaveTextContent(
      'ამ მოწყობილობის სესიის გაუქმება სერვერზე ვერ დადასტურდა',
    )
    expect(screen.getByTestId('sign-out-warning')).toHaveTextContent(
      'შემდეგი შესვლისას წვდომა ხელახლა შემოწმდება',
    )
  })

  it('requests current-device session revocation before local logout', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()

    await act(async () => { await h.signOut?.() })

    expect(h.rpcArgs.find(({ name }) => name === 'deactivate_current_session')).toEqual({
      name: 'deactivate_current_session',
      args: undefined,
    })
    expect(h.signOutOptions).toEqual({ scope: 'local' })
    expect(h.events).toEqual(['deactivate_current_session', 'local signOut'])
  })

  it('warns and signs out locally for an unexpected RPC response', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.deactivateResponse = { status: 'unknown' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick(); await tick()

    await act(async () => { await h.signOut?.() })

    expect(h.signOutOptions).toEqual({ scope: 'local' })
    expect(screen.getByTestId('sign-out-warning')).toHaveTextContent(
      'ამ მოწყობილობის სესიის გაუქმება სერვერზე ვერ დადასტურდა',
    )
  })

  it('signs out locally when another device revokes the current session', async () => {
    h.profileFetch = async () => ({ data: profile('u1'), error: null })
    h.signOutCallback = true
    render(<AuthProvider><Gate /></AuthProvider>)
    await tick()
    await tick()

    h.activeSessionResponse = false
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(h.signOutOptions).toEqual({ scope: 'local' })
    expect(screen.getByTestId('s').textContent).toBe('noaccess:none')
    expect(screen.getByTestId('sign-out-warning')).toHaveTextContent(
      'ეს სესია გაუქმებულია. ხელახლა შედით ანგარიშში.',
    )
  })
})
