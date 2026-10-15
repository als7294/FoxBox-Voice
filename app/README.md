# FoxBox Voice: app (beta)

Electron + React + TypeScript (strict), built with electron-vite. The renderer never talks to the Python engine
directly: main spawns it, holds its token and proxies every call.

```
renderer (React, sandboxed) ──window.fvwks──▶ preload ──IPC──▶ main ──HTTP + Bearer──▶ fvwks-engine (127.0.0.1:random)
      ▲  JSON: engine.request()                                   │
      └─ audio: fetch/<audio src="vbx://audio/<id>"> ◀── protocol.handle('vbx') streams GET /api/audio/{id}
```

## Commands
| | |
|---|---|
| `npm run dev` | Electron with HMR. Spawns `../engine/.venv/bin/fvwks-engine` (runs `uv sync --all-packages` first if the venv is missing). Dev data goes in `<repo>/.devdata/{data,exports,electron}`. |
| `npm run dev:mock` | Electron, no engine: MSW answers `/api/*` from `contracts/examples` + `fixtures/voices`. |
| `npm run web` | Same UI in a normal browser at http://localhost:5199 with the MSW mock engine. |
| `npm test` | Vitest: main process (supervisor, export guard, proxy), renderer logic, and components. |
| `npm run e2e` | Build, then Playwright drives the real app against the repo engine: core loop, drag chain, crash restart, recording. |
| `npm run typecheck` | Checks main/preload, the renderer, unit tests and e2e tests. |
| `npm run gen:api` | Regenerates `src/renderer/src/api/schema.d.ts` from `contracts/openapi.yaml`. |
| `npm run package` | `electron-builder --mac dir` builds `release/mac-arm64/FoxBox Voice.app`: ad-hoc signed, with its fuses set. |
| `npm run package:install` | Packages, then copies the app to `~/Applications`. |

The packaged app is **linked** to an engine folder baked in at package time. By default that is the main checkout's
`engine/`; pass `node scripts/package.mjs --engine-dir <path>` to change it. `FVWKS_ENGINE_DIR` overrides it at run
time. Packaged data lives in `~/Library/Application Support/FoxBox Voice`; exports go to `~/Music/FoxBox Voice`, so the app
installs beside FoxBox and never shares its library, exports or update feed (`als7294/FoxBox-Voice` releases).

Environment overrides (dev, tests, debugging): `FVWKS_ENGINE_DIR`, `FVWKS_DATA_DIR`, `FVWKS_EXPORT_DIR`,
`FVWKS_USER_DATA_DIR`, `FVWKS_UV`, `FVWKS_ENGINE_CMD` (JSON argv, used by tests), `FVWKS_ENGINE_START_TIMEOUT_MS`,
`FVWKS_MOCK=1`, `FVWKS_BETA_GATE=1` (asks for an invite code in development too; packaged builds always ask).

## Beta access
Packaged builds open an access window first and nothing else starts until an invite code (FBV-XXXX-XXXX-XXXX) is
accepted: `src/main/beta.ts`. The app ships only each code's scrypt hash (`src/main/beta-codes.json`); the activation is
stored in the data folder, bound to the Mac. There is no server, so one code can unlock more than one Mac until an
update revokes it.
- `node scripts/mint-beta-codes.mjs <n> --out <file outside the repo>`: new codes go to that 0600 file only; commit the
  updated `beta-codes.json`.
- `node scripts/mint-beta-codes.mjs --revoke FBV-0007`: blocks a leaked code from the next release on.

## Releases
`node scripts/release.mjs beta` builds the DMG, the update zip, the part zips and `latest-mac.json` into
`release/<version>/`, and prints the `gh release create` line; it never publishes. Publish as a normal release
(`--latest`, not `--prerelease`): the app's feed is `releases/latest`, which skips pre-releases.
`../scripts/publish_snapshot.sh` pushes a history-free snapshot of `voice/main` to the `voice` remote, refusing
anything on the private deny-list or any minted invite code.

## Layout
- `src/main/`: app lifecycle, window, IPC, `vbx:` protocol, native menu.
  - `engine/supervisor.ts`: spawn, READY-line port discovery, `/api/health` wait, restart with backoff,
    process-group kill, stale-PID cleanup, logs (`<userData>/logs/engine.log`, `main.log`).
  - `engineProxy.ts`: validates renderer requests (`/api/` only, safe headers).
  - `exportGuard.ts`: drag/reveal only files the engine returned, inside its export root.
- `src/preload/`: the `window.fvwks` bridge (types in `src/shared/bridge.ts`).
- `src/renderer/src/`:
  - `api/`: generated schema, openapi-fetch client over the IPC transport, and TanStack Query hooks.
  - `state/`: Zustand stores (`studio`, `engine`, `ui`, `toasts`) and the render pipeline in `renderController.ts`.
  - `audio/`: WAV codec, bar grid, Web Audio A/B player (gapless loop), mic recorder (AudioWorklet), import.
  - `components/`: the handoff component names (layout, source, signal, rack, output, feedback), plus `access/` (beta)
    and `setup/` (first-run model install).
  - `screens/`: STUDIO and SETTINGS (no rail; the top bar's SETTINGS toggle or ⌘,).
  - `mocks/`: MSW handlers plus an in-memory mock engine.
  - `styles/tokens.css`: the ARCTIC design tokens (CSS variables); canvas drawing reads the same values.

## Security model
- `contextIsolation`, `sandbox`, no `nodeIntegration`. The strict CSP (`build/csp.ts`) is a meta tag, because pages load
  from `file://`.
- The engine token stays in main. Only requests under `/api/` pass the proxy, and the `Authorization` header is always
  set by main.
- IPC is accepted only from our own renderer document. Navigation and new windows are blocked. Permissions: audio
  capture, output-device selection and clipboard write only.
- `startDrag`/`reveal` accept only paths the engine returned in a proxied response, inside a reported export root,
  with symlinks resolved.
- Packaged fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, asar-only with integrity validation.
