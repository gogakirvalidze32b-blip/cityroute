import { planName } from '@/data/subscription-plans'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

import type { SubscriptionPlan } from '@/data/subscription-plans'

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          trial_started_at: string
          subscription_status: 'trial' | 'active' | 'expired' | 'cancelled'
          subscription_expires_at: string
          subscription_plan: SubscriptionPlan | null
          device_slots: number
          device_fingerprint: string | null
          device_bound_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
        Relationships: []
      }
      cities: {
        Row: {
          id: string
          slug: string
          name_ka: string
          name_en: string
          center_lat: number
          center_lng: number
          zoom: number
          active: boolean
          sort_order: number
        }
        Insert: Database['public']['Tables']['cities']['Row']
        Update: Partial<Database['public']['Tables']['cities']['Row']>
        Relationships: []
      }
      routes: {
        Row: {
          id: string
          city_id: string
          slug: string
          name_ka: string
          official_label: string | null
          polyline: [number, number][]
          sort_order: number
          active: boolean
          license_category: string | null
        }
        Insert: Omit<Database['public']['Tables']['routes']['Row'], 'id'> & { id?: string }
        Update: Partial<Database['public']['Tables']['routes']['Row']>
        Relationships: []
      }
      pins: {
        Row: {
          id: string
          route_id: string
          lat: number
          lng: number
          radius_m: number
          trigger_distance_m: number
          instruction_ka: string
          audio_url: string | null
          sort_order: number
          active: boolean
        }
        Insert: Omit<Database['public']['Tables']['pins']['Row'], 'id'> & { id?: string }
        Update: Partial<Database['public']['Tables']['pins']['Row']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      activate_current_session: {
        Args: Record<string, never>
        Returns: Json
      }
      bind_device: {
        Args: { fp: string }
        Returns: Json
      }
      current_device_session_limit: {
        Args: { p_profile_id: string }
        Returns: number
      }
      deactivate_current_session: {
        Args: Record<string, never>
        Returns: Json
      }
      grant_device_session_limit_override: {
        Args: { p_profile_id: string; p_reason: string }
        Returns: { override_id: number; granted_at: string }[]
      }
      has_current_active_session: {
        Args: Record<string, never>
        Returns: boolean
      }
      revoke_device_session_limit_override: {
        Args: { p_override_id: number; p_reason: string }
        Returns: undefined
      }
      has_active_access: {
        Args: { uid: string }
        Returns: boolean
      }
      select_subscription_plan: {
        Args: { chosen: string }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type RouteRow = Database['public']['Tables']['routes']['Row']
export type PinRow = Database['public']['Tables']['pins']['Row']

export type RouteWithPins = RouteRow & { pins: PinRow[] }

export function isAccessActive(profile: Profile | null): boolean {
  if (!profile) return false
  const expires = new Date(profile.subscription_expires_at).getTime()
  if (profile.subscription_status === 'active') return expires > Date.now() || !profile.subscription_expires_at
  if (profile.subscription_status === 'trial') return expires > Date.now()
  return false
}

export function accessLabel(profile: Profile | null): string {
  if (!profile) return ''
  if (profile.subscription_status === 'trial') {
    const ms = new Date(profile.subscription_expires_at).getTime() - Date.now()
    if (ms <= 0) return 'საცდელი პერიოდი დასრულებულია'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const planNote = profile.subscription_plan ? '' : ' · აირჩიე პაკეტი'
    return `საცდელი: ${h} სთ ${m} წთ დარჩა${planNote}`
  }
  if (profile.subscription_status === 'active') {
    if (profile.subscription_plan) return `აქტიური · ${planName(profile.subscription_plan)}`
    return 'აქტიური გამოწერა'
  }
  return 'გამოწერა არ არის აქტიური'
}

export function routeSourceLabel(source: 'local' | 'merged'): string {
  return source === 'merged' ? 'ონლაინ' : 'ოფლაინ'
}
