import type { BootUpdateState, EngineStatus } from '@shared/bridge'
import { formatBytes } from '@/lib/format'
import { bootStage } from './bootStage'

/**
 * What the launch splash says, from real milestones only (never a timer): the invite check (main checks this Mac's
 * activation before it starts the engine), the update check at boot, then the engine's own stages.
 */
export interface Launch {
  /** The status line. */
  line: string
  /** 0–100, on the same milestones. */
  pct: number
  /** Under the line while something downloads: "120 MB of 330 MB · about 1 min left". */
  detail: string | null
  /** The step that failed, in plain words, and what the splash offers (Retry, or Continue for an update). */
  failure: { step: string; why: string; action: 'retry' | 'continue' } | null
  /** Engine ready and nothing holds the boot: main shows the Studio. */
  done: boolean
}

/** A download's progress for the detail line (models: their total from /api/models, when known). */
export interface Download {
  done: number | null
  total: number | null
  etaS: number | null
}

export function timeLeft(s: number | null): string {
  if (s == null || !Number.isFinite(s) || s < 0) return ''
  if (s < 50) return `about ${Math.max(5, Math.round(s / 5) * 5)} s left`
  return `about ${Math.round(s / 60) || 1} min left`
}

export function downloadText(d: Download): string | null {
  const parts = [d.done != null && d.total ? `${formatBytes(d.done)} of ${formatBytes(d.total)}` : null, timeLeft(d.etaS) || null]
  return parts.filter(Boolean).join(' · ') || null
}

/** `stalled`: no progress for a minute. `model`: the voice model download's bytes and time left, when there is one. */
export function launchState(status: EngineStatus, update: BootUpdateState, stalled = false, model: Download | null = null): Launch {
  if (update.phase === 'failed') {
    return {
      line: 'Checking for updates',
      pct: 100,
      detail: null,
      failure: { step: 'The update', why: update.error ?? "It couldn't finish.", action: 'continue' },
      done: false,
    }
  }
  if (update.phase === 'required') {
    const d = update.download
    const frac = update.step === 'downloading' ? (d && d.bytes_total > 0 ? d.bytes_done / d.bytes_total : 0) : 1
    const line =
      update.step === 'installing' ? 'Installing the update' : update.step === 'verifying' ? 'Checking the update' : `Updating to ${update.version ?? 'the new version'}`
    return {
      line,
      pct: Math.round(100 * Math.min(1, Math.max(0, frac))),
      detail:
        update.step === 'installing'
          ? 'FoxBox Voice restarts by itself'
          : d
            ? downloadText({ done: d.bytes_done, total: d.bytes_total, etaS: d.eta_s })
            : update.sizeBytes
              ? formatBytes(update.sizeBytes)
              : null,
      failure: null,
      done: false,
    }
  }
  if (status.state === 'idle') return { line: 'Checking your invite', pct: 3, detail: null, failure: null, done: false }

  const stage = bootStage(status)
  const words: Record<string, string> = {
    setup: 'Updating the sound engine',
    spawn: 'Starting the sound engine',
    engine: 'Loading voices',
    model: 'Loading voices',
    warming: 'Warming up the GPU',
    ready: 'Ready',
  }
  if (stage.id === 'error' || stalled) {
    const step = stage.id === 'error' ? (status.pid ? 'Loading voices' : 'Starting the sound engine') : words[stage.id]!
    return {
      line: step,
      pct: stage.pct,
      detail: null,
      failure: { step, why: stalled ? 'Nothing has moved for a minute.' : stage.detail, action: 'retry' },
      done: false,
    }
  }
  const downloading = stage.id === 'model' && /download/i.test(stage.detail)
  if (stage.id === 'ready' && update.phase === 'checking') {
    return { line: 'Checking for updates', pct: 99, detail: null, failure: null, done: false }
  }
  return {
    line: downloading ? 'Downloading voices' : words[stage.id]!,
    pct: Math.max(3, stage.pct),
    detail: downloading ? (model ? downloadText(model) : null) : null,
    failure: null,
    done: stage.id === 'ready' && update.phase === 'clear',
  }
}
