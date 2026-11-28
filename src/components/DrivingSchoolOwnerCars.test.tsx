import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DrivingSchoolOwnerCars } from './DrivingSchoolOwnerCars'

const future = new Date(Date.now() + 20 * 86_400_000).toISOString()
const license5 = { id: 'l1', car_count: 5, status: 'active', starts_at: '2026-11-28T00:00:00Z', expires_at: future }
const car = (slot: number, o: Record<string, unknown> = {}) => ({
  id: `car-${slot}`, slot_number: slot, label: '', status: 'active', android_device_id: null, device_bound_at: null, ...o,
})

const owner = vi.hoisted(() => ({
  licenses: vi.fn(async (_id: string) => [] as unknown[]),
  cars: vi.fn(async (_id: string) => [] as unknown[]),
  upsert: vi.fn(async (_slot: number, _label: string) => 'car-new'),
  setStatus: vi.fn(async (_id: string, _action: string) => {}),
}))

vi.mock('@/lib/driving-school', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/driving-school')>()),
  loadMySchoolLicenses: owner.licenses,
  loadMySchoolCars: owner.cars,
  ownerUpsertCar: owner.upsert,
  ownerSetCarStatus: owner.setStatus,
}))

async function renderCars() {
  render(<DrivingSchoolOwnerCars schoolId="school-1" />)
  await waitFor(() => expect(screen.queryByText('იტვირთება...')).toBeNull())
}

describe('Driving-school owner car management', () => {
  beforeEach(() => {
    for (const fn of Object.values(owner)) fn.mockReset()
    owner.licenses.mockResolvedValue([license5])
    owner.cars.mockResolvedValue([car(1, { label: 'AA-111-AA' }), car(3, { status: 'disabled' })])
    owner.upsert.mockResolvedValue('car-new')
    owner.setStatus.mockResolvedValue(undefined)
  })

  it('loads only this school and shows the license and active/limit counter', async () => {
    await renderCars()
    expect(owner.licenses).toHaveBeenCalledWith('school-1')
    expect(owner.cars).toHaveBeenCalledWith('school-1')
    expect(screen.getByText(/აქტიური: 1\/5/)).toBeTruthy()
    expect(screen.getByDisplayValue('AA-111-AA')).toBeTruthy()
    expect(owner.upsert).not.toHaveBeenCalled()
    expect(owner.setStatus).not.toHaveBeenCalled()
  })

  it('adds a car only into a free licensed slot', async () => {
    await renderCars()
    const select = screen.getByRole('combobox')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['#2', '#4', '#5'])
    const addForm = screen.getByRole('heading', { name: 'მანქანის დამატება' }).closest('form') as HTMLElement
    fireEvent.change(within(addForm).getByPlaceholderText('მაგ. AA-123-BB'), { target: { value: 'BB-222-BB' } })
    fireEvent.click(screen.getByRole('button', { name: 'მანქანის დამატება' }))
    await waitFor(() => expect(owner.upsert).toHaveBeenCalledWith(2, 'BB-222-BB'))
    expect(await screen.findByText('მანქანა დაემატა (#2).')).toBeTruthy()
  })

  it('hides the add form when the 5-car limit is reached', async () => {
    owner.cars.mockResolvedValue([1, 2, 3, 4, 5].map((slot) => car(slot)))
    await renderCars()
    expect(screen.getByText(/აქტიური: 5\/5/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'მანქანის დამატება' })).toBeNull()
    expect(screen.getByText(/ლიმიტი ამოწურულია \(5\)/)).toBeTruthy()
  })

  it('shows the database limit error if the server refuses a car', async () => {
    owner.upsert.mockRejectedValueOnce({ message: 'Driving-school license allows only 5 active cars' })
    await renderCars()
    fireEvent.click(screen.getByRole('button', { name: 'მანქანის დამატება' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ლიმიტი ამოწურულია')
  })

  it('disables and enables only after confirmation', async () => {
    await renderCars()
    fireEvent.click(screen.getByRole('button', { name: 'გამორთვა' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('გამოირთოს მანქანა #1?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'გაუქმება' }))
    expect(owner.setStatus).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'გამორთვა' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'დადასტურება' }))
    await waitFor(() => expect(owner.setStatus).toHaveBeenCalledWith('car-1', 'disable'))

    await waitFor(() => expect(screen.queryByText('სრულდება...')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'ჩართვა' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'დადასტურება' }))
    await waitFor(() => expect(owner.setStatus).toHaveBeenCalledWith('car-3', 'enable'))
  })

  it('offers device release only when a device is bound, with confirmation', async () => {
    owner.cars.mockResolvedValue([car(1), car(2, { android_device_id: 'android-device-abc', device_bound_at: '2026-11-28T00:00:00Z' })])
    await renderCars()
    const releaseButtons = screen.getAllByRole('button', { name: 'მოწყობილობის გათავისუფლება' })
    expect(releaseButtons[0]).toBeDisabled()
    expect(releaseButtons[1]).toBeEnabled()
    fireEvent.click(releaseButtons[1])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'დადასტურება' }))
    await waitFor(() => expect(owner.setStatus).toHaveBeenCalledWith('car-2', 'release_device'))
  })

  it('shows no add form and explains when there is no active license', async () => {
    owner.licenses.mockResolvedValue([{ ...license5, expires_at: new Date(Date.now() - 1000).toISOString() }])
    owner.cars.mockResolvedValue([])
    await renderCars()
    expect(screen.getByText(/აქტიური ლიცენზია არ არის/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'მანქანის დამატება' })).toBeNull()
  })
})
