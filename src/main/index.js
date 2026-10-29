import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import fs from 'fs'
import { basename, join } from 'path'
import {
  addDownloadRecord,
  addExternalDownloadRecord,
  attachArchiveToDownload,
  attachRequirementsToDownload,
  detachStagedId,
  installMod,
  loadState,
  reconcileStagingRecords,
  removeDownloadRecord,
  saveState,
  setDownloadNoticeHidden,
  setEnabled,
  toggleFavorite,
  updateDownloadSnapshot,
  uninstallMod
} from './store'
import { getKeyStatus, getPaths, setApiKey, setPaths } from './settings'
import { deploy, stopGame, detectExternalChanges, importFolder, importArchive, getGameVersion, isGameRunning, launchGame, parseGameVersionFromName, loadStaging, parseModIdFromArchiveName, preflight, readManifest, regenerateArchiveModlist, reclassifyStaged, removeStaged, redeployAll, resolveAllExternalChanges, resolveExternalChange, runRedMod, setDeployOrder, stagingRoot, toggleStaged, undeploy, migrateStagingPaths, healthCheck, autoSortLegacyOrder } from './deployer'
import { getModImages } from './nexus'
import { checkDependencies, checkModRequirements } from './dependencies'
import { collectLogs } from './logs'
import { scanConflicts } from './conflicts'
import { listDownloadRecords, listPackageFiles, attachStagedToDownload } from './library'
import { runCapture } from './screenshot'
import { translateTexts } from './translate'
import { clearLocalModel, ensureLocalModel, getLocalModelStatus } from './localTranslate'
import { getFacets, getModDetailGql, getModRequirements, getModVersions, queryMods } from './graphql'
import { checkLogin, downloadModFile, openLoginWindow, packagesDir } from './downloader'
import { runDeploySelfTest } from './selftest'
import {
  runAuthDebug,
  runDownloadDebug,
  runDownloadSelfTest,
  runPackSelfTest,
  runTranslateDownload,
  runTranslateProbe
} from './selftest-pack'

/**
 * 从终端 / 启动器运行时，父进程可能先关闭管道。
 * 此时 console.* 或 Node 警告写 stdout 会抛 EPIPE，直接把主进程打崩并弹错误框。
 * 这里把写失败全部吞掉，保证应用继续运行。
 */
function guardStdio() {
  const ignore = () => {}
  process.stdout.on('error', ignore)
  process.stderr.on('error', ignore)

  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace']
  methods.forEach((name) => {
    const original = console[name]
    if (typeof original !== 'function') return
    console[name] = (...args) => {
      try {
        original.apply(console, args)
      } catch {
        /* 管道已关闭，忽略 */
      }
    }
  })

  process.on('uncaughtException', (err) => {
    if (err && err.code === 'EPIPE') return
    try {
      console.error('[modbox] 未捕获异常：', err)
    } catch {
      /* 日志也写不出去时直接忽略 */
    }
  })
}

guardStdio()

const CAPTURE = Boolean(process.env.MODBOX_SHOT)

const devUrl = process.env['ELECTRON_RENDERER_URL']
const modWindows = new Map()
let mainWindow = null

function preloadPath() {
  return join(__dirname, '../preload/index.js')
}

function webPreferences() {
  return {
    preload: preloadPath(),
    sandbox: false,
    contextIsolation: true,
    spellcheck: false
  }
}

/** 让渲染层能感知窗口最大化状态，用于切换图标 */
function trackMaximized(win) {
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))
}

function broadcast(state) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('state:changed', state)
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: CAPTURE ? 1520 : 1320,
    height: CAPTURE ? 940 : 860,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#F2F3F5',
    title: 'NightCity Modbox',
    webPreferences: CAPTURE
      ? { ...webPreferences(), backgroundThrottling: false }
      : webPreferences()
  })

  trackMaximized(mainWindow)
  if (!CAPTURE) mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/** 打开（或聚焦）某个 MOD 的独立详情窗口 */
