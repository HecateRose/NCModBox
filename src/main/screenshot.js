/**
 * 宣传截图生成器（仅在设置 MODBOX_SHOT 环境变量时启用）。
 *
 * PowerShell:
 *   $env:MODBOX_SHOT="<输出目录>"; npm run build; npx electron .
 *
 * 通过 CDP 把视口强制成固定尺寸 + 2 倍像素密度，避免受屏幕分辨率限制。
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'

const VIEWPORT = { width: 1520, height: 940 }
const DETAIL_VIEWPORT = { width: 1180, height: 900 }

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const NO_MOTION_CSS =
  '.page-enter-active,.page-leave-active{transition:none !important;}' +
  '.page-enter-from,.page-leave-to{opacity:1 !important;transform:none !important;}' +
  // 宣传截图隐私：隐藏本地状态标签、操作按钮与侧边状态面板（避免暴露用户配置）
  '.pill-installed,.chip-plain,.chip-light,.row-actions,.detail-side,.side-card{visibility:hidden !important;}'

export function runCapture({ mainWindow, openModWindow, resolveModId }) {
  const dir = process.env.MODBOX_SHOT
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })

  const prepared = new WeakSet()

  async function shot(win, name, viewport) {
    try {
      if (!prepared.has(win.webContents)) {
        prepared.add(win.webContents)
        await win.webContents.insertCSS(NO_MOTION_CSS)
      }
      const dbg = win.webContents.debugger
      if (!dbg.isAttached()) dbg.attach('1.3')
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
        ...viewport,
        deviceScaleFactor: 2,
        mobile: false
      })
      await wait(600)
      const image = await win.webContents.capturePage()
      fs.writeFileSync(join(dir, name), image.toPNG())
      await dbg.sendCommand('Emulation.clearDeviceMetricsOverride')
      dbg.detach()
    } catch (err) {
      fs.appendFileSync(join(dir, 'error.txt'), `${name}: ${err && err.stack}\n`)
      console.error('[modbox] 截图失败', name, err)
    }
  }

  /** 等待 hash 路由切换完成（等 hash 匹配 + 页面标题元素出现） */
  async function waitPath(win, hash, timeout = 15000) {
    return win.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const started = Date.now()
        const timer = setInterval(() => {
          if (location.hash === '${hash}' && document.querySelector('.page-head-text h2')) {
            clearInterval(timer)
            resolve(true)
            return
          }
          if (Date.now() - started > ${timeout}) {
            clearInterval(timer)
            resolve(false)
          }
        }, 150)
      })`
    )
  }

  async function waitFor(win, selector, timeout = 20000) {
    try {
      return await win.webContents.executeJavaScript(
        `new Promise((resolve) => {
          const started = Date.now()
          const timer = setInterval(() => {
            if (document.querySelector(${JSON.stringify(selector)})) {
              clearInterval(timer)
              resolve(true)
            } else if (Date.now() - started > ${timeout}) {
              clearInterval(timer)
              resolve(false)
            }
          }, 200)
        })`
      )
    } catch {
      return false
    }
  }

  mainWindow.webContents.once('did-finish-load', async () => {
    await waitFor(mainWindow, '.mod-row', 30000)
    await wait(1500)
    await shot(mainWindow, '01-browse.png', VIEWPORT)

    await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.filter-trigger')?.click()"
    )
    await wait(900)
    await shot(mainWindow, '01c-filter.png', VIEWPORT)
    await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.filter-trigger')?.click()"
    )
    await wait(500)

    for (let round = 0; round < 4; round += 1) {
      await mainWindow.webContents.executeJavaScript(
        "document.querySelector('.app-content').scrollTo({ top: 999999 })"
      )
      await wait(2600)
    }
    await shot(mainWindow, '01b-bottom.png', VIEWPORT)
    await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.app-content').scrollTo({ top: 0 })"
    )
    await wait(600)

    await mainWindow.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector('.topbar-search input')
        if (!input) return false
        input.value = 'archive'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('.search-submit')?.click()
        return true
      })()`
    )
    await wait(32000)
    await shot(mainWindow, '01d-search.png', VIEWPORT)
    await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.page-head-tools .btn-ghost')?.click()"
    )
    await wait(1000)

    await mainWindow.webContents.executeJavaScript("location.hash = '#/favorites'")
    await waitPath(mainWindow, '#/favorites')
    await wait(500)
    await shot(mainWindow, '02-favorites.png', VIEWPORT)

    await mainWindow.webContents.executeJavaScript("location.hash = '#/installed'")
    await waitPath(mainWindow, '#/installed')
    await wait(500)
    await shot(mainWindow, '03-installed.png', VIEWPORT)

    await mainWindow.webContents.executeJavaScript("location.hash = '#/deploy'")
    await waitPath(mainWindow, '#/deploy')
    await waitFor(mainWindow, '.deploy-tabs', 15000)
    await waitFor(mainWindow, '.mod-list .deploy-row', 15000)
    await wait(1500)
    await shot(mainWindow, '03b-deploy.png', VIEWPORT)

    // 排序列表 tab（冲突扫描 + 加载顺序）
    await mainWindow.webContents.executeJavaScript(
      "document.querySelectorAll('.deploy-tab')[2]?.click()"
    )
    await wait(1200)
    await shot(mainWindow, '03d-deploy-order.png', VIEWPORT)
    await mainWindow.webContents.executeJavaScript("location.hash = '#/history'")
    await waitPath(mainWindow, '#/history')
    await wait(1200)
    await shot(mainWindow, '03c-downloads.png', VIEWPORT)

    const modId = resolveModId ? resolveModId() : null
    if (!modId) {
      setTimeout(() => app.quit(), 600)
      return
    }

    const detail = openModWindow(modId)
    detail.webContents.once('did-finish-load', async () => {
      await waitFor(detail, '.detail-hero', 20000)
      await waitFor(detail, '.bb-gallery .bb-figure', 30000)
      await wait(1800)
      await shot(detail, '04-detail.png', DETAIL_VIEWPORT)

      await detail.webContents.executeJavaScript(
        "document.querySelector('.bb-gallery')?.scrollIntoView({ block: 'center' })"
      )
      await wait(1500)
      await shot(detail, '05-detail-images.png', DETAIL_VIEWPORT)

      await detail.webContents.executeJavaScript(
        "document.querySelector('.bar-toggle')?.click(); document.querySelector('.detail-scroll').scrollTo({ top: 300 })"
      )
      await wait(8000)
      await shot(detail, '06-detail-zh.png', DETAIL_VIEWPORT)
      setTimeout(() => app.quit(), 600)
    })
  })

  setTimeout(() => app.quit(), 70000)
}
