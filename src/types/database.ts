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
      device_slot_packages: {
        Row: {
          subscription_plan: string
          device_slots: number
          price_amount: number
          currency: string
          active: boolean
          sort_order: number
          updated_at: string
        }
        Insert: Database['public']['Tables']['device_slot_packages']['Row']
        Update: Partial<Database['public']['Tables']['device_slot_packages']['Row']>
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string | null
          trial_started_at: string
          subscription_status: 'trial' | 'active' | 'expired' | 'cancelled'
          subscription_expires_at: string | null
          subscription_plan: SubscriptionPlan | null
          device_slots: number
          subscription_payment_id: string | null
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
      // Driving-school (ავტოსკოლა) tables — migration 038, isolated from device_slot_packages/profiles.
      driving_school_packages: {
        Row: {
          car_count: 5 | 10
          price_amount: number | null
          currency: 'GEL'
          duration_days: number
          active: boolean
          sort_order: number
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      driving_school_licenses: {
        Row: {
          id: string
          school_id: string
          car_count: 5 | 10
          status: 'active' | 'replaced' | 'revoked'
          source: 'admin' | 'bog'
          price_amount: number | null
          bog_payment_id: string | null
          starts_at: string
          expires_at: string
          granted_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      driving_school_cars: {
        Row: {
          id: string
          school_id: string
          slot_number: number
          label: string
          status: 'active' | 'disabled'
          android_device_id: string | null
          device_bound_at: string | null
          device_last_seen_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      driving_schools: {
        Row: {
          id: string
          owner_id: string
          name: string
          contact_name: string
          contact_phone: string
          contact_email: string
          address: string
          city: string
          registration_code: string | null
          verification_info: string
          status: 'pending' | 'approved' | 'rejected'
          review_note: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          submitted_at: string
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      owner_upsert_driving_school_car: {
        Args: { p_slot_number: number; p_label: string }
        Returns: string
      }
      owner_set_driving_school_car_status: {
        Args: { p_car_id: string; p_action: 'disable' | 'enable' | 'release_device' }
        Returns: undefined
      }
      admin_review_driving_school: {
        Args: { p_school_id: string; p_decision: 'approved' | 'rejected'; p_note?: string | null }
        Returns: undefined
      }
      admin_grant_driving_school_license: {
        Args: { p_school_id: string; p_car_count: 5 | 10; p_duration_days?: number | null }
        Returns: string
      }
      submit_driving_school_application: {
        Args: {
          p_name: string
          p_contact_name: string
          p_contact_phone: string
          p_contact_email: string
          p_address: string
          p_city: string
          p_registration_code: string
          p_verification_info: string
        }
        Returns: string
      }
      activate_current_session: {
        Args: Record<string, never>
        Returns: Json
      }
      admin_list_device_sessions: {
        Args: { p_profile_id: string }
        Returns: {
          session_id: string
          session_created_at: string
          activated_at: string
          last_activity_at: string
          last_seen_at: string
          status: string
          revoked_at: string | null
        }[]
      }
      admin_revoke_device_session: {
        Args: { p_profile_id: string; p_session_id: string; p_reason: string }
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
      create_exam_session: {
        Args: {
          p_route_slug: string
          p_device_id: string
          p_tab_id?: string | null
          p_progress?: Json
          p_errors?: Json
          p_elapsed_ms?: number
          p_started_at?: string | null
          p_migration_key?: string | null
          p_status?: string
        }
        Returns: Json
      }
      get_exam_session: {
        Args: { p_session_id: string }
        Returns: Json
      }
      list_active_exam_sessions: {
        Args: Record<string, never>
        Returns: Json
      }
      update_exam_session: {
        Args: {
          p_session_id: string
          p_expected_version: number
          p_status: string
          p_progress: Json
          p_errors: Json
          p_elapsed_ms: number
        }
        Returns: Json
      }
      finish_exam_session: {
        Args: {
          p_session_id: string
          p_expected_version: number
          p_progress: Json
          p_errors: Json
          p_elapsed_ms: number
          p_summary: Json
        }
        Returns: Json
      }
      abandon_exam_session: {
        Args: { p_session_id: string; p_expected_version: number }
        Returns: Json
      }
      grant_device_session_limit_override: {
        Args: { p_profile_id: string; p_reason: string; p_session_limit: number }
        Returns: { override_id: number; granted_at: string }[]
      }
      get_device_session_limit_override: {
        Args: { p_profile_id: string }
        Returns: {
          override_id: number
          session_limit: number
          granted_at: string
          grant_reason: string
        }[]
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
      get_current_account_entitlement: {
        Args: Record<string, never>
        Returns: Json
      }
      heartbeat_current_session: {
        Args: Record<string, never>
        Returns: Json
      }
      presence_current_session: {
        Args: Record<string, never>
        Returns: Json
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
  const expiresAt = profile.subscription_expires_at
  if (profile.subscription_status === 'active') {
    return expiresAt === null || new Date(expiresAt).getTime() > Date.now()
  }
  if (profile.subscription_status === 'trial') {
    return expiresAt !== null && new Date(expiresAt).getTime() > Date.now()
  }
  return false
}

export function accessLabel(profile: Profile | null): string {
  if (!profile) return ''
  if (profile.subscription_status === 'trial') {
    if (profile.subscription_expires_at === null) return 'საცდელი პერიოდი დასრულებულია'
    const ms = new Date(profile.subscription_expires_at).getTime() - Date.now()
    if (ms <= 0) return 'საცდელი პერიოდი დასრულებულია'
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const planNote = profile.subscription_plan ? '' : ' · აირჩიე პაკეტი'
    return `საცდელი: ${h} სთ ${m} წთ დარჩა${planNote}`
  }
  if (profile.subscription_status === 'active') {
    if (profile.subscription_payment_id) {
      return `გადახდილი Premium · ${profile.subscription_plan ? planName(profile.subscription_plan) : 'აქტიური'}`
    }
    if (profile.subscription_plan) return `აქტიური · ${planName(profile.subscription_plan)}`
    return 'ძველი აქტიური გამოწერა'
  }
  return 'გამოწერა არ არის აქტიური'
}

export function routeSourceLabel(source: 'local' | 'merged'): string {
  return source === 'merged' ? 'ონლაინ' : 'ოფლაინ'
}
