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



const LOCAL_PLAN_KEY = 'cityroute-plan'



function localPlanKey(userId: string) {

  return `${LOCAL_PLAN_KEY}-${userId}`

}



function readLocalPlan(userId: string): SubscriptionPlan | null {

  try {

    const raw = localStorage.getItem(localPlanKey(userId))

    if (raw === 'nav' || raw === 'panel' || raw === 'full') return raw as SubscriptionPlan

  } catch {

    /* ignore */

  }

  return null

}



function writeLocalPlan(userId: string, plan: SubscriptionPlan) {

  try {

    localStorage.setItem(localPlanKey(userId), plan)

  } catch {

    /* ignore */

  }

}



function mergeProfilePlan(profile: Profile | null, userId: string): Profile | null {

  if (!profile) return null

  if (profile.subscription_plan) return profile

  const local = readLocalPlan(userId)

  if (!local) return profile

  return { ...profile, subscription_plan: local }

}



type AuthState = {

  loading: boolean

  session: Session | null

  user: User | null

  profile: Profile | null

  hasAccess: boolean

  needsPlanSelection: boolean

  features: PlanFeatures

  deviceBlocked: string | null

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

  return mergeProfilePlan(data, userId)

}



async function activateSession(): Promise<string | null> {
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
      return 'სესიის შემოწმება ვერ მოხერხდა. სცადეთ ხელახლა.'
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('Invalid activate_current_session response')
    }
    if ('status' in data && data.status === 'active') return null
    if (
      'status' in data &&
      data.status === 'blocked' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message
    }
    throw new Error('Invalid activate_current_session response status')
  } catch (err) {
    console.error('activateSession error:', err)
    return 'სესიის შემოწმება ვერ მოხერხდა. სცადეთ ხელახლა.'
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}



async function persistPlan(
  userId: string,
  plan: SubscriptionPlan,
): Promise<string | null> {

  const supabase = getSupabase()

  const { error: rpcError } = await supabase.rpc('select_subscription_plan', { chosen: plan })

  if (rpcError) return rpcError.message

  writeLocalPlan(userId, plan)

  return null

}



export function AuthProvider({ children }: { children: ReactNode }) {

  const [loading, setLoading] = useState(true)

  const [session, setSession] = useState<Session | null>(null)

  const [profile, setProfile] = useState<Profile | null>(null)

  const [profileReady, setProfileReady] = useState(false)

  const [deviceBlocked, setDeviceBlocked] = useState<string | null>(null)

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

  const loadProfile = useCallback(async (userId: string, silent = false) => {
    const hasProfileForUser = loadedProfileUserIdRef.current === userId
    setDeviceBinding(true)
    try {
      setDeviceBlocked(null)
      const sessionError = await activateSession()
      if (sessionError) {
        setDeviceBlocked(sessionError)
        if (!silent && !hasProfileForUser) {
          loadedProfileUserIdRef.current = null
          setProfile(null)
        }
        return
      }
      const p = await fetchProfile(userId)
      loadedProfileUserIdRef.current = p ? userId : null
      setProfile(p)
      setDeviceBlocked(null)
    } catch (e) {
      console.error(e)
      // A failed BACKGROUND refresh must not wipe a good profile (that would redirect to Home).
      if (!silent) {
        loadedProfileUserIdRef.current = null
        setProfile(null)
        setDeviceBlocked(null)
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

        setProfile(null)

        setDeviceBlocked(null)

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



  const signOut = useCallback(async () => {
    const supabase = getSupabase()
    const { data, error } = await supabase.rpc('deactivate_current_session')
    if (error) {
      console.error('deactivate_current_session RPC failed:', error)
      throw error
    }
    if (
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data) ||
      !('status' in data) ||
      (data.status !== 'deactivated' && data.status !== 'inactive')
    ) {
      throw new Error('სესიის გაუქმება ვერ მოხერხდა')
    }
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) throw signOutError
    setProfile(null)
    setDeviceBlocked(null)
    setDeviceBinding(false)
    setProfileReady(true)
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

      const err = await persistPlan(session.user.id, plan)

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

  const hasAccess = isAccessActive(profile) && !deviceBinding && !deviceBlocked && !trialExpired

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
