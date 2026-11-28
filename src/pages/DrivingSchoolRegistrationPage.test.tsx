// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DrivingSchoolRegistrationPage } from './DrivingSchoolRegistrationPage'

const school = vi.hoisted(() => ({
  load: vi.fn(async () => null as null | Record<string, unknown>),
  submit: vi.fn(async () => 'school-1'),
}))

vi.mock('@/lib/driving-school', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/driving-school')>()),
  loadMyDrivingSchool: school.load,
  submitDrivingSchoolApplication: school.submit,
  loadMySchoolLicenses: vi.fn(async () => []),
  loadMySchoolCars: vi.fn(async () => []),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1' } }),
}))

vi.mock('@/components/AppBrand', () => ({ AppBrand: () => null }))

const approved = {
  id: 'school-1',
  name: 'ავტოსკოლა თელავი',
  contact_name: 'გიორგი',
  contact_phone: '+995555123456',
  contact_email: 'school@example.com',
  address: 'ერეკლე II-ის გამზ. 1',
  city: 'თელავი',
  registration_code: null,
  verification_info: '',
  status: 'approved',
  review_note: null,
  submitted_at: '2026-11-28T00:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DrivingSchoolRegistrationPage />
    </MemoryRouter>,
  )
}

describe('Driving-school registration', () => {
  beforeEach(() => {
    school.load.mockReset()
    school.load.mockResolvedValue(null)
    school.submit.mockClear()
  })

  it('validates before submitting and sends a Pending application', async () => {
    renderPage()
    const submit = await screen.findByRole('button', { name: 'განაცხადის გაგზავნა' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    expect(await screen.findByText('მიუთითე ავტოსკოლის სახელი')).toBeTruthy()
    expect(school.submit).not.toHaveBeenCalled()

    const inputs = screen.getAllByRole('textbox')
    const values = ['ავტოსკოლა თელავი', 'გიორგი', '+995555123456', 'school@example.com', 'ერეკლე II-ის გამზ. 1']
    values.forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }))
    school.load.mockResolvedValue({ ...approved, status: 'pending' })
    fireEvent.click(submit)

    await waitFor(() => expect(school.submit).toHaveBeenCalledOnce())
    expect(await screen.findByText('განაცხადი გაიგზავნა. სტატუსი: განხილვაშია.')).toBeTruthy()
    expect(screen.getByText('სტატუსი: განხილვაშია')).toBeTruthy()
  })

  it('locks the details of an Approved school', async () => {
    school.load.mockResolvedValue(approved)
    renderPage()
    expect(await screen.findByText('სტატუსი: დადასტურებულია')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /განაცხადის/ })).toBeNull()
    const form = document.querySelector('.driving-school-form') as HTMLElement
    for (const input of within(form).getAllByRole('textbox')) expect(input).toBeDisabled()
    expect(await screen.findByRole('heading', { name: 'ჩემი ავტოსკოლის მანქანები' })).toBeTruthy()
  })

  it('does not show car management to a Pending school', async () => {
    school.load.mockResolvedValue({ ...approved, status: 'pending' })
    renderPage()
    expect(await screen.findByText('სტატუსი: განხილვაშია')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'ჩემი ავტოსკოლის მანქანები' })).toBeNull()
  })
})
