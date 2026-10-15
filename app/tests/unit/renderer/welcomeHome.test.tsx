// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SetupWelcome } from '../../../src/renderer/src/components/setup/SetupWelcome'

afterEach(() => {
  cleanup()
  delete (window as { fvwks?: unknown }).fvwks
})

describe("Setup's artist field", () => {
  it('shows the sealed welcome once when the name opens it', async () => {
    const welcome = vi.fn(async (name: string) =>
      name.trim().toLowerCase() === 'test artist' ? { line: 'Welcome home.', mark: 'data:,', wordmark: 'data:,' } : null,
    )
    ;(window as { fvwks?: unknown }).fvwks = { isElectron: true, welcome }
    const onArtist = vi.fn()
    render(<SetupWelcome resume={false} health={null} engineNote={null} artist="" onArtist={onArtist} onStart={() => {}} />)
    const field = screen.getByLabelText('Your artist name')
    fireEvent.change(field, { target: { value: 'Someone' } })
    fireEvent.change(field, { target: { value: 'Test Artist' } })
    expect(await screen.findByText('Welcome home.', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(welcome).toHaveBeenCalledTimes(1) // debounced: only the settled name is checked
    expect(onArtist).toHaveBeenLastCalledWith('Test Artist')
  })
})
