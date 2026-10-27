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

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

import { getDeviceFingerprint, parseDeviceBindResult } from '@/lib/device'

import {

  needsPlanSelection as profileNeedsPlan,

  resolvePlanFeatures,

  type PlanFeatures,

} from '@/lib/plan-features'

import { isAccessActive, trialExpiresAt, type Profile } from '@/types/database'



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

  selectPackage: (deviceSlots: number) => Promise<string | null>

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



async function bindDevice(): Promise<string | null> {

  if (import.meta.env.DEV) return null

  try {

    const supabase = getSupabase()

    const fp = getDeviceFingerprint()

    const { data, error } = await Promise.race([

      supabase.rpc('bind_device', { fp }),

      new Promise<{ data: null; error: { message: string } }>((resolve) =>

        setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), 3000)

      ),

    ])

    if (error) {

      if (error.message === 'timeout') return null // Timeout არ უნდა აბლოკოს login-ს

      return error.message

    }

    const result = parseDeviceBindResult(data)

    if (result.status === 'blocked') return result.message

    return null

  } catch (err) {

    console.error('bindDevice error:', err)

    return null // არ უნდა აბლოკოს login-ს

  }

}



export function AuthProvider({ children }: { children: ReactNode }) {

  const [loading, setLoading] = useState(true)

  const [session, setSession] = useState<Session | null>(null)

  const [profile, setProfile] = useState<Profile | null>(null)

  const [profileReady, setProfileReady] = useState(false)

  const [deviceBlocked, setDeviceBlocked] = useState<string | null>(null)

  const [expiredTrialTimestamp, setExpiredTrialTimestamp] = useState<string | null>(null)

  useEffect(() => {
    if (profile?.subscription_status !== 'trial') {
      setExpiredTrialTimestamp(null)
      return
    }

    const expiration = trialExpiresAt(profile)
    const remainingMs = expiration - Date.now()
    if (remainingMs <= 0) {
      setExpiredTrialTimestamp(profile.subscription_expires_at)
      return
    }

    setExpiredTrialTimestamp(null)
    const expirationTimestamp = profile.subscription_expires_at
    const timeoutId = window.setTimeout(() => setExpiredTrialTimestamp(expirationTimestamp), remainingMs)
    return () => window.clearTimeout(timeoutId)
  }, [profile?.subscription_status, profile?.subscription_expires_at])



  // User id whose profile is currently loaded. Lets a repeated SIGNED_IN / TOKEN_REFRESHED for the
  // SAME user (supabase-js fires it on every tab hidden→visible) refresh silently instead of
  // flipping the app back to "loading" and unmounting the active exam.
  const loadedProfileUserIdRef = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string, silent = false) => {

    try {

      const p = await fetchProfile(userId)

      loadedProfileUserIdRef.current = p ? userId : null

      setProfile(p)

      setDeviceBlocked(null)

      if (p && isAccessActive(p)) {

        void bindDevice()

          .then((blockMsg) => setDeviceBlocked(blockMsg))

          .catch((e) => console.error(e))

      }

    } catch (e) {

      console.error(e)

      // A failed BACKGROUND refresh must not wipe a good profile (that would redirect to Home).
      if (!silent) {

        loadedProfileUserIdRef.current = null

        setProfile(null)

        setDeviceBlocked(null)

      }

    } finally {

      setProfileReady(true)

    }

  }, [])



  const refreshProfile = useCallback(async () => {

    if (!session?.user) {

      setProfile(null)

      setDeviceBlocked(null)

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

    await supabase.auth.signOut()

    setProfile(null)

    setDeviceBlocked(null)

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



  const selectPackage = useCallback(
    async (deviceSlots: number) => {
      if (!session?.user) return 'ჯერ შედი ანგარიშში'
      if (deviceSlots !== 1 && deviceSlots !== 2) return 'აირჩიე 1 ან 2 ავტომობილი'

      const { error } = await getSupabase().rpc('select_subscription_package', {
        p_device_slots: deviceSlots,
      })
      if (error) return error.message

      await refreshProfile()
      return null
    },
    [session?.user, refreshProfile],
  )



  const appReady = !loading && profileReady

  const trialExpired = profile?.subscription_status === 'trial' &&
    expiredTrialTimestamp === profile.subscription_expires_at

  const hasAccess = isAccessActive(profile) && !deviceBlocked && !trialExpired

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

      selectPackage,

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

      selectPackage,

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



export function usePlanFeatures() {

  return useAuth().features

}
