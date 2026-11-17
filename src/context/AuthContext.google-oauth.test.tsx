// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'

const signInWithOAuth = vi.fn()

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      signInWithOAuth,
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  }),
}))

vi.mock('@/lib/device', () => ({
  getDeviceFingerprint: () => 'test-device',
  getExamTabId: () => 'test-tab',
}))

vi.mock('@/lib/exam-session-edge', () => ({
  revokeExamTab: async () => undefined,
}))

describe('signInWithGoogle OAuth options', () => {
  beforeEach(() => {
    signInWithOAuth.mockReset()
    signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com', provider: 'google' }, error: null })
  })

  it('calls signInWithOAuth with google and origin redirect', async () => {
    const { AuthProvider, useAuth } = await import('./AuthContext')
    const React = await import('react')
    const { render, act } = await import('@testing-library/react')

    let api: ReturnType<typeof useAuth> | null = null
    function Probe() {
      api = useAuth()
      return null
    }

    render(
      React.createElement(AuthProvider, null, React.createElement(Probe)),
    )

    await act(async () => {
      const err = await api!.signInWithGoogle()
      expect(err).toBeNull()
    })

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { prompt: 'select_account' },
      },
    })
  })
})
