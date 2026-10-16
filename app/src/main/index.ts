import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type NativeImage,
} from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUDIO_SCHEME,
  IPC,
  type BootInfo,
  type BootUpdateState,
  type EngineResponse,
  type EngineStatus,
  type MicAccess,
  type SetupCompleteResult,
  type SetupInfo,
  type UpdateState,
} from '../shared/bridge'
import {
  bundledEngineDir,
  bundledModelsDir,
  clearEngineQuarantine,
  isTranslocated,
  MOVE_TO_APPLICATIONS,
  resolveEngineLaunch,
  type QuarantineResult,
} from './engine/command'
import { LogFile } from './engine/logfile'
import { EngineSupervisor } from './engine/supervisor'
import { BetaAccess, hardwareUuid, type CodeBook } from './beta'
import codeBook from './beta-codes.json'
import { openWelcome, type Sealed } from './welcome'
import sealedWelcome from './welcome.json'
import { bootSkipReason, BootUpdateGate } from './bootUpdate'
import { errorResponse, parseEngineRequest, pickHeaders } from './engineProxy'
import { ExportGuard } from './exportGuard'
import { buildMenu } from './menu'
import { cartridgePng } from './png'
import { hasSetupMarker, requiredMissing, shouldShowSetup, writeSetupMarker } from './setup'
import { Updater } from './updater'

// Dev only: a packaged app launched with FVWKS_MOCK must never silently talk to mocks and play fake audio.
const MOCK = process.env.FVWKS_MOCK === '1' && !app.isPackaged
// Tests only (never in packaged builds): report the mic as granted without asking macOS. The e2e test feeds
// getUserMedia a synthetic tone, so the OS microphone permission is never involved.
const FAKE_MIC = process.env.FVWKS_FAKE_MIC === '1' && !app.isPackaged
// electron-vite's dev server. Never in packaged builds: an environment variable must not be able to point the
// window (and its preload bridge) at another page.
const RENDERER_URL = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || null
const RENDERER_DIR = resolve(__dirname, '../renderer')
/** The product name in titles, dialogs and folders (package.json's productName; Electron's userData folder uses it too). */
const PRODUCT = 'FoxBox Voice'

// ---------------------------------------------------------------------------------------------
// Folders. Packaged: ~/Library/Application Support/FoxBox Voice (engine data) and
// ~/Music/FoxBox Voice (exports): never FoxBox's, so the two apps install side by side. Development: <repo>/.devdata/, so worktrees never share a
// database or an export folder. FVWKS_DATA_DIR / FVWKS_EXPORT_DIR / FVWKS_USER_DATA_DIR override in development
// (the e2e harness); packaged builds ignore them, so `launchctl setenv` can't redirect the library or export root.
const devEnv = (name: string): string | undefined => (app.isPackaged ? undefined : process.env[name] || undefined)

function linkedEngineDir(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
      fvwks?: { linkedEngineDir?: unknown }
    }
    const dir = pkg.fvwks?.linkedEngineDir
    return typeof dir === 'string' && dir ? dir : null
  } catch {
    return null
  }
}

const ENGINE_DIR = resolve(
  (!app.isPackaged && process.env.FVWKS_ENGINE_DIR) ||
    linkedEngineDir() ||
    join(app.getAppPath(), app.isPackaged ? '../../../engine' : '../engine'),
)
const DEV_DATA = join(ENGINE_DIR, '..', '.devdata')
// Builds for fresh Macs carry the engine inside the app (Contents/Resources/engine, from bundle_engine.sh). Only a
// packaged app looks for it; linked and development builds run ENGINE_DIR as before.
const BUNDLED_ENGINE = app.isPackaged ? bundledEngineDir(process.resourcesPath) : null
// Opened straight from Downloads or the disk image: macOS runs a read-only copy. Setup asks to move the app first.
const TRANSLOCATED = app.isPackaged && isTranslocated(process.execPath)
// The bundled engine's quarantine is cleared once per launch. Setup asks for the same answer: a copy that is
// read-only and still quarantined can't start the engine, so it says to move the app, as for a translocated one.
let quarantineCheck: Promise<QuarantineResult> | null = null
function engineQuarantine(): Promise<QuarantineResult> {
  quarantineCheck ??= BUNDLED_ENGINE
    ? clearEngineQuarantine(BUNDLED_ENGINE, { within: process.resourcesPath, log: (line) => log(`engine: ${line}`) })
    : Promise.resolve('skipped')
  return quarantineCheck
}

const USER_DATA_OVERRIDE = devEnv('FVWKS_USER_DATA_DIR')
if (USER_DATA_OVERRIDE) app.setPath('userData', resolve(USER_DATA_OVERRIDE))
else if (!app.isPackaged) app.setPath('userData', join(DEV_DATA, 'electron'))
const USER_DATA = app.getPath('userData')
// Chromium's caches get their own folder so they don't mix with the engine's library.
app.setPath('sessionData', join(USER_DATA, 'Chromium'))
const DATA_DIR = resolve(devEnv('FVWKS_DATA_DIR') || (app.isPackaged ? USER_DATA : join(DEV_DATA, 'data')))
const EXPORT_DIR = resolve(devEnv('FVWKS_EXPORT_DIR') || (app.isPackaged ? join(homedir(), 'Music', PRODUCT) : join(DEV_DATA, 'exports')))
const LOG_DIR = join(USER_DATA, 'logs')

