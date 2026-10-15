import type { Voice } from '@/api/types'
import { ImportDropzone } from '@/components/source/ImportDropzone'
import { TakesPanel } from '@/components/source/TakesPanel'
import { ScriptEditor } from '@/components/source/ScriptEditor'
import { VoicePicker } from '@/components/source/VoicePicker'
import { studio, useStudio, type SourceTab } from '@/state/studio'
import styles from './layout.module.css'

const TABS: { id: SourceTab; label: string }[] = [
  { id: 'type', label: 'TYPE' },
  { id: 'import', label: 'IMPORT' },
  { id: 'record', label: 'RECORD' },
]

/** SOURCE panel: TYPE | IMPORT | RECORD. */
export function SourceTabs({ voices }: { voices: readonly Voice[] }) {
  const tab = useStudio((s) => s.tab)
  return (
    <section className={styles.source} aria-label="Source" data-reveal="2">
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>SOURCE</span>
        <div className={styles.flex} />
        <div role="tablist" aria-label="Source" className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={styles.tab}
              onClick={() => studio.setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={styles.tabPanel}>
        {tab === 'type' && (
          <div className={styles.typeBody}>
            <ScriptEditor />
            <VoicePicker voices={voices} />
          </div>
        )}
        {tab === 'record' && <TakesPanel />}
        {tab === 'import' && <ImportDropzone />}
      </div>
    </section>
  )
}
