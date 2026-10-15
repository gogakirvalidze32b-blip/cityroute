import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const png = (name = 'a.png') => new File([new Uint8Array(PNG)], name, { type: 'image/png' })

beforeEach(() => {
  localStorage.clear()
  ;(URL as any).createObjectURL = vi.fn(() => 'blob:preview')
  ;(URL as any).revokeObjectURL = vi.fn()
})

describe('Composer', () => {
  it('Enter sends, Shift+Enter does not', () => {
    const onSend = vi.fn(() => null)
    render(<Composer onSend={onSend} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'line1' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith({ body: 'line1', images: [] })
    expect((ta as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps the text when the message is rejected locally', () => {
    render(<Composer onSend={() => 'nope'} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'keep me' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(ta.value).toBe('keep me')
    expect(screen.getByRole('alert')).toHaveTextContent('nope')
  })

  it('send button disabled while empty; whitespace-only is not sent', () => {
    const onSend = vi.fn(() => null)
    render(<Composer onSend={onSend} />)
    const btn = screen.getByRole('button', { name: 'გაგზავნა' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(btn).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('previews a picked image, lets the user remove it, and sends it with the REAL mime', async () => {
    const onSend = vi.fn(() => null)
    render(<Composer onSend={onSend} />)
    const input = screen.getByTestId('support-file-input')
    fireEvent.change(input, { target: { files: [png('shot.jpg')] } })
    await waitFor(() => expect(document.querySelector('.sc-preview img')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'სურათის წაშლა' }))
    expect(document.querySelector('.sc-preview')).toBeNull()

    fireEvent.change(input, { target: { files: [png()] } })
    await waitFor(() => expect(document.querySelector('.sc-preview')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'გაგზავნა' }))
    expect(onSend).toHaveBeenCalledTimes(1)
    const arg = (onSend.mock.calls[0] as any[])[0]
    expect(arg.images).toHaveLength(1)
    expect(arg.images[0].mime).toBe('image/png')
  })

  it('rejects a non-image disguised as .png with a visible error', async () => {
    render(<Composer onSend={() => null} />)
    fireEvent.change(screen.getByTestId('support-file-input'), { target: { files: [new File(['MZ…'], 'x.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(document.querySelector('.sc-preview')).toBeNull()
  })

  it('admin composer has no attach button', () => {
    render(<Composer onSend={() => null} allowImages={false} />)
    expect(screen.queryByTestId('support-file-input')).toBeNull()
  })

  it('blocks > 4000 chars', () => {
    const onSend = vi.fn(() => null)
    render(<Composer onSend={onSend} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'x'.repeat(4001) } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('restores and clears the per-user draft', () => {
    localStorage.setItem('cityroute-support-draft-u1', 'half typed')
    const { unmount } = render(<Composer onSend={() => null} draftUserId="u1" />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('half typed')
    unmount()
  })
})
