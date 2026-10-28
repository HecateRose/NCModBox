/**
 * 真实下载：复用用户在程序内登录的 Nexus 会话。
 * 流程：离屏窗口打开文件页 → 自动点击 Slow download → will-download 拦截文件流 → 存到本地包体目录。
 * 免费账号可用（限速），无需 Premium；会话 Cookie 持久化，登录一次长期有效。
 */
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, session } from 'electron'
import { getPaths } from './settings'

const FILES_TIMEOUT = 45000
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000
const CLICK_ROUNDS = 10

let loginWindow = null

export function packagesDir() {
  // 可在「设置」或「下载历史」里改成自定义目录；未设置时用 userData/mod-packages
  const custom = getPaths().downloadPath
  return custom || path.join(app.getPath('userData'), 'mod-packages')
}

function ensurePackagesDir() {
  const dir = packagesDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 判断登录态。
 * 注意：Nexus 新前端是 SPA，未登录访问 myaccount 不会 302 跳转（旧址用 URL 跳转判断会误报已登录），
 * 所以改为打开一个公开 mod 的 FILES 页，看是否出现「You have to be logged in」。
 */
export async function checkLogin() {
  let win = null
  try {
    win = new BrowserWindow({ show: false, skipTaskbar: true, width: 1200, height: 900 })
    win.loadURL('https://www.nexusmods.com/cyberpunk2077/mods/4198?tab=files').catch(() => {})
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 12000)
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          clearTimeout(timer)
          resolve()
        }, 1500)
      })
    })
    const needLogin = await win.webContents
      .executeJavaScript(
        `/You have to be logged in|You need to be logged in/i.test(document.body ? document.body.innerText : '')`
      )
      .catch(() => true)
    return { loggedIn: !needLogin }
  } catch {
    return { loggedIn: false }
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}

/** 打开登录窗口，用户手动登录后关闭即可（Cookie 已持久化） */
export function openLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }
  loginWindow = new BrowserWindow({
    width: 1080,
    height: 800,
    title: '登录 Nexus Mods（登录完成后关闭此窗口）',
    backgroundColor: '#101114',
    autoHideMenuBar: true
  })
  loginWindow.setMenuBarVisibility(false)
  // 不让网页 title 覆盖窗口标题，避免只显示一个 "App"
  loginWindow.on('page-title-updated', (event) => event.preventDefault())
  // Nexus 改版后 /auth/signin 已 404；users 站点根路径就是统一登录入口
  loginWindow.loadURL('https://users.nexusmods.com/')
  loginWindow.on('closed', () => {
    loginWindow = null
  })
}

/**
 * 下载某个 mod 的主文件：
 * 1) 离屏窗口加载 ?tab=files（共享已登录会话）
 * 2) 轮询找到 Slow download 按钮并点击
 * 3) will-download 捕获文件流，保存到 mod-packages 目录
 */
/**
 * 下载某个 mod 的主文件。
 *
 * 2026-10 的 Nexus 改版把下载入口换成了 <mod-download-modal> Web Component：
 * 里面的 Manual 按钮只在真实用户手势下弹出下载对话框，JS 点击 / CDP 注入的鼠标事件都不会触发
 * （已验证：点击只发埋点请求，弹窗内容为空）。
 *
 * 所以流程改为：
 *   打开一个可见窗口 → 加载该 mod 的 FILES 页 → 提示用户点击 Manual → Slow download
 *   → 程序用 session 的 will-download 接管落盘（后续解压/绑定记录由调用方完成）。
 */
export async function downloadModFile(modId, onProgress = () => {}) {
  const modIdNum = Number(modId)
  if (!modIdNum) return { ok: false, error: '无效的模组 ID' }

  const saveDir = ensurePackagesDir()
  let win = null
  let cleanupDownload = () => {}

  try {
    win = new BrowserWindow({
      width: 1320,
      height: 920,
      title: '下载 Mod · NightCity Modbox',
      autoHideMenuBar: true,
      webPreferences: { backgroundThrottling: false }
    })
    win.setMenuBarVisibility(false)
    win.on('page-title-updated', (event) => event.preventDefault())
    win.loadURL(`https://www.nexusmods.com/cyberpunk2077/mods/${modIdNum}?tab=files`).catch(() => {})

    // 等页面真正加载完，直接用自己的页面内容判断登录态（不再单独开探测页，省掉一次加载）
    const loaded = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 25000)
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          clearTimeout(timer)
          resolve(true)
        }, 1500)
      })
      win.once('closed', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
    if (!loaded) return { ok: false, error: '页面加载超时，请重试' }

    const needLogin = await win.webContents
      .executeJavaScript(
        `/You have to be logged in|You need to be logged in/i.test(document.body ? document.body.innerText : '')`
      )
      .catch(() => false)
    if (needLogin) {
      return {
        ok: false,
        needsLogin: true,
        error: '尚未登录 Nexus，请先点击顶栏「登录」完成登录后再下载'
      }
    }

    const saved = await new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, error: '下载超时：请在页面中点击 Manual → Slow download' }),
        DOWNLOAD_TIMEOUT
      )
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanupDownload()
        resolve(value)
      }

      let currentItem = null
      const handler = (_event, item) => {
        if (settled) return
        currentItem = item
        const file = path.join(saveDir, item.getFilename())
        item.setSavePath(file)

        item.on('updated', (_e, state) => {
          if (state === 'interrupted' || settled) return
          const percent = item.getTotalBytes()
            ? Math.round((item.getReceivedBytes() / item.getTotalBytes()) * 100)
            : 0
          onProgress({ percent, file })
        })

        item.once('done', (_e, state) => {
          finish(
            state === 'completed'
              ? { ok: true, file, fileName: item.getFilename() }
              : { ok: false, error: `下载未完成：${state}` }
          )
        })
      }

      cleanupDownload = () => session.defaultSession.removeListener('will-download', handler)
      session.defaultSession.on('will-download', handler)

      win.once('closed', () => {
        // 关掉窗口 = 用户取消；顺手取消可能还在进行的下载项
        try {
          if (currentItem && !currentItem.isDone()) currentItem.cancel()
        } catch {
          /* ignore */
        }
        finish({ ok: false, error: '下载窗口已关闭，已取消下载' })
      })

      // 在 Nexus 页面上加一条提示（用 insertCSS 避免被页面 CSP 拦）
      win.webContents.once('did-finish-load', () => {
        win.webContents
          .insertCSS(
            '#nc-modbox-tip{position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#facc15;color:#111;font:14px/1.6 "Segoe UI",sans-serif;padding:10px 40px 10px 16px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.35)}#nc-modbox-tip b{font-weight:700}'
          )
          .catch(() => {})
        win.webContents
          .executeJavaScript(
            `(() => {
              if (document.getElementById('nc-modbox-tip')) return
              const el = document.createElement('div')
              el.id = 'nc-modbox-tip'
              el.innerHTML = 'NightCity Modbox：请点击文件行的 <b>Manual</b>，在弹窗中选 <b>Slow download</b> 开始下载；下载完成后此窗口会自动关闭。'
              document.body.appendChild(el)
            })()`
          )
          .catch(() => {})
      })
    })

    if (!saved.ok) return saved
    onProgress({ percent: 100, file: saved.file })
    return { ok: true, file: saved.file, fileName: saved.fileName }
  } catch (err) {
    return { ok: false, error: (err && err.message) || '下载失败' }
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}
