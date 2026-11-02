import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useRef,

  useState,

  type ReactNode,

} from 'react'

import type { Session, User } from '@supabase/supabase-js'

import type { SubscriptionPlan } from '@/data/subscription-plans'

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

import {

  needsPlanSelection as profileNeedsPlan,

  resolvePlanFeatures,

  type PlanFeatures,

} from '@/lib/plan-features'

import type { Profile } from '@/types/database'

import { isAccessActive } from '@/types/database'



type AuthState = {

  loading: boolean

  session: Session | null

  user: User | null

  profile: Profile | null
  entitlement: CurrentAccountEntitlement | null
  entitlementStatusUnavailable: boolean

  hasAccess: boolean

  needsPlanSelection: boolean

  features: PlanFeatures

  deviceBlocked: string | null

  signOutWarning: string | null

  refreshProfile: () => Promise<void>

  selectPlan: (plan: SubscriptionPlan) => Promise<string | null>

  signUp: (email: string, password: string, fullName: string) => Promise<string | null>

  signIn: (email: string, password: string) => Promise<string | null>

  signOut: () => Promise<void>

}

export type CurrentAccountEntitlement = {
  source: 'trial' | 'paid' | 'legacy' | 'inactive'
  paymentStatus: string | null
  paymentAmount: number | null
  paymentCurrency: string | null
  deviceLimit: number
  accessActive: boolean
}



const AuthContext = createContext<AuthState | null>(null)

function isEntitlementSource(
  value: unknown,
): value is CurrentAccountEntitlement['source'] {
  return value === 'trial' || value === 'paid' || value === 'legacy' || value === 'inactive'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function getSessionDiagnosticError(error: unknown) {
  const record = isRecord(error) ? error : null
  const message = record && typeof record.message === 'string'
    ? record.message
        .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
        .slice(0, 500)
    : error instanceof Error
      ? error.message.slice(0, 500)
      : String(error).slice(0, 500)

  return {
    code: record && typeof record.code === 'string' ? record.code : null,
    message,
  }
}

function getJsonShape(value: unknown) {
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length }
  }
  if (isRecord(value)) {
    return {
      type: 'object',
      fields: Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, Array.isArray(value[key]) ? 'array' : typeof value[key]]),
      ),
    }
  }
  return { type: value === null ? 'null' : typeof value }
}

function isMissingEntitlementRpc(error: unknown): boolean {
  if (!isRecord(error)) return false
  const code = error.code
  const message = typeof error.message === 'string' ? error.message : ''
  return (
    (code === 'PGRST202' || code === '42883') &&
    message.includes('get_current_account_entitlement')
  )
}

async function fetchProfile(userId: string): Promise<Profile | null> {

  const supabase = getSupabase()

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()

  if (error) throw error

  return data

}



type SessionActivation = {
  error: string | null
  accessActive: boolean
}

async function fetchCurrentAccountEntitlement(): Promise<CurrentAccountEntitlement | null> {
  const { data, error } = await getSupabase().rpc('get_current_account_entitlement')
  if (error) {
    if (isMissingEntitlementRpc(error)) return null
    throw error
  }
  if (!isRecord(data)) {
    throw new Error('Invalid get_current_account_entitlement response')
  }
  const source: unknown = data.entitlement
  const paymentStatus: unknown = data.payment_status
  const paymentAmount: unknown = data.payment_amount
  const paymentCurrency: unknown = data.payment_currency
  const deviceLimit: unknown = data.device_limit
  const accessActive: unknown = data.access_active
  if (
    data.status !== 'ok' ||
    !isEntitlementSource(source) ||
    typeof deviceLimit !== 'number' ||
    !Number.isInteger(deviceLimit) ||
    deviceLimit < 0 ||
    typeof accessActive !== 'boolean' ||
    !isNullableString(paymentStatus) ||
    !isNullableNumber(paymentAmount) ||
    !isNullableString(paymentCurrency)
  ) {
    throw new Error('Invalid get_current_account_entitlement response')
  }
  return {
    source,
    paymentStatus,
    paymentAmount,
    paymentCurrency,
    deviceLimit,
    accessActive,
  }
}