function openModWindow(id) {
  const opened = modWindows.get(id)
  if (opened && !opened.isDestroyed()) {
    if (opened.isMinimized()) opened.restore()
    opened.focus()
    return opened
  }

  const win = new BrowserWindow({
    width: CAPTURE ? 1180 : 1080,
    height: CAPTURE ? 900 : 880,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#F2F3F5',
    title: 'NightCity Modbox · 模组详情',
    webPreferences: CAPTURE
      ? { ...webPreferences(), backgroundThrottling: false }
      : webPreferences()
  })

  modWindows.set(id, win)
  trackMaximized(win)
  if (!CAPTURE) win.once('ready-to-show', () => win.show())
  win.on('closed', () => modWindows.delete(id))
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const hash = `/mod/${encodeURIComponent(id)}`
  if (devUrl) win.loadURL(`${devUrl}#${hash}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash })

  return win
}

function registerIpc() {
  ipcMain.handle('state:get', () => loadState())

  ipcMain.handle('state:favorite', (_event, payload) => {
    const state = toggleFavorite(typeof payload === 'object' ? payload : { id: payload })
    broadcast(state)
    return state
  })

  ipcMain.handle('settings:get', () => getKeyStatus())

  ipcMain.handle('settings:save-key', (_event, key) => {
    const status = setApiKey(key)
    return status
  })

  ipcMain.handle('mods:query', (_event, payload) => queryMods(payload || {}))

  ipcMain.handle('mods:facets', () => getFacets())

  /* ------------------------------ 部署相关 ------------------------------ */

  /**
   * staging 解析：未显式设置时默认放在游戏根目录下（保证与游戏同分区，硬链接可用）。
   * 确定游戏目录后自动创建；用户也可以手动指定其他路径。
   */
  const resolveStaging = () => {
    const paths = getPaths()
    if (paths.stagingPath) return { ...paths, resolvedStaging: paths.stagingPath, stagingIsDefault: false }
    if (paths.gamePath) {
      const dir = join(paths.gamePath, 'ModboxStaging')
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch {
        /* 目录不可写时由 preflight 报错 */
      }
      return { ...paths, resolvedStaging: dir, stagingIsDefault: true }
    }
    return { ...paths, resolvedStaging: stagingRoot(), stagingIsDefault: true }
  }

  ipcMain.handle('paths:get', () => resolveStaging())

  ipcMain.handle('paths:set', (_event, payload) => {
    setPaths(payload || {})
    return resolveStaging()
  })

  ipcMain.handle('dialog:pick-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? '' : result.filePaths[0]
  })

  ipcMain.handle('deploy:state', () => {
    const paths = resolveStaging()
    const gamePath = paths.gamePath
    const stagingPath = paths.resolvedStaging
    const staging = loadStaging()
    const manifest = readManifest()
    // 只有真正部署了 REDmod（copy 条目）时才展示 redMod 状态
    const hasRedmodCopy = manifest.entries.some((entry) => entry.linkType === 'copy')
    return {
      gamePath,
      stagingPath,
      stagingIsDefault: paths.stagingIsDefault,
      mods: staging.mods.map((mod) => ({
        ...mod,
        // 从下载文件名解析的「适配游戏版本」（用于兼容性软提醒）
        gameVersion: parseGameVersionFromName(mod.archivePath || '')
      })),
      gameVersion: getGameVersion(gamePath),
      deployed: manifest.entries,
      legacyOrder: manifest.legacyOrder || [],
      redmodOrder: manifest.redmodOrder || [],
      redmod: hasRedmodCopy ? manifest.redmod || null : null,
      changes: gamePath ? detectExternalChanges(gamePath) : [],
      dependencies: gamePath ? checkDependencies(gamePath) : { missing: [], checked: [] },
      modRequirements: { missing: checkModRequirements(gamePath) },
      preflight: gamePath ? preflight(gamePath, stagingPath) : { errors: [], warnings: [] },
      running: isGameRunning()
    }
  })

  ipcMain.handle('deploy:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择解压后的 Mod 文件夹'
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: '已取消' }
    try {
      const record = importFolder(result.filePaths[0], resolveStaging().resolvedStaging)
      attachStagedToDownload(record)
      return { ok: true, record }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('deploy:toggle', (_event, payload) =>
    toggleStaged(payload && payload.id, Boolean(payload && payload.enabled))
  )

  ipcMain.handle('deploy:reclassify', (_event, id) => reclassifyStaged(id))

  ipcMain.handle('deploy:remove', (_event, id) => {
    const data = removeStaged(id)
    // 联动：staging 被移除后，下载记录里指向它的绑定也要清掉
    detachStagedId(id)
    return data
  })

  ipcMain.handle('deploy:run', (_event, payload) => {
    const paths = resolveStaging()
    const modIds = Array.isArray(payload && payload.modIds) ? payload.modIds : null
    return deploy(paths.gamePath, paths.resolvedStaging, { onlyIds: modIds })
  })

  ipcMain.handle('deploy:undo', (_event, payload) => {
    const paths = getPaths()
    const modIds = Array.isArray(payload && payload.modIds) ? payload.modIds : null
    return undeploy(paths.gamePath, { onlyIds: modIds })
  })

  ipcMain.handle('deploy:auto-sort', () => {
    const paths = getPaths()
    return autoSortLegacyOrder(paths.gamePath)
  })

  ipcMain.handle('deploy:health', () => {
    const paths = getPaths()
    return healthCheck(paths.gamePath)
  })

  ipcMain.handle('deploy:redeploy-all', () => {
    const paths = getPaths()
    return redeployAll(paths.gamePath, paths.resolvedStaging)
  })

  ipcMain.handle('deploy:resolve-all', (_event, payload) => {
    const paths = getPaths()
    return resolveAllExternalChanges({ ...(payload || {}), gamePath: paths.gamePath })
  })

  ipcMain.handle('deploy:resolve-change', (_event, payload) => {
    const paths = getPaths()
    return resolveExternalChange({ ...(payload || {}), gamePath: paths.gamePath })
  })

  ipcMain.handle('deploy:changes', () => {
    const paths = getPaths()
    return detectExternalChanges(paths.gamePath)
  })

  ipcMain.handle('deploy:order', (_event, payload) => {
    const paths = getPaths()
    return setDeployOrder({ ...(payload || {}), gamePath: paths.gamePath })
  })

  ipcMain.handle('mods:check-updates', async () => {
    const state = loadState()
    const records = state.downloads.filter((record) => record.modId)
    if (!records.length) return { items: [], error: '' }
    const result = await getModVersions(records.map((record) => record.modId))
    if (result.error) return { items: [], error: result.error }
    const byId = new Map(result.items.map((item) => [item.modId, item]))
    return {
      items: records.map((record) => {
        const latest = byId.get(Number(record.modId))
        const local = record.version || ''
        const remote = latest ? latest.version : ''
        return {
          recordId: record.recordId,
          modId: record.modId,
          name: record.name,
          localVersion: local,
          latestVersion: remote,
          latestUpdatedAt: latest ? latest.updatedAt : '',
          // 本地版本未知时无法比较，只有版本明确不同才算可更新
          hasUpdate: Boolean(remote && local && remote !== local),
          versionUnknown: Boolean(remote && !local)
        }
      }),
      error: ''
    }
  })

  ipcMain.handle('download:add', (_event, item) => addDownloadRecord(item))

  ipcMain.handle('download:list', () => listDownloadRecords())

  ipcMain.handle('download:attach', async (event, recordId) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      title: '选择下载的压缩包（.zip）',
      properties: ['openFile'],
      filters: [{ name: 'Mod 压缩包', extensions: ['zip'] }]
    })
    const zipPath = result.canceled ? '' : result.filePaths[0]
    if (!zipPath) return { ok: false, error: '已取消' }
    try {
      const paths = resolveStaging()
      const staged = importArchive(zipPath, paths.resolvedStaging)
      attachArchiveToDownload({ recordId, archivePath: zipPath, stagedId: staged.id })
      return { ok: true, staged }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('download:remove', (_event, recordId) => {
    const saved = loadState()
    const record = saved.downloads.find((entry) => entry.recordId === recordId)
    // 联动：下载记录绑定了 staging Mod 时，删除记录要把 staging 一起移除（已部署的先撤销）
    if (record && record.stagedId) {
      const manifest = readManifest()
      const deployed = manifest.entries.some((entry) => entry.stagedModId === record.stagedId)
      if (deployed) {
        if (isGameRunning()) {
          return { ok: false, error: '游戏正在运行，无法撤销部署；请先退出游戏再删除该记录' }
        }
        undeploy(getPaths().gamePath, { onlyIds: [record.stagedId] })
      }
      removeStaged(record.stagedId)
    }
    removeDownloadRecord(recordId)
    return { ok: true }
  })

  ipcMain.handle('download:hide-notice', (_event, hidden) => setDownloadNoticeHidden(hidden))

  /* ------------------------------ 下载历史 ------------------------------ */

  ipcMain.handle('history:list', () => listPackageFiles())

  ipcMain.handle('history:open', (_event, filePath) => {
    shell.showItemInFolder(filePath)
    return true
  })

  ipcMain.handle('history:extract', async (_event, filePath) => {
    const paths = resolveStaging()
    const staged = importArchive(filePath, paths.resolvedStaging)
    const saved = loadState()
    const record = saved.downloads.find((entry) => entry.archivePath === filePath)
    if (record) {
      attachArchiveToDownload({ recordId: record.recordId, archivePath: filePath, stagedId: staged.id })
    } else {
      // 直接从下载历史解压：按文件名解析 Nexus 模组 ID，尽量把封面/简介/标签一起补全
      let meta = null
      const modId = parseModIdFromArchiveName(basename(filePath))
      if (modId) {
        try {
          const detail = await getModDetailGql(modId)
          if (detail && detail.item) meta = detail.item
        } catch {
          /* 网络失败就只存文件名 */
        }
      }
      addExternalDownloadRecord({
        name: meta ? meta.name : basename(filePath).replace(/\.[^.]+$/, ''),
        archivePath: filePath,
        stagedId: staged.id,
        meta
      })
    }
    broadcast(loadState())
    return { ok: true, staged }
  })

  ipcMain.handle('history:delete', (_event, filePath) => {
    fs.rmSync(filePath, { force: true })
    return true
  })

  ipcMain.handle('auth:login', () => {
    openLoginWindow()
    return true
  })

  ipcMain.handle('auth:status', () => checkLogin())

  ipcMain.handle('download:nexus', async (_event, item) => {
    const send = (payload) =>
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('download:progress', payload)
      })

    // 下载历史只应反映真实落盘的包体：先记录原来有没有，取消/失败时回滚
    const hadRecord = loadState().downloads.some((entry) => entry.modId === Number(item && item.id))
    const state = addDownloadRecord(item)
    const record = state.downloads.find((entry) => entry.modId === Number(item && item.id))
    if (!record) return { ok: false, error: '登记下载记录失败' }

    // 调用方只给了 id / name（例如从依赖面板一键下载）时，补查详情快照，
    // 保证包体记录也能显示封面 / 简介 / 标签 / 版本
    if (!item || !item.picture) {
      try {
        const detail = await getModDetailGql(record.modId)
        if (detail && detail.item) updateDownloadSnapshot(record.recordId, detail.item)
      } catch {
        /* 查不到就保持最简信息 */
      }
    }

    send({ modId: record.modId, percent: 0, phase: '准备下载' })

    const download = await downloadModFile(record.modId, (progress) =>
      send({ modId: record.modId, percent: progress.percent, phase: '下载中' })
    )

    if (!download.ok) {
      // 用户关掉下载窗口 / 下载失败：没有真实落盘的包体就不该留下记录（除非之前就有）
      if (!hadRecord) removeDownloadRecord(record.recordId)
      send({ modId: record.modId, percent: 0, phase: '', error: download.error, done: true })
      return download
    }

    let staged = null
    if (/\.zip$/i.test(download.file || '')) {
      try {
        // 统一走 resolveStaging：默认落到 <游戏目录>/ModboxStaging，保证与游戏同分区可硬链接
        const paths = resolveStaging()
        staged = importArchive(download.file, paths.resolvedStaging)
        attachArchiveToDownload({
          recordId: record.recordId,
          archivePath: download.file,
          stagedId: staged.id
        })
      } catch (err) {
        attachArchiveToDownload({ recordId: record.recordId, archivePath: download.file, stagedId: '' })
        send({
          modId: record.modId,
          percent: 100,
          phase: `下载完成，解压失败：${err.message}`,
          done: true
        })
        broadcast(loadState())
        return { ok: true, file: download.file, staged: null }
      }
    } else {
      attachArchiveToDownload({ recordId: record.recordId, archivePath: download.file, stagedId: '' })
    }

    // 抓取该模组在 Nexus 上登记的前置依赖，供部署页检查
    try {
      const requirementInfo = await getModRequirements(record.modId)
      if (requirementInfo && Array.isArray(requirementInfo.requirements)) {
        attachRequirementsToDownload(record.recordId, requirementInfo.requirements)
      }
    } catch {
      /* 前置信息抓取失败不影响下载 */
    }

    send({ modId: record.modId, percent: 100, phase: '完成', done: true })
    broadcast(loadState())
    return { ok: true, file: download.file, staged }
  })

  ipcMain.handle('download:update', async (_event, recordId) => {
    const saved = loadState()
    const record = saved.downloads.find((entry) => entry.recordId === recordId)
    if (!record) return { ok: false, error: '找不到该下载记录' }
    if (!record.modId) return { ok: false, error: '这条记录没有 Nexus 模组 ID，无法检查更新' }

    const send = (payload) =>
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('download:progress', payload)
      })
    send({ modId: record.modId, percent: 0, phase: '检查更新并下载' })

    const download = await downloadModFile(record.modId, (progress) =>
      send({ modId: record.modId, percent: progress.percent, phase: '下载更新中' })
    )
    if (!download.ok) {
      send({ modId: record.modId, percent: 0, phase: '', error: download.error, done: true })
      return download
    }

    const paths = resolveStaging()
    const oldStagedId = record.stagedId
    let wasDeployed = false
    try {
      if (oldStagedId) {
        wasDeployed = readManifest().entries.some((entry) => entry.stagedModId === oldStagedId)
        if (wasDeployed) {
          const undo = undeploy(paths.gamePath, { onlyIds: [oldStagedId] })
          if (!undo.ok) {
            return { ok: false, error: '旧版本撤销部署失败，已停止更新（文件已下载）' }
          }
        }
        removeStaged(oldStagedId)
      }

      const staged = importArchive(download.file, paths.resolvedStaging)
      let redeployed = false
      if (wasDeployed) {
        const result = deploy(paths.gamePath, paths.resolvedStaging, { onlyIds: [staged.id] })
        redeployed = Boolean(result && result.ok)
        if (!redeployed) {
          attachArchiveToDownload({ recordId, archivePath: download.file, stagedId: staged.id })
          broadcast(loadState())
          return {
            ok: false,
            error: `新版本已解压但重新部署失败：${(result.errors || []).join('；')}`,
            staged
          }
        }
      }

      attachArchiveToDownload({ recordId, archivePath: download.file, stagedId: staged.id })
      try {
        const detail = await getModDetailGql(record.modId)
        if (detail && detail.item) updateDownloadSnapshot(recordId, detail.item)
      } catch {
        /* ignore */
      }
      broadcast(loadState())
      send({ modId: record.modId, percent: 100, phase: '更新完成', done: true })
      return { ok: true, staged, redeployed }
    } catch (err) {
      return { ok: false, error: (err && err.message) || '更新失败' }
    }
  })

  ipcMain.handle('download:extract', (_event, recordId) => {
    const state = loadState()
    const record = state.downloads.find((entry) => entry.recordId === recordId)
    if (!record || !record.archivePath) return { ok: false, error: '没有可解压的包体' }
    try {
      const paths = resolveStaging()
      const staged = importArchive(record.archivePath, paths.resolvedStaging)
      attachArchiveToDownload({ recordId, archivePath: record.archivePath, stagedId: staged.id })
      broadcast(loadState())
      return { ok: true, staged }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('deploy:redmod', () => {
    const paths = getPaths()
    return runRedMod(paths.gamePath)
  })

  ipcMain.handle('deploy:modlist', () => {
    const paths = getPaths()
    return regenerateArchiveModlist(paths.gamePath)
  })

  ipcMain.handle('game:launch', () => {
    const paths = getPaths()
    return launchGame(paths.gamePath)
  })

  ipcMain.handle('game:status', () => ({ running: isGameRunning() }))

  ipcMain.handle('game:stop', () => stopGame())

  ipcMain.handle('logs:collect', (_event, payload) => {
    const paths = getPaths()
    return collectLogs(paths.gamePath, payload || {})
  })

  ipcMain.handle('conflicts:scan', () => {
    const paths = getPaths()
    return scanConflicts(paths.gamePath)
  })

  ipcMain.handle('mod:detail', async (_event, id) => getModDetailGql(id))

  ipcMain.handle('mod:images', (_event, id) => getModImages(id))

  ipcMain.handle('translate:status', () => getLocalModelStatus())

  ipcMain.handle('translate:prepare', () => ensureLocalModel())

  ipcMain.handle('translate:clear', () => clearLocalModel())

  ipcMain.handle('translate:batch', (_event, payload) =>
    translateTexts(payload && payload.texts, (payload && payload.target) || 'zh-CN')
  )

  ipcMain.handle('state:install', (_event, payload) => {
    const state = installMod(payload)
    broadcast(state)
    return state
  })

  ipcMain.handle('state:uninstall', (_event, id) => {
    const state = uninstallMod(id)
    broadcast(state)
    return state
  })

  ipcMain.handle('state:set-enabled', (_event, payload) => {
    const state = setEnabled(payload)
    broadcast(state)
    return state
  })

  ipcMain.handle('window:open-mod', (_event, id) => {
    openModWindow(id)
    return true
  })

  const fromEvent = (event) => BrowserWindow.fromWebContents(event.sender)

  ipcMain.handle('window:minimize', (event) => fromEvent(event)?.minimize())
  ipcMain.handle('window:close', (event) => fromEvent(event)?.close())
  ipcMain.handle('window:is-maximized', (event) => !!fromEvent(event)?.isMaximized())
  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = fromEvent(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle('shell:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
  })
}

app.whenReady().then(() => {
    try {
      const migrated = migrateStagingPaths()
      if (migrated > 0) console.log('[modbox] 已迁移', migrated, '个旧 staging 记录路径')
    } catch (err) {
      console.error('[modbox] staging 迁移失败', err)
    }
  app.setAppUserModelId('com.nightcity.modbox')
  try {
    reconcileStagingRecords()
  } catch (err) {
    console.error('[modbox] 包体记录补偿失败：', err)
  }

  // 后台补全下载记录缺失的信息（封面 / 简介 / 标签 / 前置）：每次启动检查缺失项，没缺就不查
  setTimeout(async () => {
    try {
      const targets = loadState().downloads.filter(
        (item) => item.modId && (!item.picture || !item.summary || !Array.isArray(item.requirements))
      )
      if (!targets.length) return
      for (const record of targets) {
        try {
          if (!record.picture || !record.summary) {
            const detail = await getModDetailGql(record.modId)
            if (detail && detail.item) updateDownloadSnapshot(record.recordId, detail.item)
          }
          if (!Array.isArray(record.requirements)) {
            const requirementInfo = await getModRequirements(record.modId)
            if (requirementInfo && Array.isArray(requirementInfo.requirements)) {
              attachRequirementsToDownload(record.recordId, requirementInfo.requirements)
            }
          }
        } catch {
          /* 单条失败继续 */
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      broadcast(loadState())
    } catch (err) {
      console.error('[modbox] 下载记录信息补全失败：', err)
    }
  }, 5000)



  // 主窗口是自绘标题栏，登录等辅助窗口也不需要 Electron 默认菜单（File/Edit/View…）
  Menu.setApplicationMenu(null)

  // 程序内所有下载统一落到「包体记录」目录：
  // 设置 session 默认保存路径 + 全局 will-download 兜底，避免 Chromium 弹系统「另存为」对话框
  try {
    const downloadDir = packagesDir()
    fs.mkdirSync(downloadDir, { recursive: true })
    session.defaultSession.setDownloadPath(downloadDir)
  } catch (err) {
    console.error('[modbox] 设置默认下载目录失败：', err)
  }

  session.defaultSession.on('will-download', (_event, item) => {
    if (item.getSavePath()) return
    try {
      const downloadDir = packagesDir()
      fs.mkdirSync(downloadDir, { recursive: true })
      item.setSavePath(join(downloadDir, item.getFilename()))
    } catch (err) {
      console.error('[modbox] 接管下载失败：', err)
    }
  })
  registerIpc()
  createMainWindow()

  if (process.env.MODBOX_DEPLOY_TEST) {
    runDeploySelfTest()
    setTimeout(() => app.quit(), 800)
  }

  if (process.env.MODBOX_PACK_TEST) {
    runPackSelfTest()
    setTimeout(() => app.quit(), 1200)
  }

  if (process.env.MODBOX_TRANSLATE_DOWNLOAD) {
    runTranslateDownload().finally(() => setTimeout(() => app.quit(), 1500))
  }

  if (process.env.MODBOX_TRANSLATE_PROBE) {
    runTranslateProbe().finally(() => setTimeout(() => app.quit(), 1500))
  }

  if (process.env.MODBOX_AUTH_DEBUG) {
    runAuthDebug().finally(() => setTimeout(() => app.quit(), 1200))
  }

  if (process.env.MODBOX_DOWNLOAD_DEBUG) {
    runDownloadDebug(Number(process.env.MODBOX_DOWNLOAD_DEBUG)).finally(() =>
      setTimeout(() => app.quit(), 1200)
    )
  }

  if (process.env.MODBOX_DOWNLOAD_TEST) {
    runDownloadSelfTest(Number(process.env.MODBOX_DOWNLOAD_TEST)).finally(() =>
      setTimeout(() => app.quit(), 1200)
    )
  }

  if (CAPTURE) runCapture({ mainWindow, openModWindow, resolveModId: () => 4198 })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
