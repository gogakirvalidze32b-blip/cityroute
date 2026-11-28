import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  value: { user: null as null | { id: string; email?: string }, loading: false },
  signOut: vi.fn(async () => {}),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ ...auth.value, signOut: auth.signOut }) }))

const api = vi.hoisted(() => ({
  checkIsSupportAdmin: vi.fn(),
  adminListConversations: vi.fn(),
  adminSetStatus: vi.fn(),
  subscribeToAdminFeed: vi.fn(() => () => undefined),
  subscribeToThread: vi.fn(() => () => undefined),
  fetchMessages: vi.fn(),
  fetchAttachmentsFor: vi.fn(),
  sendMessage: vi.fn(),
  markRead: vi.fn(),
  signPaths: vi.fn(),
  triggerEmailNotifications: vi.fn(),
  db: vi.fn(() => ({})),
  toSupportError: (e: { message?: string }) => ({ userMessage: 'ERR', code: 'unknown', transient: false, message: e?.message }),
}))
vi.mock('@/lib/support/api', () => api)

const panel = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('@/components/admin/DrivingSchoolsAdminPanel', () => ({
  DrivingSchoolsAdminPanel: () => {
    panel.render()
    return <h2>Driving Schools panel</h2>
  },
}))

import { SupportAdminPage } from './SupportAdminPage'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderAt(path = '/support-admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/support-admin" element={<SupportAdminPage />} />
        <Route path="/login" element={<h1>Login</h1>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

const conv = {
  id: 'conv-2', user_id: 'aaaaaaaa-0000-4000-8000-000000000000', status: 'open',
  last_message_at: '2026-10-15T10:00:00Z', last_message_preview: 'გამარჯობა', last_sender_type: 'user',
  admin_unread_count: 0, created_at: '2026-10-15T09:00:00Z', full_name: 'ნინო', email: 'nino@example.com',
}

describe('/support-admin section tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.value = { user: { id: 'admin-1', email: 'cityroute.ge@gmail.com' }, loading: false }
    api.checkIsSupportAdmin.mockResolvedValue(true)
    api.adminListConversations.mockResolvedValue([conv])
    api.fetchMessages.mockResolvedValue({ messages: [], attachments: {}, hasMore: false })
    api.fetchAttachmentsFor.mockResolvedValue({})
    api.markRead.mockResolvedValue(undefined)
    api.signPaths.mockResolvedValue(new Map())
  })

  it('shows no tabs and no Driving Schools panel to a non-admin', async () => {
    api.checkIsSupportAdmin.mockResolvedValue(false)
    renderAt('/support-admin?tab=schools')
    expect(await screen.findByText('წვდომა შეზღუდულია')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'ავტოსკოლები' })).toBeNull()
    expect(panel.render).not.toHaveBeenCalled()
  })

  it('admin-only e-mail WITHOUT admin rights gets access denied (no auto-grant) and can sign out', async () => {
    api.checkIsSupportAdmin.mockResolvedValue(false)
    renderAt()
    expect(await screen.findByText('წვდომა შეზღუდულია')).toBeInTheDocument()
    expect(api.checkIsSupportAdmin).toHaveBeenCalled()
    expect(screen.queryByRole('tab', { name: 'მხარდაჭერის ჩატი' })).toBeNull()
    expect(api.adminListConversations).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /უკან/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ანგარიშიდან გასვლა' }))
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce())
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })

  it('authorized admin-only account sees the admin tabs plus a sign-out button', async () => {
    renderAt()
    expect(await screen.findByRole('tab', { name: 'მხარდაჭერის ჩატი' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'ავტოსკოლები' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ანგარიშიდან გასვლა' })).toBeInTheDocument()
  })

  it('other admins keep the page exactly as before (no extra sign-out button)', async () => {
    auth.value = { user: { id: 'admin-2', email: 'gogakirvalidze@gmail.com' }, loading: false }
    renderAt()
    expect(await screen.findByRole('tab', { name: 'მხარდაჭერის ჩატი' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ანგარიშიდან გასვლა' })).toBeNull()
  })

  it('opens on Support Chat by default, with the existing chat workspace', async () => {
    renderAt()
    expect(await screen.findByRole('tab', { name: 'მხარდაჭერის ჩატი' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('ნინო')).toBeInTheDocument()
    expect(panel.render).not.toHaveBeenCalled()
  })

  it('?tab=schools opens the Driving Schools tab without loading the chat list', async () => {
    renderAt('/support-admin?tab=schools')
    expect(await screen.findByRole('heading', { name: 'Driving Schools panel' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'ავტოსკოლები' })).toHaveAttribute('aria-selected', 'true')
    expect(api.adminListConversations).not.toHaveBeenCalled()
  })

  it('switching tabs sets/removes ?tab=schools and keeps the conversation ?c= parameter', async () => {
    renderAt('/support-admin?c=conv-2')
    expect(await screen.findByPlaceholderText('დაწერე პასუხი...')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'ავტოსკოლები' }))
    expect(await screen.findByRole('heading', { name: 'Driving Schools panel' })).toBeInTheDocument()
    const afterSchools = new URLSearchParams(screen.getByTestId('location').textContent ?? '')
    expect(afterSchools.get('tab')).toBe('schools')
    expect(afterSchools.get('c')).toBe('conv-2')

    fireEvent.click(screen.getByRole('tab', { name: 'მხარდაჭერის ჩატი' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Driving Schools panel' })).toBeNull())
    const afterChat = new URLSearchParams(screen.getByTestId('location').textContent ?? '')
    expect(afterChat.has('tab')).toBe(false)
    expect(afterChat.get('c')).toBe('conv-2')
    expect(await screen.findByPlaceholderText('დაწერე პასუხი...')).toBeInTheDocument()
  })
})
