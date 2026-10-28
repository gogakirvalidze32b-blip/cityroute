/**
 * Temporary on-screen Speed Limit debug panel (ExamDriveSession).
 * Enabled in local development and Vercel Preview, but never in Production.
 */
export type SpeedLimitDebugEnvironment = {
  dev: boolean
  vercelEnv?: string
  override?: string
}

export function isPreviewFeatureEnabled({
  dev,
  vercelEnv,
}: Pick<SpeedLimitDebugEnvironment, 'dev' | 'vercelEnv'>): boolean {
  return dev || isVercelPreview(vercelEnv)
}

export function isVercelPreview(vercelEnv?: string): boolean {
  return vercelEnv === 'preview'
}

export function shouldShowSpeedLimitDebug({
  dev,
  vercelEnv,
  override,
}: SpeedLimitDebugEnvironment): boolean {
  if (override === '0') return false
  return isPreviewFeatureEnabled({ dev, vercelEnv })
}

export const PREVIEW_TEST_ROUTE_ENABLED = isVercelPreview(import.meta.env.VERCEL_ENV)

export const SPEED_LIMIT_DEBUG_PANEL =
  import.meta.env.VITE_SPEED_LIMIT_DEBUG !== '0' &&
  (import.meta.env.DEV || PREVIEW_TEST_ROUTE_ENABLED)
