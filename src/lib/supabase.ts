import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Debug logging
console.log('🔍 Supabase Config Check:', {
  url: url ? `${url.substring(0, 30)}...` : 'MISSING',
  anonKey: anonKey ? `${anonKey.substring(0, 20)}...` : 'MISSING',
  hasUrl: !!url,
  hasAnonKey: !!anonKey,
  isPlaceholder: anonKey?.includes('your_anon'),
})

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
