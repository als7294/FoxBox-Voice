// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RenderInfo } from '@/api/types'
import { ArrangeView } from '../../../src/renderer/src/components/signal/ArrangeView'
import { currentRenderKey, useStudio } from '../../../src/renderer/src/state/studio'

vi.mock('@/state/renderController', () => ({ scheduleRender: vi.fn() }))

const BEAT = 60 / 140
afterEach(cleanup)

/** HOLD THE LINE | DOWN | *NOW* after NOW was moved onto bar 4 (beat index 12): what the engine now reports. */
function landedOnBar4() {
  const word = (text: string, beat: number, len = 0.3, th = false) => ({ text, start_s: beat * BEAT, end_s: beat * BEAT + len, throw: th })
  const words = [word('HOLD', 0), word('THE', 1), word('LINE', 2), word('DOWN', 4), word('NOW', 12, 0.4, true)]
  const r = {
    duration_s: 16 * BEAT,
    bpm: 140,
    bars: 4,
    segments: [{ index: 0, start_s: 0, end_s: 12 * BEAT + 0.4, flags: {}, words }],
    chop: words.map((w, index) => ({ index, beat: Math.round(w.start_s / BEAT) })),
    fit: { status: 'fits', speech_s: 6, available_s: 6.86, message: '' },
  } as unknown as RenderInfo
  useStudio.setState({ render: r, chop: 'custom', chopSlots: r.chop ?? [] })
  useStudio.setState((s) => ({ renderKey: currentRenderKey(s) }))
}

describe('ARRANGE: a moved echo word', () => {
  it('shows NOW where it landed, and ←/→ nudge from there, twice before the render lands too', () => {
    landedOnBar4()
    render(<ArrangeView />)
    const now = screen.getByRole('button', { name: 'NOW, beat 13' })
    fireEvent.keyDown(now, { key: 'ArrowRight' })
    expect(useStudio.getState().chopSlots.find((c) => c.index === 4)?.beat).toBe(13)
    // The render hasn't landed yet: the next press counts from the pending placement, not the old landing.
    fireEvent.keyDown(screen.getByRole('button', { name: /^NOW, beat/ }), { key: 'ArrowRight' })
    expect(useStudio.getState().chopSlots.find((c) => c.index === 4)?.beat).toBe(14)
    fireEvent.keyDown(screen.getByRole('button', { name: /^NOW, beat/ }), { key: 'ArrowLeft', shiftKey: true })
    expect(useStudio.getState().chopSlots.find((c) => c.index === 4)?.beat).toBe(10)
  })
})
