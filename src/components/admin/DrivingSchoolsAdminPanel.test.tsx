import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DrivingSchoolsAdminPanel } from './DrivingSchoolsAdminPanel'

const pending = {
  id: 'school-1',
  owner_id: '11111111-1111-1111-1111-111111111111',
  name: 'სატესტო ავტოსკოლა',
  contact_name: 'გოგა',
  contact_phone: '555111111',
  contact_email: 'school@example.com',
  address: 'რუსთაველის ქ.',
  city: 'თელავი',
  registration_code: null,
  verification_info: 'ლიცენზია №1',
  status: 'pending' as const,
  review_note: null,
  reviewed_by: null,
  reviewed_at: null,
  submitted_at: '2026-11-28T10:00:00Z',
  created_at: '2026-11-28T10:00:00Z',
}
const approved = { ...pending, id: 'school-2', name: 'დადასტურებული სკოლა', status: 'approved' as const, reviewed_at: '2026-11-28T11:00:00Z' }

const admin = vi.hoisted(() => ({
  list: vi.fn(async (_filter: string) => [] as unknown[]),
  licenses: vi.fn(async (_id: string) => [] as unknown[]),
  cars: vi.fn(async (_id: string) => [] as unknown[]),
  review: vi.fn(async (_id: string, _decision: string, _note: string) => {}),
  grant: vi.fn(async (_school: unknown, _cars: number, _days: number) => 'license-1'),
}))

vi.mock('@/lib/driving-school-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/driving-school-admin')>()),
  adminListDrivingSchools: admin.list,
  adminGetSchoolLicenses: admin.licenses,
  adminGetSchoolCars: admin.cars,
  adminReviewDrivingSchool: admin.review,
  adminGrantDrivingSchoolLicense: admin.grant,
}))

async function renderPanel() {
  render(<DrivingSchoolsAdminPanel />)
  // Wait for the initial (Pending) list so later clicks never race the first load.
  await waitFor(() => expect(admin.list).toHaveBeenCalledWith('pending'))
  await waitFor(() => expect(screen.queryByText('იტვირთება...')).toBeNull())
}

async function openApproved() {
  await renderPanel()
  fireEvent.click(screen.getByRole('tab', { name: 'დადასტურებული' }))
  fireEvent.click(await screen.findByText('დადასტურებული სკოლა'))
  await waitFor(() => expect(admin.licenses).toHaveBeenCalledWith('school-2'))
}

