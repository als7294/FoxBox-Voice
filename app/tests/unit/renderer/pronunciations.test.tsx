// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, passthrough } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { handlers } from '../../../src/renderer/src/mocks/handlers'
import { mockEngine } from '../../../src/renderer/src/mocks/mockEngine'
import { PronunciationsCard } from '../../../src/renderer/src/screens/SettingsScreen'

const server = setupServer(...handlers, http.all('*', () => passthrough()))
beforeAll(() => {
  mockEngine.latencyMs = 0
  server.listen({ onUnhandledRequest: 'bypass' })
})
afterEach(cleanup)
afterAll(() => server.close())

describe('SETTINGS → Pronunciations', () => {
  it('adds, edits and deletes a word, saved to the engine each time', async () => {
    mockEngine.lexicon = { entries: [] }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PronunciationsCard />
      </QueryClientProvider>,
    )
    await screen.findByText(/None yet/)
    fireEvent.change(screen.getByLabelText('Written'), { target: { value: 'FVWKS' } })
    fireEvent.change(screen.getByLabelText('Said as'), { target: { value: 'Fox' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mockEngine.lexicon.entries).toEqual([{ word: 'FVWKS', say: 'Fox', acronym: false }]))
    const list = screen.getByRole('list', { name: 'Pronunciations' })
    // Click a row to edit it: the same word updates in place.
    fireEvent.click(await within(list).findByRole('button', { name: 'Edit FVWKS: said Fox' }))
    fireEvent.change(screen.getByLabelText('Said as'), { target: { value: 'Fawkes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(mockEngine.lexicon.entries).toEqual([{ word: 'FVWKS', say: 'Fawkes', acronym: false }]))
    fireEvent.click(await within(list).findByRole('button', { name: 'Delete FVWKS' }))
    await waitFor(() => expect(mockEngine.lexicon.entries).toEqual([]))
  })
})
