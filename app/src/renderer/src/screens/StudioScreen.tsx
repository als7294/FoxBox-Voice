import { usePresets, useRack, useVoices } from '@/api/queries'
import { SourceTabs } from '@/components/layout/SourceTabs'
import { ProgressOverlay } from '@/components/feedback/ProgressOverlay'
import { Cartridge } from '@/components/output/Cartridge'
import { RackDrawer, RackPanel } from '@/components/rack/RackPanel'
import { SignalView } from '@/components/signal/SignalView'
import { isStale, useStudio } from '@/state/studio'
import styles from './studio.module.css'

/**
 * STUDIO: SOURCE (type/record/import) | SIGNAL (its strip holds ARRANGE), with RACK and OUTPUT below; OPEN RACK
 * slides the full rack over.
 */
export function StudioScreen() {
  const voices = useVoices().data ?? []
  const presets = usePresets().data ?? []
  const rack = useRack().data
  const render = useStudio((s) => s.render)
  const exports = useStudio((s) => s.exports)
  const stale = useStudio(isStale)
  const rackOpen = useStudio((s) => s.rackOpen)
  const wet = exports.find((f) => f.variant === 'wet') ?? exports[0] ?? null
  return (
    <div className={styles.studio} data-rack-open={rackOpen || undefined}>
      <div className={styles.left}>
        <SourceTabs voices={voices} />
      </div>
      <SignalView />
      <div className={styles.bottom}>
        {rack ? (
          <RackPanel rack={rack} presets={presets} />
        ) : (
          <section className={styles.rackLoading} aria-label="Rack" data-reveal="4" aria-busy="true">
            <ProgressOverlay label="LOADING THE RACK" />
          </section>
        )}
        <Cartridge render={render} file={wet} stale={stale} />
      </div>
      {rackOpen && rack && <RackDrawer rack={rack} voices={voices} />}
    </div>
  )
}
