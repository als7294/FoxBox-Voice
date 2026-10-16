import { create } from 'zustand'
import { reducedMotion } from '@/visuals/motion'

export type Screen = 'studio' | 'settings'

/** FoxBox Voice has two pages and no rail: STUDIO, and SETTINGS from the top bar or ⌘,. */
export const SCREENS: { id: Screen; label: string; code: string }[] = [
  { id: 'studio', label: 'STUDIO', code: '01' },
  { id: 'settings', label: 'SETTINGS', code: '02' },
]

export interface Wipe {
  t0: number
  to: Screen
  label: string
  code: string
  switched: boolean
}

export interface StepsModal {
  title: string
  body: string
  steps: string[]
  /** File to reveal from the modal (rekordbox.xml). */
  revealPath?: string | null
}

interface UiState {
  screen: Screen
  wipe: Wipe | null
  booting: boolean
  shortcutsOpen: boolean
  exportSheetOpen: boolean
  savePresetOpen: boolean
  modal: StepsModal | null
  /** Banner ids the user dismissed (until the condition changes). */
  dismissed: Record<string, boolean>
  /** Screen change with the design's wipe (instant when reduced motion is on). */
  navigate(screen: Screen): void
  setScreen(screen: Screen): void
  setBooting(booting: boolean): void
  setShortcutsOpen(open: boolean): void
  setExportSheetOpen(open: boolean): void
  setSavePresetOpen(open: boolean): void
  setModal(modal: StepsModal | null): void
  dismiss(id: string): void
  undismiss(id: string): void
}

export const useUi = create<UiState>((set, get) => ({
  screen: 'studio',
  wipe: null,
  // Behind the launch splash (?splash=1) the Studio shows only once the boot is done: no boot screen of its own.
  booting: typeof window !== 'undefined' && !reducedMotion() && !new URLSearchParams(window.location.search).has('splash'),
  shortcutsOpen: false,
  exportSheetOpen: false,
  savePresetOpen: false,
  modal: null,
  dismissed: {},
  navigate(screen) {
    const s = get()
    const meta = SCREENS.find((x) => x.id === screen)!
    if (screen === s.screen || s.wipe) return
    if (reducedMotion() || s.booting) set({ screen })
    else set({ wipe: { t0: performance.now(), to: screen, label: meta.label, code: meta.code, switched: false } })
  },
  setScreen: (screen) => set({ screen, wipe: null }),
  setBooting: (booting) => set({ booting }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setExportSheetOpen: (exportSheetOpen) => set({ exportSheetOpen }),
  setSavePresetOpen: (savePresetOpen) => set({ savePresetOpen }),
  setModal: (modal) => set({ modal }),
  dismiss: (id) => set((s) => ({ dismissed: { ...s.dismissed, [id]: true } })),
  undismiss: (id) =>
    set((s) => {
      if (!s.dismissed[id]) return s
      const next = { ...s.dismissed }
      delete next[id]
      return { dismissed: next }
    }),
}))
