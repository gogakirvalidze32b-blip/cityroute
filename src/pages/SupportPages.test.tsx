import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ value: { user: null as any, loading: false } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth.value }))

const api = vi.hoisted(() => ({
  checkIsSupportAdmin: vi.fn(),
  adminListConversations: vi.fn(),
  adminSetStatus: vi.fn(),
  subscribeToAdminFeed: vi.fn(() => () => undefined),
  subscribeToThread: vi.fn(() => () => undefined),
  subscribeToMyConversation: vi.fn(() => () => undefined),
  getOrCreateConversation: vi.fn(),
  fetchMessages: vi.fn(),
  fetchAttachmentsFor: vi.fn(),
  fetchMyUnreadCount: vi.fn(),
  sendMessage: vi.fn(),
  markRead: vi.fn(),
  signPaths: vi.fn(),
  triggerEmailNotifications: vi.fn(),
  db: vi.fn(() => ({})),
  toSupportError: (e: any) => ({ userMessage: 'ERR', code: 'unknown', transient: false, message: e?.message }),
}))
vi.mock('@/lib/support/api', () => api)

import { SupportAdminPage } from './SupportAdminPage'
import { SupportChatPage } from './SupportChatPage'

const renderAt = (ui: React.ReactElement, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

const convRow = (o: any = {}) => ({
  id: 'conv-1', user_id: 'aaaaaaaa-0000-4000-8000-000000000000', status: 'open',
  last_message_at: '2026-10-15T10:00:00Z', last_message_preview: 'ვერ ვიხდი', last_sender_type: 'user',
  admin_unread_count: 2, created_at: '2026-10-15T09:00:00Z', full_name: 'ნინო', email: 'nino@example.com', ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  auth.value = { user: null, loading: false }
  api.fetchMessages.mockResolvedValue({ messages: [], attachments: {}, hasMore: false })
  api.fetchAttachmentsFor.mockResolvedValue({})
  api.markRead.mockResolvedValue(undefined)
  api.signPaths.mockResolvedValue(new Map())
  api.fetchMyUnreadCount.mockResolvedValue(0)
})

describe('Admin page — access control', () => {
  it('signed-out visitor is asked to log in and NO data call is made', () => {
    renderAt(<SupportAdminPage />)
    expect(screen.getByText(/ჯერ შედი ანგარიშში/)).toBeInTheDocument()
    expect(api.checkIsSupportAdmin).not.toHaveBeenCalled()
    expect(api.adminListConversations).not.toHaveBeenCalled()
  })

  it('a normal signed-in user (DB says not admin) sees "forbidden" and never loads the list', async () => {
    auth.value = { user: { id: 'u1', email: 'owner@cityroute.ge' }, loading: false }
    api.checkIsSupportAdmin.mockResolvedValue(false)
    renderAt(<SupportAdminPage />)
    expect(await screen.findByText('წვდომა შეზღუდულია')).toBeInTheDocument()
    expect(screen.getByText(/ახლა შესული ხარ როგორც/)).toHaveTextContent('owner@cityroute.ge')
    expect(screen.getByText(/insert into public\.support_admins/i)).toHaveTextContent("email = 'owner@cityroute.ge'")
    expect(api.adminListConversations).not.toHaveBeenCalled()
    expect(api.subscribeToAdminFeed).not.toHaveBeenCalled()
  })

  it('a failing admin check fails CLOSED (no panel)', async () => {
    auth.value = { user: { id: 'u1' }, loading: false }
    api.checkIsSupportAdmin.mockRejectedValue(new Error('network'))
    renderAt(<SupportAdminPage />)
    expect(await screen.findByText('წვდომა შეზღუდულია')).toBeInTheDocument()
    expect(api.adminListConversations).not.toHaveBeenCalled()
  })

  it('a client-side "is_admin" claim is ignored: only the DB answer counts', async () => {
    auth.value = { user: { id: 'u1', user_metadata: { is_admin: true }, app_metadata: { role: 'admin' } }, loading: false }
    api.checkIsSupportAdmin.mockResolvedValue(false)
    renderAt(<SupportAdminPage />)
    expect(await screen.findByText('წვდომა შეზღუდულია')).toBeInTheDocument()
  })
})

describe('Admin page — workspace', () => {
  beforeEach(() => {
    auth.value = { user: { id: 'admin-1' }, loading: false }
    api.checkIsSupportAdmin.mockResolvedValue(true)
    api.adminListConversations.mockResolvedValue([convRow(), convRow({ id: 'conv-2', full_name: null, email: null, status: 'waiting', admin_unread_count: 0, last_message_preview: 'მადლობა' })])
  })

  it('lists conversations with name, preview, status and unread counts', async () => {
    renderAt(<SupportAdminPage />)
    expect(await screen.findByText('ნინო')).toBeInTheDocument()
    expect(screen.getByText('ვერ ვიხდი')).toBeInTheDocument()
    expect(screen.getAllByText('პასუხის მოლოდინში').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('2') // total unread badge
  })

  it('filters by status through the server call', async () => {
    renderAt(<SupportAdminPage />)
    await screen.findByText('ნინო')
    fireEvent.click(screen.getByRole('tab', { name: 'ღია' }))
    await waitFor(() => expect(api.adminListConversations).toHaveBeenLastCalledWith('open'))
  })

  it('opens a conversation, shows messages and replies as admin; images are not offered to admin', async () => {
    api.fetchMessages.mockResolvedValue({ messages: [{ id: 'm1', conversation_id: 'conv-1', sender_id: 'u', sender_type: 'user', body: 'ბარათით ვერ გადავიხადე', client_id: null, read_at: null, created_at: '2026-10-15T10:00:00Z' }], attachments: {}, hasMore: false })
    api.sendMessage.mockImplementation(async (a: any) => ({ message: { id: 'm2', conversation_id: 'conv-1', sender_id: 'admin-1', sender_type: 'admin', body: a.body, client_id: a.clientId, read_at: null, created_at: new Date().toISOString() }, attachments: [], deduplicated: false }))
    renderAt(<SupportAdminPage />)
    fireEvent.click(await screen.findByText('ნინო'))
    expect(await screen.findByText('ბარათით ვერ გადავიხადე')).toBeInTheDocument()
    expect(screen.queryByTestId('support-file-input')).toBeNull()

    const ta = screen.getByPlaceholderText('დაწერე პასუხი...')
    fireEvent.change(ta, { target: { value: 'გამარჯობა, ვაგვარებთ' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(api.sendMessage.mock.calls[0][0]).toMatchObject({ conversationId: 'conv-1', body: 'გამარჯობა, ვაგვარებთ', asAdmin: true })
    await waitFor(() => expect(screen.getAllByText('გამარჯობა, ვაგვარებთ').length).toBeGreaterThan(0))
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('conv-1', true))
  })

  it('changes the conversation status', async () => {
    api.adminSetStatus.mockResolvedValue(undefined)
    renderAt(<SupportAdminPage />)
    fireEvent.click(await screen.findByText('ნინო'))
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'resolved' } })
    await waitFor(() => expect(api.adminSetStatus).toHaveBeenCalledWith('conv-1', 'resolved'))
  })

  it('deep link from the notification e-mail (?c=) opens that conversation', async () => {
    renderAt(<SupportAdminPage />, '/support-admin?c=conv-2')
    expect(await screen.findByPlaceholderText('დაწერე პასუხი...')).toBeInTheDocument()
  })

  it('shows an error + retry when the list cannot be loaded', async () => {
    api.adminListConversations.mockRejectedValue(new Error('x'))
    renderAt(<SupportAdminPage />)
    expect(await screen.findByText(/საუბრების ჩატვირთვა ვერ მოხერხდა/)).toBeInTheDocument()
  })
})

describe('User chat page', () => {
  it('signed-out: explains login is required, no conversation is created', () => {
    renderAt(<SupportChatPage />)
    expect(screen.getByText('პირადი მხარდაჭერის ჩატისთვის საჭიროა შესვლა')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'შესვლა' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'support@cityroute.ge' })).toHaveAttribute('href', 'mailto:support@cityroute.ge')
    expect(api.getOrCreateConversation).not.toHaveBeenCalled()
  })

  it('signed-in: empty state, then sends a message', async () => {
    auth.value = { user: { id: 'u1' }, loading: false }
    api.getOrCreateConversation.mockResolvedValue({ id: 'conv-9', user_id: 'u1', status: 'open' })
    api.sendMessage.mockImplementation(async (a: any) => ({ message: { id: 's1', conversation_id: 'conv-9', sender_id: 'u1', sender_type: 'user', body: a.body, client_id: a.clientId, read_at: null, created_at: new Date().toISOString() }, attachments: [], deduplicated: false }))
    renderAt(<SupportChatPage />)
    expect(await screen.findByText('მხარდაჭერასთან ჯერ არაფერი დაგიწერია')).toBeInTheDocument()
    const ta = screen.getByPlaceholderText('დაწერე შეტყობინება...')
    fireEvent.change(ta, { target: { value: 'დახმარება მჭირდება' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(api.sendMessage.mock.calls[0][0]).toMatchObject({ conversationId: 'conv-9', asAdmin: false })
    expect(await screen.findByText('დახმარება მჭირდება')).toBeInTheDocument()
  })

  it('shows admin replies on the left, labelled as support', async () => {
    auth.value = { user: { id: 'u1' }, loading: false }
    api.getOrCreateConversation.mockResolvedValue({ id: 'conv-9', user_id: 'u1', status: 'waiting' })
    api.fetchMessages.mockResolvedValue({ messages: [
      { id: 'm1', conversation_id: 'conv-9', sender_id: 'u1', sender_type: 'user', body: 'კითხვა', client_id: null, read_at: '2026-10-15T10:05:00Z', created_at: '2026-10-15T10:00:00Z' },
      { id: 'm2', conversation_id: 'conv-9', sender_id: 'adm', sender_type: 'admin', body: 'პასუხი', client_id: null, read_at: null, created_at: '2026-10-15T10:04:00Z' },
    ], attachments: {}, hasMore: false })
    renderAt(<SupportChatPage />)
    const reply = await screen.findByText('პასუხი')
    expect(reply.closest('.sc-row')).toHaveClass('sc-row--theirs')
    expect(within(reply.closest('.sc-bubble') as HTMLElement).getByText('CityRoute მხარდაჭერა')).toBeInTheDocument()
    expect(screen.getByText('კითხვა').closest('.sc-row')).toHaveClass('sc-row--mine')
    expect(screen.getByText(/ნანახია/)).toBeInTheDocument()
  })

  it('shows a retry button when the conversation cannot be loaded', async () => {
    auth.value = { user: { id: 'u1' }, loading: false }
    api.getOrCreateConversation.mockRejectedValueOnce(new Error('x'))
    renderAt(<SupportChatPage />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    api.getOrCreateConversation.mockResolvedValue({ id: 'conv-9', user_id: 'u1', status: 'open' })
    fireEvent.click(screen.getByRole('button', { name: 'ხელახლა ცდა' }))
    expect(await screen.findByPlaceholderText('დაწერე შეტყობინება...')).toBeInTheDocument()
  })

  it('opens an attached image in the lightbox (private signed URL) and closes on Escape', async () => {
    auth.value = { user: { id: 'u1' }, loading: false }
    api.getOrCreateConversation.mockResolvedValue({ id: 'conv-9', user_id: 'u1', status: 'open' })
    api.fetchMessages.mockResolvedValue({
      messages: [{ id: 'm1', conversation_id: 'conv-9', sender_id: 'u1', sender_type: 'user', body: '', client_id: null, read_at: null, created_at: '2026-10-15T10:00:00Z' }],
      attachments: { m1: [{ id: 'a1', message_id: 'm1', conversation_id: 'conv-9', storage_path: 'conv-9/x.png', mime_type: 'image/png', size_bytes: 10, created_at: '2026-10-15T10:00:00Z' }] },
      hasMore: false,
    })
    api.signPaths.mockResolvedValue(new Map([['conv-9/x.png', 'https://signed.example/x.png?token=abc']]))
    renderAt(<SupportChatPage />)
    const open = await screen.findByRole('button', { name: 'სურათის გადიდება' })
    expect(open.querySelector('img')).toHaveAttribute('src', 'https://signed.example/x.png?token=abc')
    fireEvent.click(open)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
