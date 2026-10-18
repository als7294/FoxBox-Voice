// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivateStep, formatTyped, ready } from '../../../src/renderer/src/components/setup/ActivateStep'

afterEach(() => {
  cleanup()
  delete (window as { fvwks?: unknown }).fvwks
})

function withBridge(activate: (code: string) => Promise<unknown>) {
  ;(window as { fvwks?: unknown }).fvwks = { isElectron: true, beta: { activate, state: async () => ({ state: 'needed' }) } }
}

describe("Setup's ACTIVATE step", () => {
  it('formats what looks like a code as FBV-XXXX-XXXX-XXXX and lets a key through as typed', () => {
    expect(formatTyped('fbv ab12cd34ef56')).toBe('FBV-AB12-CD34-EF56')
    expect(formatTyped('fbv ab')).toBe('FBV-AB')
    expect(formatTyped('ab12cd34ef56')).toBe('FBV-AB12-CD34-EF56') // 12 code characters: a pasted code
    expect(formatTyped('')).toBe('')
    expect(formatTyped('ab12')).toBe('ab12') // a key, as typed
    expect(formatTyped('Night Shift')).toBe('Night Shift')
    expect(formatTyped('FBV')).toBe('FBV') // can still be typed (and deleted) a letter at a time
    // A 13th character means it was never a code: back to plain letters, so a long key types through.
    expect(formatTyped('FBV-DRAG-STRA-PMANS')).toBe('DRAGSTRAPMANS')
    expect(formatTyped('x'.repeat(30))).toHaveLength(24)
    expect(ready('FBV-AB12-CD34-EF5')).toBe(false)
    expect(ready('FBV-AB12-CD34-EF56')).toBe(true)
    expect(ready('ab c')).toBe(false)
    expect(ready('abcd')).toBe(true)
  })

  it('sends a key as typed', async () => {
    const activate = vi.fn(async () => ({ ok: true, id: 'W-001', next: 'setup' }))
    withBridge(activate)
    render(<ActivateStep state={{ state: 'needed' }} onSetup={() => {}} />)
    const field = screen.getByLabelText('Invite code or key')
    expect(field).toHaveAttribute('placeholder', 'FBV-XXXX-XXXX-XXXX or your key')
    fireEvent.change(field, { target: { value: 'dummy word' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('Accepted · W-001')).toBeInTheDocument()
    expect(activate).toHaveBeenLastCalledWith('dummy word')
  })

  it('shows a refusal, then on a good code carries on into Setup', async () => {
    const activate = vi.fn(async (code: string) =>
      code === 'FBV-AB12-CD34-EF56' ? { ok: true, id: 'FBV-0003', next: 'setup' } : { ok: false, error: "That invite code isn't valid." },
    )
    withBridge(activate)
    const onSetup = vi.fn()
    render(<ActivateStep state={{ state: 'needed' }} onSetup={onSetup} />)
    const field = screen.getByLabelText('Invite code or key')
    fireEvent.change(field, { target: { value: 'FBV-0000-0000-0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText("That invite code isn't valid.")).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'ab12cd34ef56' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('Accepted · FBV-0003')).toBeInTheDocument()
    await waitFor(() => expect(onSetup).toHaveBeenCalled(), { timeout: 2000 })
    expect(activate).toHaveBeenLastCalledWith('FBV-AB12-CD34-EF56')
  })

  it('says when this Mac’s invite was withdrawn', () => {
    render(<ActivateStep state={{ state: 'revoked', id: 'FBV-0009' }} onSetup={() => {}} />)
    expect(screen.getByText(/FBV-0009\) was withdrawn/)).toBeInTheDocument()
  })
})
