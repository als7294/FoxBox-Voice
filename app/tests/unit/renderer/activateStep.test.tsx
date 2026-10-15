// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivateStep, formatTyped } from '../../../src/renderer/src/components/setup/ActivateStep'

afterEach(() => {
  cleanup()
  delete (window as { fvwks?: unknown }).fvwks
})

function withBridge(activate: (code: string) => Promise<unknown>) {
  ;(window as { fvwks?: unknown }).fvwks = { isElectron: true, beta: { activate, state: async () => ({ state: 'needed' }) } }
}

describe("Setup's ACTIVATE step", () => {
  it('formats what is typed as FBV-XXXX-XXXX-XXXX', () => {
    expect(formatTyped('fbv ab12cd34ef56')).toBe('FBV-AB12-CD34-EF56')
    expect(formatTyped('ab12')).toBe('FBV-AB12')
    expect(formatTyped('')).toBe('')
  })

  it('shows a refusal, then on a good code carries on into Setup', async () => {
    const activate = vi.fn(async (code: string) =>
      code === 'FBV-AB12-CD34-EF56' ? { ok: true, id: 'FBV-0003', next: 'setup' } : { ok: false, error: "That invite code isn't valid." },
    )
    withBridge(activate)
    const onSetup = vi.fn()
    render(<ActivateStep state={{ state: 'needed' }} onSetup={onSetup} />)
    const field = screen.getByLabelText('Invite code')
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
