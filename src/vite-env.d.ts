/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Set to "0" to hide the temporary Speed Limit debug panel. */
  readonly VITE_SPEED_LIMIT_DEBUG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
