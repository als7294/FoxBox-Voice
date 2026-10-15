/** The ARCTIC palette for canvas drawing: read from styles/tokens.css's custom properties, so CSS stays the source. */
export interface VbTheme {
  name: 'arctic'
  bg: string
  panel: string
  ink: string
  dim: string
  accent: string
  amber: string
  ice: string
  mono: string
  display: string
  displayWeight: number
}

/** Used when the stylesheet isn't there (tests, a canvas drawn before the CSS loads). Keep in step with tokens.css. */
const FALLBACK: VbTheme = {
  name: 'arctic',
  bg: '#070b14',
  panel: '#0c1322',
  ink: '#eef5fc',
  dim: '#9aabc2',
  accent: '#5ce6cf',
  amber: '#f3d37c',
  ice: '#8ccfff',
  mono: '"JetBrains Mono", monospace',
  display: '"Big Shoulders Display", sans-serif',
  displayWeight: 800,
}

let cached: VbTheme | null = null

export function theme(): VbTheme {
  if (cached) return cached
  if (typeof document === 'undefined') return FALLBACK
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(`--vb-${name}`).trim() || fallback
  const read: VbTheme = {
    ...FALLBACK,
    bg: v('bg', FALLBACK.bg),
    panel: v('panel', FALLBACK.panel),
    ink: v('ink', FALLBACK.ink),
    dim: v('dim', FALLBACK.dim),
    accent: v('accent', FALLBACK.accent),
    amber: v('amber', FALLBACK.amber),
    ice: v('ice', FALLBACK.ice),
  }
  // Cache only once the stylesheet is in (its tokens are there): before that, every call reads again.
  if (css.getPropertyValue('--vb-bg').trim()) cached = read
  return read
}
