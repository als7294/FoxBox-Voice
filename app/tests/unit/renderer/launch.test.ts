import { describe, expect, it } from 'vitest'
import type { BootUpdateState, EngineStatus } from '@shared/bridge'
import { launchState, timeLeft } from '../../../src/renderer/src/state/launch'

const status = (over: Partial<EngineStatus>): EngineStatus => ({
  state: 'starting',
  url: '',
  pid: null,
  restarts: 0,
  attempt: 0,
  startedAt: null,
  readyAt: null,
  lastExit: null,
  lastError: null,
  detail: null,
  setup: null,
  health: null,
  nextRetryAt: null,
  logFile: null,
  ...over,
})
const health = (state: string, extra: object = {}) => ({ state, version: '1', voice_engine: 'kokoro', fx_engine: 'rack', disk_free_bytes: 1e10, data_dir: '', export_dir: '', ...extra })
const clear: BootUpdateState = { phase: 'clear', current: '1.0.0', version: null, sizeBytes: null, step: null, download: null, attempt: 0, error: null }

describe('the launch splash: real milestones only', () => {
  it('walks invite → engine → voices → GPU → ready, and only then is done', () => {
    expect(launchState(status({ state: 'idle' }), clear)).toMatchObject({ line: 'Checking your invite', done: false })
    expect(launchState(status({}), clear).line).toBe('Starting the sound engine')
    const loading = status({ pid: 7, health: health('loading_model', { message: 'Loading the voice model' }) as never })
    expect(launchState(loading, clear).line).toBe('Warming up the GPU') // the engine's load + warm-up step
    const up = status({ state: 'ready', pid: 7, health: health('starting') as never })
    expect(launchState(up, clear).line).toBe('Loading voices')
    const ready = status({ state: 'ready', pid: 7, health: health('ready') as never })
    expect(launchState(ready, clear)).toMatchObject({ line: 'Ready', pct: 100, done: true })
    // Ready, but the update check still holds the boot.
    expect(launchState(ready, { ...clear, phase: 'checking' })).toMatchObject({ line: 'Checking for updates', done: false })
  })

  it('shows MB and time left for downloads', () => {
    const dl = status({ pid: 7, health: health('loading_model', { message: 'Downloading Kokoro', progress: 0.4 }) as never })
    expect(launchState(dl, clear, false, { done: 132e6, total: 330e6, etaS: 75 })).toMatchObject({ line: 'Downloading voices', detail: expect.stringMatching(/ of .* · about 1 min left$/) })
    const update = { ...clear, phase: 'required' as const, version: '1.0.0-beta.3', step: 'downloading' as const, download: { bytes_done: 1e6, bytes_total: 4e6, rate_bps: 5e5, eta_s: 6 } }
    expect(launchState(status({ state: 'idle' }), update)).toMatchObject({ line: 'Updating to 1.0.0-beta.3', pct: 25, detail: expect.stringMatching(/about 5 s left$/) })
    expect(timeLeft(null)).toBe('')
  })

  it('names the step that failed, with Retry (or Continue for the update)', () => {
    const dead = status({ state: 'offline', lastError: 'The engine exited (code 1).' })
    expect(launchState(dead, clear).failure).toEqual({ step: 'Starting the sound engine', why: 'The engine exited (code 1).', action: 'retry' })
    expect(launchState(status({ pid: 7, health: health('starting') as never }), clear, true).failure?.why).toBe('Nothing has moved for a minute.')
    expect(launchState(status({ state: 'idle' }), { ...clear, phase: 'failed', error: 'No network.' }).failure).toEqual({ step: 'The update', why: 'No network.', action: 'continue' })
  })
})
