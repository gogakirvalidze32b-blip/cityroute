import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useState,

  type ReactNode,

} from 'react'

import type { Session, User } from '@supabase/supabase-js'

import type { SubscriptionPlan } from '@/data/subscription-plans'

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

import { getDeviceFingerprint, parseDeviceBindResult } from '@/lib/device'

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

    if (raw === 'nav' || raw === 'panel' || raw === 'full') return raw

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



async function persistPlan(userId: string, plan: SubscriptionPlan): Promise<string | null> {

  writeLocalPlan(userId, plan)



  const supabase = getSupabase()

  const { error: rpcError } = await supabase.rpc('select_subscription_plan', { chosen: plan })

  if (!rpcError) return null



  const { error: updateError } = await supabase

    .from('profiles')

    .update({ subscription_plan: plan })

    .eq('id', userId)



  if (updateError) {

    if (updateError.message.includes('subscription_plan')) {

      return null

    }

    return updateError.message

  }



  return null

}



export function AuthProvider({ children }: { children: ReactNode }) {

  const [loading, setLoading] = useState(true)

  const [session, setSession] = useState<Session | null>(null)

  const [profile, setProfile] = useState<Profile | null>(null)

  const [profileReady, setProfileReady] = useState(false)

  const [deviceBlocked, setDeviceBlocked] = useState<string | null>(null)



  const loadProfile = useCallback(async (userId: string) => {

    try {

      const p = await fetchProfile(userId)

      setProfile(p)

      setDeviceBlocked(null)

      if (p && isAccessActive(p)) {

        void bindDevice()

          .then((blockMsg) => setDeviceBlocked(blockMsg))

          .catch((e) => console.error(e))

      }

    } catch (e) {

      console.error(e)

      setProfile(null)

      setDeviceBlocked(null)

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

        window.setTimeout(() => {

          if (!mounted) return

          setProfileReady(false)

          void loadProfile(nextSession.user!.id)

        }, 0)

      } else {

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



  const selectPlan = useCallback(

    async (plan: SubscriptionPlan) => {

      if (!session?.user) return 'ჯერ შედი ანგარიშში'

      const err = await persistPlan(session.user.id, plan)

      if (err) return err

      setProfile((prev) => (prev ? { ...prev, subscription_plan: plan } : prev))

      await refreshProfile()

      return null

    },

    [session?.user, refreshProfile],

  )



  const appReady = !loading && profileReady

  const hasAccess = isAccessActive(profile) && !deviceBlocked

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



export function usePlanFeatures() {

  return useAuth().features

}


