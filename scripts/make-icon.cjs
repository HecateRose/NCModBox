/**
 * 把 scripts/icon.svg 渲染成 build/icon.png（512x512，供 electron-builder 转 ico）
 * 用法：npx electron scripts/make-icon.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SVG = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8')
const OUT = path.join(__dirname, '..', 'build', 'icon.png')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })

  const html = `<html><body style="margin:0;background:transparent">${SVG}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 600))

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, image.toPNG())
  console.log('icon written:', OUT, fs.statSync(OUT).size)
  app.quit()
})
