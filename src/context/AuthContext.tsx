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



const AuthContext = createContext<AuthState | null>(null)



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

async function activateSession(): Promise<SessionActivation> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const { data, error } = await Promise.race([
      getSupabase().rpc('activate_current_session'),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('timeout')), 3000)
      }),
    ])
    if (error) {
      console.error('activate_current_session RPC failed:', error)
      return {
        error: 'სესიის შემოწმება ვერ მოხერხდა. სცადეთ ხელახლა.',
        accessActive: false,
      }
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('Invalid activate_current_session response')
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
    throw new Error('Invalid activate_current_session response status')
  } catch (err) {
    console.error('activateSession error:', err)
    return {
      error: 'სესიის შემოწმება ვერ მოხერხდა. სცადეთ ხელახლა.',
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

  const loadProfile = useCallback(async (userId: string, silent = false) => {
    const hasProfileForUser = loadedProfileUserIdRef.current === userId
    setDeviceBinding(true)
    try {
      setDeviceBlocked(null)
      let profileFetchFailed = false
      try {
        const p = await fetchProfile(userId)
        loadedProfileUserIdRef.current = p ? userId : null
        setProfile(p)
      } catch (error) {
        profileFetchFailed = true
        console.error('Profile loading failed:', error)
        // A failed BACKGROUND refresh must not wipe a good profile (that would redirect to Home).
        if (!silent) {
          loadedProfileUserIdRef.current = null
          setProfile(null)
          setServerAccess(false)
        }
      }

      const activation = await activateSession()
      if (activation.error) {
        activatedUserIdRef.current = null
        setDeviceBlocked(activation.error)
        setServerAccess(false)
      } else if (!profileFetchFailed || !hasProfileForUser) {
        activatedUserIdRef.current = userId
        setDeviceBlocked(null)
        setServerAccess(activation.accessActive)
      }
    } finally {
      setDeviceBinding(false)
      setProfileReady(true)
    }
  }, [])



  const refreshProfile = useCallback(async () => {

    if (!session?.user) {

      setProfile(null)

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

            void loadProfile(nextUserId, true)

            return

          }

          setProfileReady(false)

          void loadProfile(nextUserId)

        }, 0)

      } else {

        loadedProfileUserIdRef.current = null
        activatedUserIdRef.current = null

        setProfile(null)

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
    const supabase = getSupabase()

    const validateServerState = async () => {
      if (!mounted || checking || document.visibilityState === 'hidden') return
      checking = true
      try {
        const [sessionResult, accessResult] = await Promise.all([
          supabase.rpc('has_current_active_session'),
          supabase.rpc('has_active_access', { uid: userId }),
        ])

        if (!mounted) return

        if (sessionResult.error || sessionResult.data !== true) {
          if (sessionResult.error) console.error('Session revalidation failed:', sessionResult.error)
          activatedUserIdRef.current = null
          setServerAccess(false)
          setDeviceBlocked(
            sessionResult.error
              ? 'სესიის სტატუსის გადამოწმება ვერ მოხერხდა. წვდომა დროებით შეზღუდულია.'
              : 'ეს სესია გაუქმებულია. ხელახლა შედით ანგარიშში.',
          )
          if (!sessionResult.error) {
            setSignOutWarning('ეს სესია გაუქმებულია. ხელახლა შედით ანგარიშში.')
            const { error } = await supabase.auth.signOut({ scope: 'local' })
            if (error) console.error('Local sign out after session revocation failed:', error)
          }
          return
        }

        if (accessResult.error || typeof accessResult.data !== 'boolean') {
          if (accessResult.error) console.error('Premium entitlement revalidation failed:', accessResult.error)
          setServerAccess(false)
          setDeviceBlocked('Premium წვდომის სანდო შემოწმება ვერ მოხერხდა. სცადეთ ხელახლა.')
          return
        }

        setServerAccess(accessResult.data)
        setDeviceBlocked(null)
      } catch (error) {
        console.error('Server access revalidation failed:', error)
        if (mounted) {
          setServerAccess(false)
          setDeviceBlocked('სერვერთან კავშირი ვერ მოხერხდა. წვდომა დროებით შეზღუდულია.')
        }
      } finally {
        checking = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void validateServerState()
    }
    const intervalId = window.setInterval(() => void validateServerState(), 30_000)
    window.addEventListener('focus', validateServerState)
    document.addEventListener('visibilitychange', onVisibilityChange)
    void validateServerState()

    return () => {
      mounted = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', validateServerState)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [session?.user.id, profileReady, deviceBinding])



  const signOut = useCallback(async () => {
    const supabase = getSupabase()
    let serverSessionsDeactivated = false
    setSignOutWarning(null)
    setSession(null)
    setProfile(null)
    setServerAccess(false)
    setDeviceBlocked(null)
    setDeviceBinding(false)
    setProfileReady(true)
    loadedProfileUserIdRef.current = null
    activatedUserIdRef.current = null

    try {
      const { data, error } = await supabase.rpc('deactivate_current_session')
      if (error) throw error
      if (
        typeof data !== 'object' ||
        data === null ||
        Array.isArray(data) ||
        !('status' in data) ||
        !('deactivated_sessions' in data) ||
        typeof data.deactivated_sessions !== 'number' ||
        !Number.isInteger(data.deactivated_sessions) ||
        data.deactivated_sessions < 0 ||
        (data.status !== 'deactivated' && data.status !== 'inactive') ||
        (data.status === 'inactive' && data.deactivated_sessions !== 0) ||
        (data.status === 'deactivated' && data.deactivated_sessions === 0)
      ) {
        throw new Error('Unexpected deactivate_current_session response')
      }
      serverSessionsDeactivated = true
    } catch (error) {
      console.error('deactivate_current_session RPC failed:', error)
      setSignOutWarning(
        'ანგარიშიდან გახვედით, მაგრამ ყველა მოწყობილობის სესიის გაუქმება სერვერზე ვერ დადასტურდა. შემდეგი შესვლისას წვდომა ხელახლა შემოწმდება.',
      )
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
