import type { SubscriptionPlan } from '@/data/subscription-plans'
import { isAccessActive, type Profile } from '@/types/database'

export type PlanFeatures = {
  routeAudio: boolean
  mapNav: boolean
  errorPanel: boolean
  canSwitchViews: boolean
}

const FULL_FEATURES: PlanFeatures = {
  routeAudio: true,
  mapNav: true,
  errorPanel: true,
  canSwitchViews: true,
}

const PLAN_MATRIX: Record<SubscriptionPlan, PlanFeatures> = {
  premium: FULL_FEATURES,
}

export function isTrialActive(profile: Profile | null): boolean {
  if (!profile) return false
  if (profile.subscription_status !== 'trial') return false
  return new Date(profile.subscription_expires_at).getTime() > Date.now()
}

export function needsPlanSelection(profile: Profile | null): boolean {
  if (!profile) return false
  return profile.subscription_plan == null
}

export function resolvePlanFeatures(profile: Profile | null): PlanFeatures {
  if (!profile || !isAccessActive(profile)) {
    return {
      routeAudio: false,
      mapNav: false,
      errorPanel: false,
      canSwitchViews: false,
    }
  }

  const plan = profile.subscription_plan ?? 'premium'
  return PLAN_MATRIX[plan]
}
