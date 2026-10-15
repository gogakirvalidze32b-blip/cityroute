import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExamErrorGrid } from '@/components/ExamErrorGrid'
import { ExamScoreboard } from '@/components/ExamScoreboard'
import { ExamViewSwitcher } from '@/components/ExamViewSwitcher'
import { EXAM_ERROR_GRID } from '@/data/exam-errors'

describe('exam panel buttons', () => {
  it('switches between the map and the error panel', async () => {
    const onChange = vi.fn()
    render(<ExamViewSwitcher view="map" onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('tab', { name: 'პანელი' }))
    expect(onChange).toHaveBeenCalledWith('panel')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'რუკა' }))
    expect(onChange).toHaveBeenCalledWith('map')
  })

  it('records a severe error from the top bar and keeps the limit empty without data', async () => {
    const onRecordSevere = vi.fn()
    render(
      <ExamScoreboard
        elapsedMs={65_000}
        speedKmh={42}
        minorTotal={1}
        severeTotal={0}
        onRecordSevere={onRecordSevere}
      />,
    )
    expect(screen.getByText('01:05')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'სიჩქარის ლიმიტი უცნობია' }).textContent).toBe('—')
    expect(screen.queryByText('rpm')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: /მძიმე/ }))
    expect(onRecordSevere).toHaveBeenCalledTimes(1)
  })

  it('records a grid error and leaves the empty cell non-clickable', async () => {
    const onError = vi.fn()
    const scorable = EXAM_ERROR_GRID.find((item) => item.scorable)!
    render(<ExamErrorGrid counts={{}} onError={onError} />)
    await userEvent.setup().click(screen.getByRole('button', { name: new RegExp(scorable.label) }))
    expect(onError).toHaveBeenCalledWith(scorable.id)
    expect(screen.getAllByRole('button').length).toBe(EXAM_ERROR_GRID.filter((item) => item.scorable).length)
  })
})