async function activateSession(userId: string): Promise<SessionActivation> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const supabase = getSupabase()
    const {
      data: { session: currentSession },
      error: authError,
    } = await supabase.auth.getSession()
    if (authError) {
      return {
        error: `მოქმედი Auth სესიის შემოწმება ვერ მოხერხდა: ${authError.message}`,
        accessActive: false,
      }
    }
    if (
      !currentSession?.access_token ||
      currentSession.user.id !== userId
    ) {
      return {
        error: 'მოქმედი Auth სესია ვერ დადასტურდა. ხელახლა შედით ანგარიშში.',
        accessActive: false,
      }
    }

    const { data, error } = await Promise.race([
      supabase.rpc('activate_current_session'),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('timeout')), 3000)
      }),
    ])
    if (error) {
      console.error('activate_current_session RPC failed:', error)
      return {
        error: `სესიის გააქტიურება ვერ მოხერხდა: ${error.message}`,
        accessActive: false,
      }
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return {
        error: 'სერვერმა სესიის გააქტიურებაზე არასწორი პასუხი დააბრუნა.',
        accessActive: false,
      }
    }
    if (
      'status' in data &&
      data.status === 'active' &&
      'access_active' in data &&
      typeof data.access_active === 'boolean'
    ) {
      return { error: null, accessActive: data.access_active }
    }
    if (
      'status' in data &&
      data.status === 'blocked' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return { error: data.message, accessActive: false }
    }
    return {
      error: 'სერვერმა სესიის გააქტიურებაზე უცნობი სტატუსი დააბრუნა.',
      accessActive: false,
    }
  } catch (err) {
    console.error('activateSession error:', err)
    const message = err instanceof Error ? err.message : 'უცნობი შეცდომა'
    return {
      error: message === 'timeout'
        ? 'სესიის გააქტიურების პასუხის მიღების დრო ამოიწურა. სცადეთ ხელახლა.'
        : `სესიის გააქტიურება ვერ მოხერხდა: ${message}`,
      accessActive: false,
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}



async function persistPlan(plan: SubscriptionPlan): Promise<string | null> {

  const supabase = getSupabase()

  const { error: rpcError } = await supabase.rpc('select_subscription_plan', { chosen: plan })

  if (rpcError) return rpcError.message

  return null

}



export function AuthProvider({ children }: { children: ReactNode }) {

  const [loading, setLoading] = useState(true)

  const [session, setSession] = useState<Session | null>(null)

  const [profile, setProfile] = useState<Profile | null>(null)

  const [entitlement, setEntitlement] = useState<CurrentAccountEntitlement | null>(null)

  const [entitlementStatusUnavailable, setEntitlementStatusUnavailable] = useState(false)

  const [profileReady, setProfileReady] = useState(false)

  const [deviceBlocked, setDeviceBlocked] = useState<string | null>(null)

  const [serverAccess, setServerAccess] = useState(false)

  const [signOutWarning, setSignOutWarning] = useState<string | null>(null)

  const [deviceBinding, setDeviceBinding] = useState(false)

  const [trialExpired, setTrialExpired] = useState(false)

  useEffect(() => {
    if (profile?.subscription_status !== 'trial' || !profile.subscription_expires_at) {
      setTrialExpired(false)
      return
    }

    const expiresAt = new Date(profile.subscription_expires_at).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setTrialExpired(true)
      return
    }

    setTrialExpired(false)
    const timer = window.setTimeout(() => setTrialExpired(true), expiresAt - Date.now())
    return () => window.clearTimeout(timer)
  }, [profile?.subscription_status, profile?.subscription_expires_at])


  // User id whose profile is currently loaded. Lets a repeated SIGNED_IN / TOKEN_REFRESHED for the
  // SAME user (supabase-js fires it on every tab hidden→visible) refresh silently instead of
  // flipping the app back to "loading" and unmounting the active exam.
  const loadedProfileUserIdRef = useRef<string | null>(null)
  const activatedUserIdRef = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    setDeviceBinding(true)
    try {
      setDeviceBlocked(null)
      const activation = await activateSession(userId)
      if (activation.error) {
        loadedProfileUserIdRef.current = null
        activatedUserIdRef.current = null
        setProfile(null)
        setEntitlement(null)
        setEntitlementStatusUnavailable(false)
        setServerAccess(false)
        setDeviceBlocked(activation.error)
        return
      }

      let currentProfile: Profile | null
      try {
        currentProfile = await fetchProfile(userId)
        if (!currentProfile) throw new Error('Profile not found')
      } catch (error) {
        console.error('Profile loading failed:', error)
        loadedProfileUserIdRef.current = null
        activatedUserIdRef.current = null
        setProfile(null)
        setEntitlement(null)
        setEntitlementStatusUnavailable(false)
        setServerAccess(false)
        setDeviceBlocked('ანგარიშის მონაცემები სერვერიდან ვერ ჩაიტვირთა. სცადეთ ხელახლა.')
        return
      }

      loadedProfileUserIdRef.current = userId
      setProfile(currentProfile)

      let currentEntitlement: CurrentAccountEntitlement | null
      try {
        currentEntitlement = await fetchCurrentAccountEntitlement()
        setEntitlement(currentEntitlement)
        setEntitlementStatusUnavailable(currentEntitlement === null)
      } catch (error) {
        console.error('Account entitlement loading failed:', error)
        activatedUserIdRef.current = null
        setServerAccess(false)
        setEntitlement(null)
        setEntitlementStatusUnavailable(false)
        setDeviceBlocked('გამოწერისა და გადახდის სტატუსი სერვერიდან ვერ ჩაიტვირთა. სცადეთ ხელახლა.')
        return
      }

      activatedUserIdRef.current = userId
      setDeviceBlocked(null)
      setServerAccess(
        activation.accessActive &&
        (currentEntitlement === null || currentEntitlement.accessActive),
      )
    } finally {
      setDeviceBinding(false)
      setProfileReady(true)
    }
  }, [])



  const refreshProfile = useCallback(async () => {

    if (!session?.user) {

      setProfile(null)

      setEntitlement(null)
      setEntitlementStatusUnavailable(false)

      setDeviceBlocked(null)

      setServerAccess(false)

      setDeviceBinding(false)

      setProfileReady(true)

      return

    }

    setProfileReady(false)

    await loadProfile(session.user.id)

  }, [session?.user, loadProfile])



  useEffect(() => {

    if (!isSupabaseConfigured) {

      setLoading(false)

      setProfileReady(true)

      return

    }



    const supabase = getSupabase()

    let mounted = true



    const finish = () => {

      if (mounted) setLoading(false)

    }



    const safety = window.setTimeout(finish, 5000)



    void (async () => {

      try {

        console.log('🔄 AuthContext: Starting auth initialization...')

        const {

          data: { session: initialSession },

        } = await supabase.auth.getSession()

        console.log('✅ AuthContext: Got session:', initialSession ? 'logged in' : 'not logged in')

        if (!mounted) return



        setSession(initialSession)

        if (initialSession?.user) {

          console.log('👤 AuthContext: Loading profile for user:', initialSession.user.id)

          await loadProfile(initialSession.user.id)

        } else {

          setProfileReady(true)

        }

      } catch (e) {

        console.error('❌ AuthContext: Error during initialization:', e)

        if (mounted) setProfileReady(true)

      } finally {

        window.clearTimeout(safety)

        finish()

        console.log('✅ AuthContext: Initialization complete')

      }

    })()



    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {

      if (event === 'INITIAL_SESSION') return



      setSession(nextSession)

      if (nextSession?.user) {

        const nextUserId = nextSession.user.id

        window.setTimeout(() => {

          if (!mounted) return

          if (loadedProfileUserIdRef.current === nextUserId) {

            // Same user, profile already loaded (token refresh / tab refocus): keep the UI mounted.

            void loadProfile(nextUserId)

            return

          }

          setProfileReady(false)

          void loadProfile(nextUserId)

        }, 0)

      } else {

        loadedProfileUserIdRef.current = null
        activatedUserIdRef.current = null
        setProfile(null)
        setEntitlement(null)
        setEntitlementStatusUnavailable(false)

        setDeviceBlocked(null)

        setServerAccess(false)

        setDeviceBinding(false)

        setProfileReady(true)

      }

    })



    return () => {

      mounted = false

      window.clearTimeout(safety)

      sub.subscription.unsubscribe()

    }

  }, [loadProfile])

  useEffect(() => {
    const userId = session?.user.id
    if (!userId || !profileReady || deviceBinding || activatedUserIdRef.current !== userId) return

    let mounted = true
    let checking = false
    let activityHeartbeatInFlight = false
    let lastActivityHeartbeatAt = 0
    let sessionRevoked = false
    const supabase = getSupabase()

    const signOutRevokedSession = async () => {
      if (!mounted || sessionRevoked) return
      sessionRevoked = true
      activatedUserIdRef.current = null
      setServerAccess(false)
      setDeviceBlocked('ეს სესია გაუქმებულია. ხელახლა შედით ანგარიშში.')
      setSignOutWarning('ეს სესია გაუქმებულია. ხელახლა შედით ანგარიშში.')

      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) {
        console.error('Local sign out after session revocation failed:', error)
        if (!mounted) return
        loadedProfileUserIdRef.current = null
        setSession(null)
        setProfile(null)
        setEntitlement(null)
        setEntitlementStatusUnavailable(false)
        setServerAccess(false)
        setDeviceBinding(false)
        setProfileReady(true)
      }
    }

    const recordCurrentActivity = () => {
      const now = Date.now()
      if (
        !mounted ||
        activityHeartbeatInFlight ||
        document.visibilityState === 'hidden' ||
        now - lastActivityHeartbeatAt < 60_000
      ) return

      activityHeartbeatInFlight = true
      lastActivityHeartbeatAt = now
      void (async () => {
        const { data, error } = await supabase.rpc('heartbeat_current_session')
        if (error) throw error
        if (!isRecord(data) || typeof data.status !== 'string') {
          throw new Error('Unexpected heartbeat_current_session response')
        }
        if (data.status === 'active') return
        if (data.status === 'revoked') {
          await signOutRevokedSession()
          return
        }

        const activation = await activateSession(userId)
        if (!mounted) return
        if (activation.error) {
          setServerAccess(false)
          setDeviceBlocked(activation.error)
          return
        }
        setServerAccess(activation.accessActive)
        setDeviceBlocked(null)
      })().catch((error) => {
        console.error('Current device activity heartbeat failed:', error)
        if (mounted) {
          setServerAccess(false)
          setDeviceBlocked('სესიის აქტივობის განახლება ვერ მოხერხდა. წვდომა დროებით შეზღუდულია.')
        }
      }).finally(() => {
        activityHeartbeatInFlight = false
      })
    }

    // The heartbeat RPC only reports 'revoked' without writing while the session is inactive.
    const isSessionRevokedByAnotherDevice = async () => {
      const { data, error } = await supabase.rpc('heartbeat_current_session')
      return !error && isRecord(data) && data.status === 'revoked'
    }

    let polling = false
    const pollSessionRevocation = async () => {
      // Runs while the tab is hidden too: the check is read-only and never extends the idle window.
      if (!mounted || checking || polling || sessionRevoked) return
      polling = true
      try {
        const { data, error } = await supabase.rpc('has_current_active_session')
        if (!mounted || error || data !== false) return
        if (await isSessionRevokedByAnotherDevice()) await signOutRevokedSession()
      } catch (error) {
        console.error('Session revocation poll failed:', error)
      } finally {
        polling = false
      }
    }

    const validateServerState = async () => {
      if (!mounted || checking || sessionRevoked || document.visibilityState === 'hidden') return
      checking = true
      try {
        const [sessionResult, currentProfile, currentEntitlement] = await Promise.all([
          supabase.rpc('has_current_active_session'),
          fetchProfile(userId),
          fetchCurrentAccountEntitlement(),
        ])

        if (!mounted) return
        if (!currentProfile) throw new Error('Profile not found during revalidation')

        if (!sessionResult.error && sessionResult.data === false && await isSessionRevokedByAnotherDevice()) {
          await signOutRevokedSession()
          return
        }

        if (sessionResult.error || sessionResult.data !== true) {
          if (sessionResult.error) console.error('Session revalidation failed:', sessionResult.error)
          setServerAccess(false)
          setEntitlement(currentEntitlement)
          setEntitlementStatusUnavailable(currentEntitlement === null)
          setDeviceBlocked(
            sessionResult.error
              ? 'სესიის სტატუსის გადამოწმება ვერ მოხერხდა. წვდომა დროებით შეზღუდულია.'
              : 'მოწყობილობა უმოქმედობის გამო დროებით გათავისუფლდა. გამოიყენეთ გვერდი წვდომის აღსადგენად.',
          )
          return
        }

        loadedProfileUserIdRef.current = userId
        setProfile(currentProfile)
        setEntitlement(currentEntitlement)
        setEntitlementStatusUnavailable(currentEntitlement === null)
        if (currentEntitlement) {
          setServerAccess(currentEntitlement.accessActive)
        } else {
          const { data: existingAccess, error: existingAccessError } = await supabase.rpc(
            'has_active_access',
            { uid: userId },
          )
          if (existingAccessError || typeof existingAccess !== 'boolean') {
            throw existingAccessError ?? new Error('Invalid has_active_access response')
          }
          setServerAccess(existingAccess)
        }
        setDeviceBlocked(null)
      } catch (error) {
        console.error('Server access revalidation failed:', error)
        if (mounted) {
          loadedProfileUserIdRef.current = null
          setServerAccess(false)
          setProfile(null)
          setEntitlement(null)
          setEntitlementStatusUnavailable(false)
          setDeviceBlocked('სერვერთან კავშირი ვერ მოხერხდა. წვდომა დროებით შეზღუდულია.')
        }
      } finally {
        checking = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recordCurrentActivity()
        void validateServerState()
      }
    }
    const intervalId = window.setInterval(() => void validateServerState(), 30_000)
    const revocationPollId = window.setInterval(() => void pollSessionRevocation(), 5_000)
    window.addEventListener('pointerdown', recordCurrentActivity)
    window.addEventListener('pointermove', recordCurrentActivity)
    window.addEventListener('keydown', recordCurrentActivity)
    window.addEventListener('touchstart', recordCurrentActivity, { passive: true })
    window.addEventListener('wheel', recordCurrentActivity, { passive: true })
    window.addEventListener('focus', recordCurrentActivity)
    window.addEventListener('focus', validateServerState)
    document.addEventListener('visibilitychange', onVisibilityChange)
    void validateServerState()

    return () => {
      mounted = false
      window.clearInterval(intervalId)
      window.clearInterval(revocationPollId)
      window.removeEventListener('pointerdown', recordCurrentActivity)
      window.removeEventListener('pointermove', recordCurrentActivity)
      window.removeEventListener('keydown', recordCurrentActivity)
      window.removeEventListener('touchstart', recordCurrentActivity)
      window.removeEventListener('wheel', recordCurrentActivity)
      window.removeEventListener('focus', recordCurrentActivity)
      window.removeEventListener('focus', validateServerState)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [session?.user.id, profileReady, deviceBinding])



  const signOut = useCallback(async () => {
    const supabase = getSupabase()
    let serverSessionsDeactivated = false
    let activeSessionMatch: boolean | null = null
    let activeSessionCheckError: ReturnType<typeof getSessionDiagnosticError> | null = null
    setSignOutWarning(null)
    setSession(null)
    setProfile(null)
    setEntitlement(null)
    setEntitlementStatusUnavailable(false)
    setServerAccess(false)
    setDeviceBlocked(null)
    setDeviceBinding(false)
    setProfileReady(true)
    loadedProfileUserIdRef.current = null
    activatedUserIdRef.current = null

    let activeSessionCheckTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      const activeSessionCheck = await Promise.race([
        supabase.rpc('has_current_active_session'),
        new Promise<null>((resolve) => {
          activeSessionCheckTimeout = setTimeout(() => resolve(null), 1500)
        }),
      ])
      if (activeSessionCheck === null) {
        activeSessionCheckError = { code: 'DIAGNOSTIC_TIMEOUT', message: 'Active-session check timed out' }
      } else if (activeSessionCheck.error) {
        activeSessionCheckError = getSessionDiagnosticError(activeSessionCheck.error)
      } else if (typeof activeSessionCheck.data === 'boolean') {
        activeSessionMatch = activeSessionCheck.data
      } else {
        activeSessionCheckError = {
          code: 'MALFORMED_RESPONSE',
          message: 'Unexpected has_current_active_session response',
        }
      }
    } catch (error) {
      activeSessionCheckError = getSessionDiagnosticError(error)
    } finally {
      if (activeSessionCheckTimeout !== undefined) clearTimeout(activeSessionCheckTimeout)
    }

    let revocationTimeout: ReturnType<typeof setTimeout> | undefined
    let revocationTimedOut = false
    let revocationFailure: 'rpc_error' | 'malformed_response' | null = null
    let responseShape: ReturnType<typeof getJsonShape> | null = null
    let httpStatus: number | null = null
    const revocationStartedAt = performance.now()
    try {
      const response = await Promise.race([
        supabase.rpc('deactivate_current_session'),
        new Promise<never>((_, reject) => {
          revocationTimeout = setTimeout(
            () => {
              revocationTimedOut = true
              reject(new Error('Session revocation timed out'))
            },
            8000,
          )
        }),
      ])
      httpStatus = response.status
      responseShape = getJsonShape(response.data)
      if (response.error) {
        revocationFailure = 'rpc_error'
        throw response.error
      }
      if (
        typeof response.data !== 'object' ||
        response.data === null ||
        Array.isArray(response.data) ||
        !('status' in response.data) ||
        !('deactivated_sessions' in response.data) ||
        typeof response.data.deactivated_sessions !== 'number' ||
        !Number.isInteger(response.data.deactivated_sessions) ||
        response.data.deactivated_sessions < 0 ||
        (response.data.status !== 'deactivated' && response.data.status !== 'inactive') ||
        (response.data.status === 'inactive' && response.data.deactivated_sessions !== 0) ||
        (response.data.status === 'deactivated' && response.data.deactivated_sessions === 0)
      ) {
        revocationFailure = 'malformed_response'
        throw Object.assign(new Error('Unexpected deactivate_current_session response'), {
          code: 'MALFORMED_RESPONSE',
        })
      }
      serverSessionsDeactivated = true
      console.info('Device session logout diagnostic', {
        outcome: 'success',
        httpStatus,
        elapsedMs: Math.round(performance.now() - revocationStartedAt),
        responseShape,
        jwtSessionMatchesActiveSession: activeSessionMatch,
        activeSessionCheckError,
      })
    } catch (error) {
      if (revocationTimedOut) {
        console.warn('Device session logout diagnostic', {
          outcome: 'timeout',
          httpStatus,
          elapsedMs: Math.round(performance.now() - revocationStartedAt),
          error: getSessionDiagnosticError(error),
          responseShape,
          jwtSessionMatchesActiveSession: activeSessionMatch,
          activeSessionCheckError,
        })
      } else {
        const outcome = revocationFailure ?? 'rpc_error'
        console.warn('Device session logout diagnostic', {
          outcome,
          httpStatus,
          elapsedMs: Math.round(performance.now() - revocationStartedAt),
          error: outcome === 'malformed_response'
            ? { code: 'MALFORMED_RESPONSE', message: 'Unexpected deactivate_current_session response' }
            : getSessionDiagnosticError(error),
          responseShape,
          jwtSessionMatchesActiveSession: activeSessionMatch,
          activeSessionCheckError,
        })
      }
      console.error('deactivate_current_session RPC failed:', getSessionDiagnosticError(error))
      setSignOutWarning(
        'ანგარიშიდან გახვედით, მაგრამ ამ მოწყობილობის სესიის გაუქმება სერვერზე ვერ დადასტურდა. შემდეგი შესვლისას წვდომა ხელახლა შემოწმდება.',
      )
    } finally {
      if (revocationTimeout !== undefined) clearTimeout(revocationTimeout)
    }

    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) throw signOutError
    if (serverSessionsDeactivated) setSignOutWarning(null)
  }, [])



  const signUp = useCallback(async (email: string, password: string, fullName: string) => {

    const supabase = getSupabase()

    const { error } = await supabase.auth.signUp({

      email,

      password,

      options: { data: { full_name: fullName } },

    })

    return error?.message ?? null

  }, [])



  const signIn = useCallback(async (email: string, password: string) => {

    setSignOutWarning(null)

    console.log('🔑 signIn: Starting login for:', email)

    const supabase = getSupabase()

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {

      console.error('❌ signIn: Login failed:', error)

      console.error('Error details:', { message: error.message, status: error.status, name: error.name })

    } else {

      console.log('✅ signIn: Login successful', data)

    }

    return error?.message ?? null

  }, [])



  const selectPlan = useCallback(

    async (plan: SubscriptionPlan) => {

      if (!session?.user) return 'ჯერ შედი ანგარიშში'

      const err = await persistPlan(plan)

      if (err) return err

      setProfile((prev) => (prev
        ? { ...prev, subscription_plan: plan }
        : prev))

      await refreshProfile()

      return null

    },

    [session?.user, refreshProfile],

  )



  const appReady = !loading && profileReady

  const hasAccess =
    isAccessActive(profile) && serverAccess && !deviceBinding && !deviceBlocked && !trialExpired

  const needsPlanSelection = Boolean(profile && hasAccess && profileNeedsPlan(profile))

  const features = useMemo(() => resolvePlanFeatures(profile), [profile])



  const value = useMemo<AuthState>(

    () => ({

      loading: !appReady,

      session,

      user: session?.user ?? null,

      profile,

      entitlement,
      entitlementStatusUnavailable,

      hasAccess,

      needsPlanSelection,

      features,

      deviceBlocked,

      signOutWarning,

      refreshProfile,

      selectPlan,

      signUp,

      signIn,

      signOut,

    }),

    [

      appReady,

      session,

      profile,

      entitlement,
      entitlementStatusUnavailable,

      hasAccess,

      needsPlanSelection,

      features,

      deviceBlocked,

      signOutWarning,

      refreshProfile,

      selectPlan,

      signUp,

      signIn,

      signOut,

    ],

  )



  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>

}



export function useAuth() {

  const ctx = useContext(AuthContext)

  if (!ctx) throw new Error('useAuth must be used within AuthProvider')

  return ctx

}



export function usePlanFeatures(fallback?: PlanFeatures) {
  const ctx = useContext(AuthContext)
  if (ctx) return ctx.features
  if (fallback) return fallback
  throw new Error('usePlanFeatures must be used within AuthProvider')
}
