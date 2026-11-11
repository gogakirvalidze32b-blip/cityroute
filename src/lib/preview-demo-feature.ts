export function canUsePreviewDemo({
  dev,
  vercelEnv,
  featureFlag,
  hostname,
}: {
  dev: boolean
  vercelEnv?: string
  featureFlag?: string
  hostname: string
}): boolean {
  if (dev) return hostname === 'localhost' || hostname === '127.0.0.1'
  return (
    featureFlag === 'true' &&
    vercelEnv === 'preview' &&
    hostname.endsWith('.vercel.app')
  )
}

export const PREVIEW_DEMO_AVAILABLE =
  typeof window !== 'undefined' &&
  canUsePreviewDemo({
    dev: import.meta.env.DEV,
    vercelEnv: import.meta.env.VERCEL_ENV,
    featureFlag: import.meta.env.VITE_PREVIEW_DEMO_MODE,
    hostname: window.location.hostname,
  })
