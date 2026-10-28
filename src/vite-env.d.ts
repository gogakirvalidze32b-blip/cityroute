/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Set to "0" to hide the temporary Speed Limit debug panel in any environment. */
  readonly VITE_SPEED_LIMIT_DEBUG?: string
  /** Injected explicitly by vite.config.js to distinguish Vercel Preview from Production. */
  readonly VERCEL_ENV?: 'development' | 'preview' | 'production' | string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
