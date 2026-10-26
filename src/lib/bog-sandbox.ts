import { normalizeSupabaseProjectUrl } from '@/lib/supabase'

const PRODUCTION_SUPABASE_PROJECT_REF = 'tuylbbdhvfcobxynwtnt'

export function getBogSandboxPaymentBlockReason(
  supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL,
  deploymentEnvironment: string | undefined = import.meta.env.VERCEL_ENV,
): string | null {
  if (deploymentEnvironment !== 'preview') {
    return 'BOG Sandbox გადახდა ხელმისაწვდომია მხოლოდ Vercel Preview-ზე.'
  }

  const normalizedUrl = normalizeSupabaseProjectUrl(supabaseUrl)
  if (!normalizedUrl) return 'BOG Sandbox backend ჯერ კონფიგურირებული არ არის.'

  const { hostname } = new URL(normalizedUrl)
  if (hostname === `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`) {
    return 'გადახდა დაბლოკილია: Preview Production Supabase პროექტს იყენებს.'
  }

  return null
}