const mainLog = new LogFile(join(LOG_DIR, 'main.log'))
const log = (text: string) => {
  mainLog.line(text)
  if (!app.isPackaged) console.log(`[main] ${text}`)
}

// Registered before `ready`: vbx://audio/<id> streams engine audio with the token added by main.
protocol.registerSchemesAsPrivileged([
  { scheme: AUDIO_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

const exportGuard = new ExportGuard(join(USER_DATA, 'export-roots.json'))
const token = randomBytes(32).toString('base64url')
let supervisor: EngineSupervisor | null = null
let offlineReason: string | null = null
let mainWindow: BrowserWindow | null = null
/** The first-run Setup window (900×620), open instead of the main window until setup completes. */
let setupWindow: BrowserWindow | null = null
let betaAccess: BetaAccess | null = null
/** Packaged builds always ask for an invite; development runs only with FVWKS_BETA_GATE=1 (the e2e harness skips it). */
const BETA_GATE = app.isPackaged || devEnv('FVWKS_BETA_GATE') === '1'
let updater: Updater | null = null
/** The update check at boot (UPDATE REQUIRED on the boot screen); made right after the rollback check. */
let bootGate: BootUpdateGate | null = null
// The launch splash: the Studio window loads hidden behind it and shows when the splash says the boot is done.
let splashWindow: BrowserWindow | null = null
let studioWanted = false
let studioReady = false
let bootT0 = 0
let warmLogged = false
/** FVWKS_NO_SPLASH=1 (development): the old in-window boot screen, e.g. to compare start-up times. */
const SPLASH = devEnv('FVWKS_NO_SPLASH') !== '1'
/**
 * FVWKS_CAPTURE_OFFSCREEN=1 (captures and smokes): nothing reaches the user's screen. The splash opens off-screen, the
 * other windows open fully transparent, ignore the mouse and never take focus. Development builds, and a packaged
 * isolated test copy (a `.test` bundle id, which only the staging scripts give); never the user's own install.
 */
const OFFSCREEN =
  process.env.FVWKS_CAPTURE_OFFSCREEN === '1' && (!app.isPackaged || /\.test(\.|$)/.test(process.env.__CFBundleIdentifier ?? ''))

/** Show a window, or (capture runs) keep it out of sight while it still renders. */
function reveal(win: BrowserWindow): void {
  if (!OFFSCREEN) return win.show()
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  win.showInactive()
}
let quitting = false
let cachedIcon: NativeImage | null = null
let lastState: EngineStatus['state'] | null = null
const inflight = new Map<string, AbortController>()

function idleStatus(state: EngineStatus['state'], lastError: string | null = null): EngineStatus {
  return {
    state,
    url: '',
    pid: null,
    restarts: 0,
    attempt: 0,
    startedAt: null,
    readyAt: null,
    lastExit: null,
    lastError,
    detail: null,
    setup: null,
    health: null,
    nextRetryAt: null,
    logFile: join(LOG_DIR, 'engine.log'),
  }
}

function engineStatus(): EngineStatus {
  if (MOCK) return idleStatus('mock')
  return supervisor?.getStatus() ?? idleStatus(offlineReason ? 'offline' : 'idle', offlineReason)
}

// ---------------------------------------------------------------------------------------------
// Trust: IPC is only accepted from our own renderer document.

function isTrustedUrl(url: string | undefined | null): boolean {
  if (!url) return false
  if (RENDERER_URL) {
    const origin = new URL(RENDERER_URL).origin
    return url === origin || url.startsWith(`${origin}/`)
  }
  if (!url.startsWith('file://')) return false
  try {
    // Containment, not a string prefix (".../out/renderer-x/index.html" must not pass).
    const rel = relative(RENDERER_DIR, fileURLToPath(url))
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  } catch {
    return false
  }
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const ok = isTrustedUrl(event.senderFrame?.url)
  if (!ok) log(`refused IPC from ${event.senderFrame?.url ?? 'unknown frame'}`)
  return ok
}

/**
 * The optional GitHub token for a private releases repo, encrypted with safeStorage (a Keychain-held key) in
 * userData. Never logged, never sent to the renderer; the updater sends it to api.github.com only.
 */
function githubTokenStore(file: string): { load(): string | null; save(token: string | null): void } {
  return {
    load() {
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(readFileSync(file)) || null
    },
    save(token) {
      if (token === null) {
        rmSync(file, { force: true })
        return
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error("The macOS Keychain isn't available, so the token can't be stored safely.")
      writeFileSync(file, safeStorage.encryptString(token), { mode: 0o600 })
    },
  }
}

function dragIcon(): NativeImage {
  if (!cachedIcon || cachedIcon.isEmpty()) cachedIcon = nativeImage.createFromBuffer(cartridgePng(64), { scaleFactor: 2 })
  return cachedIcon
}

// ---------------------------------------------------------------------------------------------
// Window

function sendToRenderer(channel: string, payload: unknown): void {
  const wc = mainWindow?.webContents
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

/** Engine status and update state go to every app window (the Setup window watches the engine too). */
function broadcast(channel: string, payload: unknown): void {
  for (const win of [mainWindow, setupWindow, splashWindow]) {
    const wc = win?.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }
}

/** The Studio window. `behindSplash`: it loads hidden (`?splash=1`: no boot screen of its own) and shows when the
 *  splash says the boot is done, so it adds nothing to the start-up. */
function createWindow(behindSplash = false): void {
  const win = new BrowserWindow({
    width: 1512,
    height: 982,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    title: `${PRODUCT} (beta)`,
    backgroundColor: '#04070e', // the boot screen's night (--vb-night), so launch doesn't flash
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 22 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  mainWindow = win
  win.once('ready-to-show', () => {
    if (!behindSplash) return reveal(win)
    studioReady = true
    showStudioWhenDue()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  if (RENDERER_URL) {
    const url = new URL(RENDERER_URL)
    if (behindSplash) url.searchParams.set('splash', '1')
    void win.loadURL(url.toString())
  } else void win.loadFile(join(RENDERER_DIR, 'index.html'), behindSplash ? { query: { splash: '1' } } : undefined)
}

/**
 * The launch splash (`?window=splash`): 720×450, frameless, centred on the display under the cursor, up within a few
 * hundred ms. It shows the real start-up (the invite check, the update check, the engine's stages) and calls
 * splash.done() when the Studio may open.
 */
function createSplashWindow(): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const [width, height] = [720, 450]
  const win = new BrowserWindow({
    width,
    height,
    x: OFFSCREEN ? -20000 : Math.round(workArea.x + (workArea.width - width) / 2),
    y: OFFSCREEN ? -20000 : Math.round(workArea.y + (workArea.height - height) / 2),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: PRODUCT,
    backgroundColor: '#04070e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  splashWindow = win
  win.once('ready-to-show', () => {
    if (OFFSCREEN) win.showInactive()
    else win.show()
    log(`boot: splash up +${Date.now() - bootT0} ms`)
  })
  win.on('closed', () => {
    if (splashWindow !== win) return
    splashWindow = null
    // Closed before the Studio was due (⌘W): open it rather than leave nothing on screen.
    studioWanted = true
    showStudioWhenDue()
  })
  if (RENDERER_URL) {
    const url = new URL(RENDERER_URL)
    url.searchParams.set('window', 'splash')
    void win.loadURL(url.toString())
  } else void win.loadFile(join(RENDERER_DIR, 'index.html'), { query: { window: 'splash' } })
}

/** The Studio shows once the splash says the boot is done and the window has painted; then the splash goes. */
function showStudioWhenDue(): void {
  const win = mainWindow
  if (!studioWanted || !studioReady || !win || win.isDestroyed()) return
  if (!win.isVisible()) {
    reveal(win)
    log(`boot: studio shown +${Date.now() - bootT0} ms`)
  }
  closeSplash()
}

/** The splash fades itself (on done) or simply goes (Setup takes over): closed a moment later. */
function closeSplash(): void {
  const win = splashWindow
  if (!win) return
  splashWindow = null
  setTimeout(() => {
    if (!win.isDestroyed()) win.close()
  }, 260)
}

/** The Setup window (900×620) on the same renderer bundle and preload, `index.html?window=setup`. */
function createPanelWindow(title: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title,
    backgroundColor: '#070b14', // --vb-bg
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => reveal(win))
  if (RENDERER_URL) {
    const url = new URL(RENDERER_URL)
    url.searchParams.set('window', 'setup')
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(RENDERER_DIR, 'index.html'), { query: { window: 'setup' } })
  }
  return win
}

/**
 * First-run Setup (`?window=setup`). It watches the engine (which starts as usual and installs the required models),
 * offers the optional ones, and hands over to the main window through IPC.setupComplete. Closing it before that quits
 * the app; setup resumes on the next launch.
 */
function createSetupWindow(): void {
  const win = createPanelWindow(`${PRODUCT} Setup`)
  setupWindow = win
  win.on('closed', () => {
    if (setupWindow === win) setupWindow = null
  })
}

/** About: the beta, the invite this Mac was unlocked with, the honest limit of offline codes, the credit. */
function setAbout(inviteId: string | null): void {
  app.setAboutPanelOptions({
    applicationName: `${PRODUCT} (beta)`,
    applicationVersion: app.getVersion(),
    copyright: 'GUY FVWKS',
    credits:
      `Beta · Mac (Apple silicon) only.${inviteId ? ` Unlocked with invite ${inviteId}.` : ''}\n` +
      'Invite codes are checked on this Mac with no server, so a code that leaks can only be blocked by an update.' +
      `\n\nType a line. Get a finished vocal.\n\n${CREDIT}`,
  })
}

/**
 * After a code is accepted in Setup's ACTIVATE step: straight into the Studio when Setup was done before on this Mac,
 * otherwise Setup carries on to its WELCOME step (the engine starts now, Setup installs the models as usual).
 */
function afterActivation(): 'app' | 'setup' {
  const setupDone = !shouldShowSetup({
    packaged: app.isPackaged,
    bundled: Boolean(BUNDLED_ENGINE),
    forceEnv: devEnv('FVWKS_FORCE_SETUP'),
    markerExists: hasSetupMarker(USER_DATA),
  })
  setTimeout(() => {
    if (setupDone) {
      createWindow()
      setupWindow?.close()
    }
    void startEngine()
  }, 900) // the step shows ACCEPTED for a moment
  return setupDone ? 'app' : 'setup'
}

/** Required models still missing, per the engine itself (so the marker is only written once they're installed). */
async function setupCheck(): Promise<{ missing: string[]; healthState: string | null; error: string | null }> {
  if (!supervisor?.isReady) return { missing: [], healthState: null, error: 'The engine is not running yet.' }
  try {
    const missing = requiredMissing(await supervisor.getJson('/api/models', 15_000))
    if (!missing) return { missing: [], healthState: null, error: 'The engine answered with an unexpected model list.' }
    const health = (await supervisor.getJson('/api/health', 5_000).catch(() => null)) as { state?: unknown } | null
    return { missing, healthState: typeof health?.state === 'string' ? health.state : null, error: null }
  } catch (err) {
    return { missing: [], healthState: null, error: `The engine did not answer: ${(err as Error).message}` }
  }
}

/** How long a first run waits for the engine to answer before it opens Setup anyway (Setup watches it from there). */
const FIRST_RUN_WAIT_MS = 20_000

/**
 * First run: the engine starts before any window, because the models may already be on this Mac. When it answers
 * with no required model missing, Setup is skipped and the Studio opens on its boot screen; otherwise (models to
 * download, or an engine that is slow, blocked or failing) Setup opens as before.
 */
async function openFirstRunWindow(): Promise<void> {
  await startEngine()
  if (!MOCK && supervisor && (await supervisor.waitUntilReady(FIRST_RUN_WAIT_MS))) {
    const check = await setupCheck()
    if (!check.error && check.missing.length === 0) {
      try {
        writeSetupMarker(USER_DATA, { version: app.getVersion(), bundled: Boolean(BUNDLED_ENGINE) })
        log('first run: the required models are already on this Mac; skipping Setup')
        createWindow()
        return
      } catch (err) {
        log(`setup marker not written: ${(err as Error).message}`)
      }
    }
  }
  log(`first run: opening Setup (bundled engine: ${BUNDLED_ENGINE ?? 'no'})`)
  createSetupWindow()
}

/** A native yes/no the renderer can't answer for the user (update source changes, installing an update). */
async function confirmDialog(o: { message: string; detail: string; ok: string }): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? setupWindow
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: [o.ok, 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: o.message,
    detail: o.detail,
  }
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return result.response === 0
}

/** The running .app (…/FoxBox Voice.app/Contents/MacOS/FoxBox Voice → the bundle). */
function runningAppBundle(): string | null {
  const bundle = resolve(process.execPath, '..', '..', '..')
  return bundle.endsWith('.app') ? bundle : null
}

/** App updates come from the feed address the user sets in SETTINGS → UPDATES; there is no built-in host. */
function createUpdater(): Updater {
  const u = new Updater({
    currentVersion: app.getVersion(),
    userData: USER_DATA,
    packaged: app.isPackaged,
    appBundle: app.isPackaged ? runningAppBundle() : null,
    log: (line) => log(`updates: ${line}`),
    confirmFeed: (url) =>
      confirmDialog({
        message: `Get ${PRODUCT} updates from this address?`,
        detail: `${url}\n\nUpdates are downloaded from here and verified (SHA-256, bundle id, version, code signature) before they can install.`,
        ok: 'Use this address',
      }),
    confirmInstall: ({ version, host }) =>
      confirmDialog({
        message: `Restart to update to ${PRODUCT} ${version}?`,
        detail: `Downloaded from ${host} and verified. ${PRODUCT} quits, replaces itself and reopens. The current version is kept until the new one has started.`,
        ok: 'Restart to update',
      }),
    // The engine runs from inside the app bundle: stop it before the bundle moves, start it again if the swap failed.
    beforeSwap: async () => {
      await supervisor?.stop()
    },
    afterFailedSwap: async () => {
      await supervisor?.start()
    },
    // The new app's engine came out of a downloaded archive: clear its quarantine before it first launches.
    afterSwap: async (appPath) => {
      const resources = join(appPath, 'Contents', 'Resources')
      const dir = bundledEngineDir(resources)
      if (dir) await clearEngineQuarantine(dir, { within: resources, log: (line) => log(`updates: ${line}`) })
    },
    relaunch: () => {
      quitting = true
      app.relaunch()
      app.exit(0)
    },
    tokenStore: githubTokenStore(join(USER_DATA, 'updates-token.bin')),
  })
  u.on('state', (state) => broadcast(IPC.updatesState, state))
  return u
}

/**
 * The update check at boot, for the main window's boot screen (bootUpdate.ts). The daily checks start only once it
 * is out of the way (clear: up to date, skipped, or CONTINUE), so they never race its download.
 * FVWKS_SKIP_BOOT_UPDATE=1 skips it, packaged builds included (isolated test copies).
 */
function createBootGate(u: Updater, firstRun: boolean): BootUpdateGate {
  const optOut = process.env.FVWKS_SKIP_BOOT_UPDATE === '1'
  const skip = bootSkipReason({ packaged: app.isPackaged, firstRun, optOut, state: u.getState() })
  const gate = new BootUpdateGate({ updater: u, current: app.getVersion(), skip, log: (line) => log(`updates: ${line}`) })
  gate.on('state', (state) => {
    broadcast(IPC.bootUpdateState, state)
    if (state.phase === 'clear') u.startAutoCheck()
  })
  if (skip) u.startAutoCheck()
  return gate
}

/** Before the gate exists (or with none): nothing holds the boot. */
const bootClear = (): BootUpdateState => ({
  phase: 'clear',
  current: app.getVersion(),
  version: null,
  sizeBytes: null,
  step: null,
  download: null,
  attempt: 0,
  error: null,
})

/** The only sites a link in the app may open in the browser (the uv install hint). */
const EXTERNAL_HOSTS = new Set(['docs.astral.sh'])
/** The only mail link: the designer credit (CreditLink). Its address is injected at build time, never committed. */
const MAIL_TO = new Set(__CREDIT_EMAIL__ ? [__CREDIT_EMAIL__.toLowerCase()] : [])
const CREDIT = __CREDIT_EMAIL__ ? `Designed by SmittyTech (${__CREDIT_EMAIL__})` : 'Designed by SmittyTech'

function isExternalLink(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'mailto:') return MAIL_TO.has(decodeURIComponent(u.pathname).toLowerCase()) && !u.search
    return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/** Page zoom in the menu's own steps (±0.5 levels, clamped); 0 = actual size. */
function zoomPage(wc: Electron.WebContents, step: -1 | 0 | 1): void {
  wc.setZoomLevel(step === 0 ? 0 : Math.max(-3, Math.min(3, wc.getZoomLevel() + step * 0.5)))
}

function lockDownNavigation(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) {
        event.preventDefault()
        log(`blocked navigation to ${url}`)
      }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLink(url)) void shell.openExternal(url)
      else log(`blocked window.open to ${url}`)
      return { action: 'deny' }
    })
  })
}

/** No downloads: nothing in FoxBox Voice saves through the browser (exports are written by the engine). */
function handleDownloads(): void {
  session.defaultSession.on('will-download', (_event, item, contents) => {
    log(`blocked a download from ${contents?.getURL() ?? 'nowhere'}`)
    item.cancel()
  })
}

/** Media (audio only), output-device selection and clipboard writes from our renderer; nothing else. */
function lockDownPermissions(): void {
  const ses = session.defaultSession
  const allowed = new Set(['media', 'speaker-selection', 'clipboard-sanitized-write'])
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (!allowed.has(permission) || !isTrustedUrl(details.requestingUrl)) return callback(false)
    if (permission === 'media') {
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      // Audio (recording) only, for our own renderer only.
      return callback(types.length > 0 && types.every((t) => t === 'audio'))
    }
    callback(true)
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    if (!allowed.has(permission)) return false
    return RENDERER_URL ? origin === new URL(RENDERER_URL).origin : origin.startsWith('file://')
  })
}

function registerAudioProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const cors = { 'Access-Control-Allow-Origin': '*' }
    if (url.hostname !== 'audio' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
      return new Response('not found', { status: 404, headers: cors })
    }
    if (!supervisor?.isReady) return new Response('engine offline', { status: 503, headers: cors })
    try {
      const range = request.headers.get('range')
      const upstream = await supervisor.request(`/api/audio/${encodeURIComponent(id)}`, {
        headers: range ? { Range: range } : {},
        signal: AbortSignal.timeout(60_000),
      })
      const headers = new Headers(cors)
      for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
        const v = upstream.headers.get(h)
        if (v) headers.set(h, v)
      }
      headers.set('Cache-Control', 'private, max-age=3600')
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (err) {
      return new Response(`engine unreachable: ${(err as Error).message}`, { status: 502, headers: cors })
    }
  })
}

// ---------------------------------------------------------------------------------------------
// IPC

function registerIpc(): void {
  ipcMain.on(IPC.bootInfo, (event) => {
    const info: BootInfo = { mock: MOCK && trusted(event) }
    event.returnValue = info
  })

  // Every renderer → engine request goes through here; main adds the token.
  ipcMain.handle(IPC.engineRequest, async (event, raw: unknown): Promise<EngineResponse> => {
    if (!trusted(event)) return errorResponse(403, 'forbidden', 'Request refused.')
    const parsed = parseEngineRequest(raw)
    if ('error' in parsed) return errorResponse(400, 'bad_request', parsed.error)
    const req = parsed.request
    if (!supervisor?.isReady) {
      const st = engineStatus()
      const why = st.state === 'starting' || st.state === 'restarting' ? 'The engine is starting.' : 'The engine is not running.'
      return errorResponse(503, 'engine_offline', why, 'It restarts by itself; you can also press Reconnect.', true)
    }
    const ctrl = new AbortController()
    inflight.set(req.id, ctrl)
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), req.timeoutMs ?? 300_000)
    try {
      const res = await supervisor.request(req.path, {
        method: req.method,
        headers: req.headers,
        ...(req.body ? { body: Buffer.from(req.body) } : {}),
        signal: ctrl.signal,
      })
      const body = res.status === 204 ? null : await res.arrayBuffer()
      const headers = pickHeaders(res.headers)
      if (body && res.ok && headers['content-type']?.includes('json')) exportGuard.noteResponse(req.method, req.path, body)
      return { status: res.status, statusText: res.statusText, headers, body }
    } catch (err) {
      if (ctrl.signal.aborted && (ctrl.signal.reason as Error | undefined)?.message !== 'timeout') {
        return errorResponse(499, 'aborted', 'Request cancelled.')
      }
      const timedOut = ctrl.signal.aborted
      return errorResponse(
        timedOut ? 504 : 502,
        timedOut ? 'engine_timeout' : 'engine_unreachable',
        timedOut ? 'The engine took too long to answer.' : `The engine did not answer: ${(err as Error).message}`,
        null,
        true,
      )
    } finally {
      clearTimeout(timer)
      inflight.delete(req.id)
    }
  })

  ipcMain.on(IPC.engineAbort, (event, id: unknown) => {
    if (trusted(event) && typeof id === 'string') inflight.get(id)?.abort()
  })

  ipcMain.handle(IPC.engineStatusGet, (event) => (trusted(event) ? engineStatus() : null))

  ipcMain.handle(IPC.engineRestart, async (event) => {
    if (!trusted(event)) return
    log('manual engine restart')
    if (supervisor) await supervisor.restart()
    else await startEngine()
  })

  ipcMain.on(IPC.startDrag, (event, rawPaths: unknown, rawOptions: unknown) => {
    if (!trusted(event)) return
    const list = (Array.isArray(rawPaths) ? rawPaths : [rawPaths]).slice(0, 200)
    const files = list.map((p) => exportGuard.resolveDraggable(p)).filter((f): f is string => Boolean(f))
    if (files.length === 0 || files.length !== list.length) {
      log(`refused drag of ${list.length} path(s): not returned by the engine inside ${JSON.stringify(exportGuard.roots)}`)
      return
    }
    // The drag image is always main's own cartridge PNG: images from the renderer are never decoded here.
    void rawOptions
    const icon = dragIcon()
    const [first] = files as [string, ...string[]]
    event.sender.startDrag(files.length === 1 ? { file: first, icon } : { file: first, files, icon })
  })

  ipcMain.handle(IPC.reveal, (event, raw: unknown) => {
    if (!trusted(event)) return false
    const target = exportGuard.resolveRevealable(raw)
    if (!target) {
      log(`refused reveal: ${String(raw)}`)
      return false
    }
    shell.showItemInFolder(target)
    return true
  })

  // Renderer errors an error boundary caught: into main.log, clipped and at most 30 a minute.
  let errorWindow = 0
  let errorCount = 0
  ipcMain.on(IPC.logError, (event, scope: unknown, message: unknown, stack: unknown) => {
    if (!trusted(event)) return
    const now = Date.now()
    if (now - errorWindow > 60_000) {
      errorWindow = now
      errorCount = 0
    }
    if (++errorCount > 30) return
    const text = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
    log(`renderer error [${text(scope, 40)}]: ${text(message, 1000)}${typeof stack === 'string' ? `\n${text(stack, 4000)}` : ''}`)
  })

  ipcMain.on(IPC.log, (event, scope: unknown, message: unknown) => {
    if (!trusted(event) || typeof scope !== 'string' || typeof message !== 'string') return
    log(`[${scope.slice(0, 40)}] ${message.slice(0, 300)}`)
  })

  // Free bytes on the export folder's volume (SETTINGS' low-disk line; the folder may not exist yet: its parent then).
  ipcMain.handle(IPC.diskFree, async (event) => {
    if (!trusted(event)) return null
    const root = exportGuard.root ?? EXPORT_DIR
    for (const dir of [root, dirname(root)]) {
      try {
        const s = await statfs(dir)
        return s.bavail * s.bsize
      } catch {
        // try the parent
      }
    }
    return null
  })

  ipcMain.handle(IPC.chooseFolder, async (event, raw: unknown) => {
    if (!trusted(event)) return null
    const opts = raw && typeof raw === 'object' ? (raw as { title?: unknown; defaultPath?: unknown }) : {}
    const win = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: typeof opts.title === 'string' ? opts.title : 'Choose a folder',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      ...(typeof opts.defaultPath === 'string' ? { defaultPath: opts.defaultPath } : {}),
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.askMic, async (event) => {
    if (!trusted(event)) return false
    if (FAKE_MIC || process.platform !== 'darwin') return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  ipcMain.handle(IPC.micStatus, (event): MicAccess => {
    if (!trusted(event)) return 'unknown'
    if (FAKE_MIC) return 'granted'
    if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown'
    return systemPreferences.getMediaAccessStatus('microphone') as MicAccess
  })

  // Fixed URL: the Microphone pane of Privacy & Security (for the RECORD tab's "mic access denied" state).
  ipcMain.handle(IPC.openMicSettings, async (event) => {
    if (trusted(event) && process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
    }
  })
  ipcMain.on(IPC.zoom, (event, step: unknown) => {
    if (trusted(event) && (step === -1 || step === 0 || step === 1)) zoomPage(event.sender, step)
  })

  ipcMain.handle(IPC.openLogs, async (event) => {
    if (trusted(event)) await shell.openPath(LOG_DIR)
  })

  // Beta access ------------------------------------------------------------------------------
  ipcMain.handle(IPC.betaState, (event) => (trusted(event) && betaAccess ? betaAccess.status() : { state: 'needed' }))
  ipcMain.handle(IPC.betaActivate, async (event, code: unknown) => {
    if (!trusted(event) || !betaAccess || event.sender !== setupWindow?.webContents) return { ok: false, error: 'Refused.' }
    if ((await betaAccess.status()).state === 'active') return { ok: false, error: 'This Mac is already unlocked.' }
    const result = await betaAccess.activate(code)
    // The code itself is never logged; its public id is.
    log(result.ok ? `beta access: this Mac is unlocked (${result.id})` : 'beta access: an invite code was refused')
    if (!result.ok) return result
    setAbout(result.id)
    return { ...result, next: afterActivation() }
  })

  ipcMain.on(IPC.splashDone, (event) => {
    if (!trusted(event) || event.sender !== splashWindow?.webContents) return
    studioWanted = true
    showStudioWhenDue()
  })
  ipcMain.on(IPC.appQuit, (event) => {
    if (trusted(event)) app.quit()
  })

  ipcMain.handle(IPC.welcome, (event, artist: unknown) =>
    trusted(event) && typeof artist === 'string' && artist.length <= 200 ? openWelcome(artist, sealedWelcome as Sealed | null) : null,
  )

  // First-run Setup -------------------------------------------------------------------------
  ipcMain.handle(IPC.setupInfo, async (event): Promise<SetupInfo | null> => {
    if (!trusted(event)) return null
    return {
      bundled: Boolean(BUNDLED_ENGINE),
      modelsDir: BUNDLED_ENGINE ? bundledModelsDir(DATA_DIR) : process.env.HF_HOME || join(homedir(), '.cache', 'huggingface'),
      dataDir: DATA_DIR,
      home: homedir(),
      // Both mean "Move FoxBox to Applications, then open it again".
      translocated: TRANSLOCATED || (await engineQuarantine()) === 'blocked',
    }
  })

  ipcMain.handle(IPC.setupComplete, async (event): Promise<SetupCompleteResult> => {
    const setup = setupWindow
    if (!trusted(event) || !setup || event.sender !== setup.webContents) return { ok: false, error: 'Refused.' }
    let restartEngine = false
    if (!MOCK) {
      const check = await setupCheck()
      if (check.error) return { ok: false, error: check.error }
      if (check.missing.length) return { ok: false, error: `Still installing: ${check.missing.join(', ')}.`, missing: check.missing }
      // A first-run download that failed and was retried leaves the engine reporting that error until it restarts.
      restartEngine = check.healthState === 'error'
    }
    try {
      writeSetupMarker(USER_DATA, { version: app.getVersion(), bundled: Boolean(BUNDLED_ENGINE) })
    } catch (err) {
      log(`setup marker not written: ${(err as Error).message}`)
      return { ok: false, error: `Could not save the setup state: ${(err as Error).message}` }
    }
    log(`setup complete; opening the studio${restartEngine ? ' (restarting the engine to load the new models)' : ''}`)
    if (restartEngine) void supervisor?.restart()
    if (!mainWindow) createWindow()
    setup.close()
    return { ok: true }
  })

  // App updates (all network and file work happens in the Updater) ---------------------------
  const updates = (channel: string, fn: (u: Updater, arg: unknown) => Promise<UpdateState> | UpdateState) =>
    ipcMain.handle(channel, async (event, arg: unknown) => {
      if (!trusted(event) || !updater) throw new Error('Refused.')
      return fn(updater, arg)
    })
  updates(IPC.updatesGet, (u) => u.getState())
  updates(IPC.updatesCheck, (u) => u.check())
  updates(IPC.updatesDownload, (u) => u.download())
  updates(IPC.updatesCancel, (u) => u.cancel())
  updates(IPC.updatesInstall, (u) => u.install())
  updates(IPC.updatesSetFeed, (u, url) => {
    if (url !== null && typeof url !== 'string') throw new Error('The feed address must be text.')
    return u.setFeedUrl(url)
  })
  updates(IPC.updatesSetToken, (u, token) => {
    if (token !== null && typeof token !== 'string') throw new Error('The token must be text.')
    return u.setToken(token)
  })
  updates(IPC.updatesDismissWhatsNew, (u) => u.dismissWhatsNew())

  // The update check at boot: the main window's boot screen shows it; CONTINUE only after a failure.
  ipcMain.handle(IPC.bootUpdateGet, (event): BootUpdateState => {
    if (!trusted(event)) throw new Error('Refused.')
    return bootGate?.getState() ?? bootClear()
  })
  ipcMain.handle(IPC.bootUpdateContinue, (event): BootUpdateState => {
    if (!trusted(event) || event.sender !== mainWindow?.webContents) throw new Error('Refused.')
    return bootGate?.continue() ?? bootClear()
  })
}

// ---------------------------------------------------------------------------------------------
// Engine

async function startEngine(): Promise<void> {
  if (MOCK) {
    log('FVWKS_MOCK=1: not starting the engine; the renderer uses MSW mocks')
    return
  }
  let launch
  try {
    launch = resolveEngineLaunch({
      env: process.env,
      engineDir: ENGINE_DIR,
      exportDir: EXPORT_DIR,
      allowOverrides: !app.isPackaged,
      bundle: BUNDLED_ENGINE ? { dir: BUNDLED_ENGINE, dataDir: DATA_DIR } : null,
    })
  } catch (err) {
    offlineReason = (err as Error).message
    log(`engine: ${offlineReason}`)
    broadcast(IPC.engineStatus, engineStatus())
    return
  }
  offlineReason = null
  log(`engine: ${launch.describe} (data ${DATA_DIR}, exports ${EXPORT_DIR})`)
  // A downloaded DMG quarantines the bundled Python; Gatekeeper may refuse to exec it from our child process.
  if ((await engineQuarantine()) === 'blocked') {
    // Launching would bring up a Gatekeeper dialog for each of the engine's libraries: ask for the move instead.
    offlineReason = MOVE_TO_APPLICATIONS
    log(`engine: not started: ${offlineReason}`)
    broadcast(IPC.engineStatus, engineStatus())
    return
  }
  exportGuard.setRoot(EXPORT_DIR)
  supervisor = new EngineSupervisor({
    command: launch.command,
    args: launch.args,
    extraArgs: launch.extraArgs,
    ...(launch.cwd ? { cwd: launch.cwd } : {}),
    ...(launch.setup ? { setup: launch.setup } : {}),
    env: { ...launch.env, FVWKS_APP_VERSION: app.getVersion() }, // rekordbox.xml's PRODUCT Version
    token,
    dataDir: DATA_DIR,
    logFile: join(LOG_DIR, 'engine.log'),
    pidFile: join(USER_DATA, 'engine.pid'),
    startTimeoutMs: Number(process.env.FVWKS_ENGINE_START_TIMEOUT_MS) || 180_000,
  })
  supervisor.on('status', (status) => {
    if (status.state !== lastState) log(`engine ${status.state}${status.lastError ? `: ${status.lastError}` : ''}`)
    const health = status.health as { export_dir?: unknown } | null
    if (status.state === 'ready' && typeof health?.export_dir === 'string') exportGuard.setRoot(health.export_dir)
    lastState = status.state
    if (!warmLogged && (status.health as { state?: unknown } | null)?.state === 'ready') {
      warmLogged = true
      log(`boot: engine warm +${Date.now() - bootT0} ms`)
    }
    broadcast(IPC.engineStatus, status)
  })
  await supervisor.start()
}

// ---------------------------------------------------------------------------------------------
// Lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? setupWindow
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  lockDownNavigation()
  registerIpc()

  void app.whenReady().then(async () => {
    bootT0 = Date.now()
    log(`starting ${app.getName()} ${app.getVersion()} (packaged=${app.isPackaged}, mock=${MOCK}, engine=${ENGINE_DIR})`)
    lockDownPermissions()
    handleDownloads()
    registerAudioProtocol()
    // About: the designer credit (never written into exported files).
    setAbout(null)
    Menu.setApplicationMenu(
      buildMenu(
        (command) => sendToRenderer(IPC.menuCommand, command),
        () => void shell.openPath(LOG_DIR),
        !app.isPackaged,
        (step) => {
          const wc = BrowserWindow.getFocusedWindow()?.webContents
          if (wc) zoomPage(wc, step)
        },
      ),
    )
    updater = createUpdater()
    // An update that kept failing to start: put the previous app back (it relaunches) before anything else runs.
    if (updater.needsRollback && updater.rollback()) return
    // The splash first: it says "Checking your invite" while the activation check below runs.
    if (SPLASH) createSplashWindow()
    // Beta access, checked on every launch (offline): without a valid activation, Setup opens at its ACTIVATE step and
    // nothing else starts (no engine, no Studio) until a code is accepted (afterActivation).
    betaAccess = new BetaAccess(USER_DATA, codeBook as CodeBook, await hardwareUuid())
    const beta = await betaAccess.status()
    if (beta.state === 'active') setAbout(beta.id)
    else if (BETA_GATE) {
      log(`beta access: ${beta.state === 'revoked' ? `invite ${beta.id} was revoked` : 'no valid invite on this Mac'}; Setup asks for a code`)
      bootGate = createBootGate(updater, true)
      closeSplash()
      createSetupWindow()
      setupWindow?.webContents.once('did-finish-load', () => void updater?.confirmLaunch())
      return
    }
    if (TRANSLOCATED) log(`running translocated (${process.execPath}); Setup asks to move the app to Applications`)
    const firstRun = shouldShowSetup({
      packaged: app.isPackaged,
      bundled: Boolean(BUNDLED_ENGINE),
      forceEnv: devEnv('FVWKS_FORCE_SETUP'),
      markerExists: hasSetupMarker(USER_DATA),
    })
    // After the rollback above, never in front of Setup; it holds the boot screen only (the engine starts as usual).
    bootGate = createBootGate(updater, firstRun)
    if (firstRun) {
      closeSplash()
      await openFirstRunWindow()
    } else {
      createWindow(Boolean(splashWindow))
    }
    // A window that loaded confirms an update's good start (the previous app kept for rollback can go).
    ;(mainWindow ?? setupWindow)?.webContents.once('did-finish-load', () => void updater?.confirmLaunch())
    void bootGate.run()
    if (!firstRun) await startEngine()
  })

  app.on('window-all-closed', () => app.quit())

  app.on('before-quit', (event) => {
    updater?.dispose()
    if (quitting || !supervisor) return
    event.preventDefault()
    quitting = true
    log('quitting: stopping the engine')
    for (const ctrl of inflight.values()) ctrl.abort()
    void supervisor
      .stop()
      .catch((err: Error) => log(`engine stop failed: ${err.message}`))
      .finally(() => app.quit())
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit())
  process.on('exit', () => supervisor?.killSync())
}