describe('Driving Schools admin panel (/support-admin?tab=schools)', () => {
  beforeEach(() => {
    for (const fn of Object.values(admin)) fn.mockReset()
    admin.list.mockImplementation(async (filter: string) =>
      filter === 'pending' ? [pending] : filter === 'approved' ? [approved] : filter === 'all' ? [pending, approved] : [],
    )
    admin.licenses.mockResolvedValue([])
    admin.cars.mockResolvedValue([])
    admin.review.mockResolvedValue(undefined)
    admin.grant.mockResolvedValue('license-1')
  })

  it('loads Pending by default, filters by status, and performs no write on load', async () => {
    await renderPanel()
    expect(screen.getByText('სატესტო ავტოსკოლა')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'დადასტურებული' }))
    expect(await screen.findByText('დადასტურებული სკოლა')).toBeTruthy()
    expect(admin.list).toHaveBeenLastCalledWith('approved')

    fireEvent.click(screen.getByRole('tab', { name: 'უარყოფილი' }))
    expect(await screen.findByText('განაცხადები არ არის.')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'ყველა' }))
    await waitFor(() => expect(admin.list).toHaveBeenLastCalledWith('all'))
    expect(admin.review).not.toHaveBeenCalled()
    expect(admin.grant).not.toHaveBeenCalled()
  })

  it('shows a list error state', async () => {
    admin.list.mockRejectedValue({ message: 'boom' })
    render(<DrivingSchoolsAdminPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('მოქმედება ვერ შესრულდა')
  })

  it('opens full details and approves only after explicit confirmation', async () => {
    await renderPanel()
    fireEvent.click(screen.getByText('სატესტო ავტოსკოლა'))
    expect(screen.getByText('ლიცენზია №1')).toBeTruthy()
    expect(screen.getByText(pending.owner_id)).toBeTruthy()
    expect(await screen.findByText('ლიცენზია არ არის.')).toBeTruthy()
    expect(admin.cars).toHaveBeenCalledWith('school-1')
    expect(screen.queryByRole('button', { name: 'ლიცენზიის მინიჭება' })).toBeNull()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ყველაფერი რიგზეა' } })
    fireEvent.click(screen.getByRole('button', { name: 'დადასტურება (Approve)' }))
    const dialog = screen.getByRole('dialog')
    expect(admin.review).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'გაუქმება' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(admin.review).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'დადასტურება (Approve)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'დადასტურება' }))
    await waitFor(() => expect(admin.review).toHaveBeenCalledWith('school-1', 'approved', 'ყველაფერი რიგზეა'))
    expect(await screen.findByText('ავტოსკოლა დადასტურდა.')).toBeTruthy()
  })

  it('requires a reason before a Reject confirmation and passes it to the RPC', async () => {
    await renderPanel()
    fireEvent.click(screen.getByText('სატესტო ავტოსკოლა'))
    fireEvent.click(screen.getByRole('button', { name: 'უარყოფა (Reject)' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('მიუთითე მიზეზი')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'დოკუმენტები არ არის' } })
    fireEvent.click(screen.getByRole('button', { name: 'უარყოფა (Reject)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'დადასტურება' }))
    await waitFor(() => expect(admin.review).toHaveBeenCalledWith('school-1', 'rejected', 'დოკუმენტები არ არის'))
  })

  it('shows the server error when the review RPC refuses', async () => {
    admin.review.mockRejectedValueOnce({ message: 'Only support admins can review driving schools' })
    await renderPanel()
    fireEvent.click(screen.getByText('სატესტო ავტოსკოლა'))
    fireEvent.click(screen.getByRole('button', { name: 'დადასტურება (Approve)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'დადასტურება' }))
    expect(await screen.findByText(/მხოლოდ ადმინისტრატორისთვის/)).toBeTruthy()
  })

  it('offers license grant only for Approved schools, 5 or 10 cars, 30 days by default, after a warning', async () => {
    await openApproved()
    expect(screen.queryByRole('button', { name: 'დადასტურება (Approve)' })).toBeNull()

    const radios = within(screen.getByRole('radiogroup', { name: 'მანქანების რაოდენობა' })).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(screen.getByLabelText('5 მანქანა')).toBeChecked()
    expect(screen.getByRole('spinbutton')).toHaveValue(30)

    fireEvent.click(screen.getByLabelText('10 მანქანა'))
    fireEvent.click(screen.getByRole('button', { name: 'ლიცენზიის მინიჭება' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('10-მანქანიან')
    expect(dialog).toHaveTextContent('30 დღით')
    expect(dialog).toHaveTextContent('გადახდის გარეშე')
    expect(admin.grant).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'დადასტურება' }))
    await waitFor(() => expect(admin.grant).toHaveBeenCalledWith(expect.objectContaining({ id: 'school-2', status: 'approved' }), 10, 30))
    expect(await screen.findByText('10-მანქანიანი ლიცენზია მიენიჭა 30 დღით.')).toBeTruthy()
  })

  it('warns that a downgrade replaces the current license and disables extra cars', async () => {
    admin.licenses.mockResolvedValue([
      { id: 'l1', school_id: 'school-2', car_count: 10, status: 'active', source: 'admin', price_amount: null,
        starts_at: '2026-11-01T00:00:00Z', expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), granted_by: null, created_at: '' },
    ])
    await openApproved()
    expect(await screen.findByText(/მიმდინარე აქტიური ლიცენზია: 10 მანქანა/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ლიცენზიის მინიჭება' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('მიმდინარე 10-მანქანიანი ლიცენზია ჩანაცვლდება')
    expect(screen.getByRole('dialog')).toHaveTextContent('გაითიშება')
  })

  it('rejects an invalid duration before any confirmation', async () => {
    await openApproved()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'ლიცენზიის მინიჭება' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('1-დან 366')
    expect(admin.grant).not.toHaveBeenCalled()
  })
})
