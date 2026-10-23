/**
 * Temporary on-screen Speed Limit debug panel (ExamDriveSession).
 * Enabled in local development and Vercel Preview, but never in Production.
 */
export type SpeedLimitDebugEnvironment = {
  dev: boolean
  vercelEnv?: string
  override?: string
}

export function shouldShowSpeedLimitDebug({
  dev,
  vercelEnv,
  override,
}: SpeedLimitDebugEnvironment): boolean {
  if (override === '0') return false
  return dev || vercelEnv === 'preview'
}

export const SPEED_LIMIT_DEBUG_PANEL =
  import.meta.env.VITE_SPEED_LIMIT_DEBUG !== '0' &&
  (import.meta.env.DEV || import.meta.env.VERCEL_ENV === 'preview')
