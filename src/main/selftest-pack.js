/**
 * 包体状态 / 真实下载自检（仅开发用）。
 *
 *  MODBOX_PACK_TEST=1        → 跑包体状态识别自检
 *  MODBOX_DOWNLOAD_TEST=<id> → 对指定 mod 跑一次真实下载链路（登录 → Slow download → 落盘 → 解压）
 *
 * 两个模式都会把结果写到 userData 下的日志，并在 app 退出前完成清理。
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { downloadModFile, packagesDir } from './downloader'
import { importArchive, loadStaging, removeStaged, stagingRoot } from './deployer'
import { listDownloadRecords, listPackageFiles } from './library'
import { loadState, saveState } from './store'

function logPath(name) {
  return path.join(app.getPath('userData'), name)
}

function writeReport(file, lines) {
  try {
    fs.writeFileSync(file, lines.join('\n'), 'utf8')
  } catch {
    /* ignore */
  }
}

/* ------------------------------ 包体状态识别 ------------------------------ */

export function runPackSelfTest() {
  const lines = []
  const log = (line) => lines.push(line)
  const stateFile = path.join(app.getPath('userData'), 'modbox-state.json')
  const stagingFile = path.join(app.getPath('userData'), 'staging.json')
  const stateBackup = fs.existsSync(stateFile) ? fs.readFileSync(stateFile) : null
  const stagingBackup = fs.existsSync(stagingFile) ? fs.readFileSync(stagingFile) : null
  const createdFiles = []
  const createdDirs = []

  try {
    const pkgDir = packagesDir()
    fs.mkdirSync(pkgDir, { recursive: true })

    /* 1) 造一个含 legacy archive 的 zip */
    const zipPath = path.join(pkgDir, 'selftest-pack.zip')
    const tmpSrc = path.join(app.getPath('temp'), 'modbox-pack-src')
    fs.rmSync(tmpSrc, { recursive: true, force: true })
    fs.mkdirSync(tmpSrc, { recursive: true })
    fs.writeFileSync(path.join(tmpSrc, 'SelftestPack.archive'), 'archive-bytes')
    fs.writeFileSync(path.join(tmpSrc, 'config.xl'), 'xl-bytes')
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path "${tmpSrc}\\*" -DestinationPath "${zipPath}" -Force`],
      { windowsHide: true, timeout: 60000 }
    )
    createdFiles.push(zipPath)
    log(`zip: exists=${fs.existsSync(zipPath)} size=${fs.existsSync(zipPath) ? fs.statSync(zipPath).size : -1}`)

    /* 2) 构造三种记录：已预留 / 未预留 / 失效 stagedId */
    const state = loadState()
    saveState({
      favorites: state.favorites,
      installed: state.installed,
      downloads: [
        { recordId: 'test-kept', modId: 900001, name: 'Selftest Kept', pageUrl: '', archivePath: zipPath, stagedId: '', addedAt: Date.now() },
        { recordId: 'test-missing', modId: 900002, name: 'Selftest Missing', pageUrl: '', archivePath: path.join('Z:', 'no', 'such', 'file.zip'), stagedId: '', addedAt: Date.now() },
        { recordId: 'test-stale', modId: 900003, name: 'Selftest Stale', pageUrl: '', archivePath: '', stagedId: 'nonexistent-staged-id', addedAt: Date.now() }
      ],
      hideDownloadNotice: false,
      downloadsMigrated: true,
      known: state.known
    })

    /* 3) 已预留 / 未预留 / 失效绑定 */
    let data = listDownloadRecords()
    const byId = new Map(data.records.map((record) => [record.recordId, record]))
    log(`kept.archiveExists=${byId.get('test-kept').archiveExists} (expect true)`)
    log(`missing.archiveExists=${byId.get('test-missing').archiveExists} (expect false)`)
    log(`stale.stagedId=${JSON.stringify(byId.get('test-stale').stagedId)} (expect "")`)

    /* 4) 包体目录扫描 + 记录关联 */
    let history = listPackageFiles()
    const seen = history.files.find((file) => file.name === 'selftest-pack.zip')
    log(`history: sees=${Boolean(seen)} mod=${seen ? seen.mod : ''} (expect Selftest Kept)`)
    log(`history: dirExists=${fs.existsSync(pkgDir)}`)

    /* 5) 解压进 staging → 绑定记录 → 派生字段 */
    const staged = importArchive(zipPath, stagingRoot())
    createdDirs.push(staged.dir)
    log(`import: types=${staged.types.join('+')} unclassified=${staged.unclassified} files=${staged.files.length}`)
    log(`import: enabled=${staged.enabled} (expect true)`)

    const afterImport = listDownloadRecords().records.map((record) =>
      record.recordId === 'test-kept' ? { ...record, stagedId: staged.id } : record
    )
    saveState({
      favorites: state.favorites,
      installed: state.installed,
      downloads: afterImport,
      hideDownloadNotice: false,
      downloadsMigrated: true,
      known: state.known
    })
    data = listDownloadRecords()
    const kept = data.records.find((record) => record.recordId === 'test-kept')
    log(`kept.stagedIdValid=${kept.stagedId === staged.id} (expect true)`)
    log(`kept.deployed=${kept.deployed} (expect false，尚未部署)`)
    history = listPackageFiles()
    const seenAfter = history.files.find((file) => file.name === 'selftest-pack.zip')
    log(`history.stagedId=${Boolean(seenAfter && seenAfter.stagedId)} (expect true)`)

    /* 6) staging 被移除后，绑定应失效 */
    removeStaged(staged.id)
    data = listDownloadRecords()
    log(`afterRemove.stagedId=${JSON.stringify(data.records.find((r) => r.recordId === 'test-kept').stagedId)} (expect "")`)
    history = listPackageFiles()
    log(`afterRemove.historyStagedId=${JSON.stringify(history.files.find((f) => f.name === 'selftest-pack.zip').stagedId)} (expect "")`)

    /* 7) 未绑定包体的记录不应崩 */
    const bare = data.records.find((record) => record.recordId === 'test-stale')
    log(`bare.archivePath=${JSON.stringify(bare.archivePath)} archiveExists=${bare.archiveExists}`)
  } catch (err) {
    log(`ERROR: ${err && err.stack}`)
  } finally {
    try {
      if (stateBackup) fs.writeFileSync(stateFile, stateBackup)
      else fs.rmSync(stateFile, { force: true })
    } catch {
      /* ignore */
    }
    try {
      if (stagingBackup) fs.writeFileSync(stagingFile, stagingBackup)
      else fs.rmSync(stagingFile, { force: true })
    } catch {
      /* ignore */
    }
    createdFiles.forEach((file) => {
      try {
        fs.rmSync(file, { force: true })
      } catch {
        /* ignore */
      }
    })
    createdDirs.forEach((dir) => {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    })
    writeReport(logPath('pack-selftest.log'), lines)
  }
}

/* ------------------------------ 真实下载链路 ------------------------------ */

export async function runDownloadSelfTest(modId) {
  const lines = []
  const log = (line) => {
    lines.push(line)
    writeReport(logPath('download-selftest.log'), lines)
  }
  const created = []
  try {
    log(`start modId=${modId} at=${new Date().toISOString()}`)
    const result = await downloadModFile(modId, (progress) => log(`progress: ${progress.percent}%`))
    log(`result.ok=${result.ok} file=${result.file || ''} error=${result.error || ''}`)

    if (result.ok && result.file && fs.existsSync(result.file)) {
      const stat = fs.statSync(result.file)
      created.push(result.file)
      log(`file.size=${stat.size}`)
      if (/\.zip$/i.test(result.file)) {
        const staged = importArchive(result.file, stagingRoot())
        log(`unzip: types=${staged.types.join('+')} unclassified=${staged.unclassified} files=${staged.files.length}`)
        removeStaged(staged.id)
        log('unzip: staged record cleaned up')
      }
    }
  } catch (err) {
    log(`ERROR: ${err && err.stack}`)
  } finally {
    created.forEach((file) => {
      try {
        fs.rmSync(file, { force: true })
      } catch {
        /* ignore */
      }
    })
    log(`done at=${new Date().toISOString()}`)
  }
}

/* ------------------------------ 下载页诊断 ------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function runDownloadDebug(modId) {
  const lines = []
  const log = (line) => {
    lines.push(line)
    writeReport(logPath('download-debug.log'), lines)
  }
  const { BrowserWindow, session } = await import('electron')
  let win = null
  try {
    // 放宽 Nexus 页面 CSP：允许 blob: 脚本（下载弹窗依赖它）
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['https://www.nexusmods.com/*', 'https://users.nexusmods.com/*'] },
      (details, callback) => {
        const headers = details.responseHeaders || {}
        Object.keys(headers).forEach((key) => {
          if (key.toLowerCase() === 'content-security-policy') {
            headers[key] = headers[key].map((value) =>
              String(value).replace(/script-src([^;]*)/i, (match) => match + ' blob:')
            )
          }
        })
        callback({ responseHeaders: headers })
      }
    )

    win = new BrowserWindow({ show: true, x: 80, y: 60, skipTaskbar: true, width: 1440, height: 1000 })
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) log('console[' + level + ']: ' + String(message).slice(0, 200))
    })
    await win.loadURL(`https://www.nexusmods.com/cyberpunk2077/mods/${modId}?tab=files`).catch((err) => log('loadURL err ' + (err && err.message)))
    await sleep(9000)
    win.focus()

    const rect = await win.webContents
      .executeJavaScript(
        `(() => {
          const el = document.querySelector('mod-download-modal')
          const sr = el && el.shadowRoot
          const btn = sr ? [...sr.querySelectorAll('button')].find((b) => /manual/i.test(b.textContent || '')) : null
          if (!btn) return null
          const r = btn.getBoundingClientRect()
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        })()`
      )
      .catch(() => null)
    log('rect=' + JSON.stringify(rect))
    if (!rect) return

    const dbg = win.webContents.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
    await sleep(150)
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    await sleep(90)
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    log('clicked')
    await sleep(6000)

    const state = await win.webContents
      .executeJavaScript(
        `(() => {
          const sr = document.querySelector('mod-download-modal') && document.querySelector('mod-download-modal').shadowRoot
          const floating = sr ? sr.querySelector('#floating-ui-root') : null
          const clean = (html) => {
            const box = document.createElement('div')
            box.innerHTML = html
            box.querySelectorAll('style').forEach((x) => x.remove())
            return box.innerHTML
          }
          const slow = [...document.querySelectorAll('a,button,div')]
            .filter((el) => el.children.length === 0 && /slow download|slow/i.test(el.textContent || ''))
            .slice(0, 6)
            .map((el) => ({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 60), cls: String(el.className || '').slice(0, 80) }))
          return {
            floatingLen: floating ? floating.innerHTML.length : -1,
            floatingHtml: floating ? clean(floating.innerHTML).slice(0, 3000) : '',
            slowCandidates: slow,
            bodyTail: document.body.innerText.slice(-600)
          }
        })()`
      )
      .catch((err) => ({ err: String(err && err.message) }))
    log('state=' + JSON.stringify(state, null, 1).slice(0, 6000))
  } catch (err) {
    log(`ERROR: ${err && err.stack}`)
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}

/* ------------------------------ 登录态判定探针 ------------------------------ */

export async function runAuthDebug() {
  const lines = []
  const log = (line) => {
    lines.push(line)
    writeReport(logPath('auth-debug.log'), lines)
  }
  const { BrowserWindow } = await import('electron')
  const probes = [
    ['users-profile', 'https://users.nexusmods.com/account/profile'],
    ['users-root', 'https://users.nexusmods.com/'],
    ['myaccount', 'https://www.nexusmods.com/users/myaccount'],
    ['files-tab', 'https://www.nexusmods.com/cyberpunk2077/mods/3518?tab=files']
  ]
  for (const [label, url] of probes) {
    let win = null
    try {
      win = new BrowserWindow({ show: false, skipTaskbar: true, width: 1200, height: 900 })
      await win.loadURL(url).catch((err) => log(`[${label}] load err ${err && err.message}`))
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const info = await win.webContents
        .executeJavaScript(
          `(() => {
            const text = document.body ? document.body.innerText : ''
            return {
              finalUrl: location.href,
              title: document.title,
              signOut: /Sign out/i.test(text),
              needLogin: /You have to be logged in|You need to be logged in/i.test(text),
              slowDownload: /Slow download/i.test(text),
              loginButton: !!document.querySelector('a[href*="signin"], a[href*="login"]')
            }
          })()`
        )
        .catch((err) => ({ err: String(err && err.message) }))
      log(`=== [${label}] ${url}`)
      log(JSON.stringify(info))
    } catch (err) {
      log(`[${label}] ERROR ${err && err.stack}`)
    } finally {
      if (win && !win.isDestroyed()) win.destroy()
    }
  }
}

/* ------------------------------ 本地翻译探针 ------------------------------ */

export async function runTranslateProbe() {
  const lines = []
  const log = (line) => {
    lines.push(line)
    writeReport(logPath('translate-probe.log'), lines)
  }
  try {
    const lib = await import('@huggingface/transformers')
    log('import ok: pipeline=' + typeof lib.pipeline + ' env=' + typeof lib.env)
    const mod = await import('./localTranslate')
    log('status: ' + JSON.stringify(mod.getLocalModelStatus()))
    log('isReady: ' + mod.isLocalReady())
  } catch (err) {
    log('ERROR: ' + (err && err.stack))
  }
}

/* ------------------------------ 本地翻译模型下载 ------------------------------ */

export async function runTranslateDownload() {
  const file = logPath('translate-download.log')
  const lines = []
  const log = (line) => {
    lines.push(line)
    writeReport(file, lines.slice(-300))
  }
  try {
    const mod = await import('./localTranslate')
    log('start at ' + new Date().toISOString())
    const timer = setInterval(() => {
      const st = mod.getLocalModelStatus()
      log(
        `progress=${st.progress}% loading=${st.loading} ready=${st.ready} mirror=${st.mirror || ''} error=${st.error || ''}`
      )
    }, 5000)
    const result = await mod.ensureLocalModel()
    clearInterval(timer)
    log('load result: ' + JSON.stringify(result.status))
    if (result.ok) {
      const startedAt = Date.now()
      const test = await mod.translateWithLocal(
        [
          'Scripting framework for modders and quality of life fixes.',
          'This mod adds a new vehicle to the game.'
        ],
        'zh-CN'
      )
      log(`translate (${Date.now() - startedAt}ms): ` + JSON.stringify(test))
    }
  } catch (err) {
    log('ERROR: ' + (err && err.stack))
  }
}
