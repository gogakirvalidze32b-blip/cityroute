import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getDeviceFingerprint } from '@/lib/device'
import type { Database } from '@/types/database'

export function normalizeSupabaseProjectUrl(configuredUrl: string | undefined): string | undefined {
  if (!configuredUrl?.trim()) return undefined

  try {
    const projectUrl = new URL(configuredUrl.trim())
    if (projectUrl.protocol !== 'https:' && projectUrl.protocol !== 'http:') {
      return undefined
    }
    if (projectUrl.pathname.replace(/\/+$/, '') === '/rest/v1') {
      projectUrl.pathname = '/'
    }
    return projectUrl.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

const url = normalizeSupabaseProjectUrl(import.meta.env.VITE_SUPABASE_URL)
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey && !anonKey.includes('your_anon'))

let client: SupabaseClient<Database> | null = null

export function getSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Copy .env.example to .env')
  }
  if (!client) {
    client = createClient<Database>(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
      global: {
        headers: {
          'x-cityroute-device-fingerprint': getDeviceFingerprint(),
        },
        fetch: (url, options = {}) => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 წამი timeout
          
          return fetch(url, {
            ...options,
            signal: controller.signal,
          }).finally(() => clearTimeout(timeoutId))
        },
      },
    })
  }
  return client
}
