import { create } from 'zustand'

/**
 * Per-viewer preferences (this machine's localStorage; works without storage too): the VOICE CORE panel can be
 * closed (× on the panel) and brought back in SETTINGS.
 */
const KEY = 'foxbox-view'

interface ViewPrefs {
  showVoiceCore: boolean
  setShowVoiceCore(on: boolean): void
}

function load(): boolean {
  try {
    return (JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>).showVoiceCore !== false
  } catch {
    return true
  }
}

export const useViewPrefs = create<ViewPrefs>((set) => ({
  showVoiceCore: load(),
  setShowVoiceCore(showVoiceCore) {
    set({ showVoiceCore })
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ showVoiceCore }))
    } catch {
      // Blocked storage: the choice holds for this session.
    }
  },
}))
