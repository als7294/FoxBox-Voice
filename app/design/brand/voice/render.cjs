// Renders the placeholder raster brand art (until the painted arctic fox arrives): `npx electron design/brand/voice/render.cjs`
// from app/. Writes fbv-icon-1024.png, dmg-background.png (660×420) and dmg-background@2x.png next to this file.
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const windows = [] // kept open until the end: destroying one mid-run made the next load fail (ERR_FAILED)

async function shoot(file, width, height, scale, out) {
  const w = width * scale
  const h = height * scale
  const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true, zoomFactor: scale } })
  windows.push(win)
  await win.loadFile(join(__dirname, file))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })
  writeFileSync(join(__dirname, out), img.toPNG())
}

app.setPath('userData', join(tmpdir(), 'fbv-render'))
app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    await shoot('dmg.html', 660, 420, 1, 'dmg-background.png')
    await shoot('dmg.html', 660, 420, 2, 'dmg-background@2x.png')
    await shoot('fbv-icon.svg', 1024, 1024, 1, 'fbv-icon-1024.png')
    app.quit()
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
