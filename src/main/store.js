import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { loadStaging } from './deployer'

/**
 * 本地状态：收藏 / 已安装 / 已认识的模组快照（用于离线渲染收藏与已安装列表）。
 */
const DEFAULTS = {
  favorites: [],
  installed: [],
  downloads: [],
  known: {},
  hideDownloadNotice: false,
  stagingReconciled: false,
  snapshotBackfilled: false,
  requirementsBackfilled: false
}

let cache = null

function stateFile() {
  return path.join(app.getPath('userData'), 'modbox-state.json')
}

export function loadState() {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    cache = {
      favorites: Array.isArray(raw.favorites)
        ? raw.favorites.map(Number).filter((id) => Number.isFinite(id) && id > 0)
        : [],
      installed: Array.isArray(raw.installed)
        ? raw.installed
            .map((entry) => ({ ...entry, id: Number(entry.id) }))
            .filter((entry) => Number.isFinite(entry.id) && entry.id > 0)
        : [],
      downloads: Array.isArray(raw.downloads) ? raw.downloads : [],
      hideDownloadNotice: Boolean(raw.hideDownloadNotice),
      downloadsMigrated: Boolean(raw.downloadsMigrated),
      stagingReconciled: Boolean(raw.stagingReconciled),
      snapshotBackfilled: Boolean(raw.snapshotBackfilled),
      requirementsBackfilled: Boolean(raw.requirementsBackfilled),
      known: raw.known && typeof raw.known === 'object' ? raw.known : {}
    }
  } catch {
    cache = JSON.parse(JSON.stringify(DEFAULTS))
    persist(cache)
  }
  // 一次性迁移：旧的「模拟下载」记录转为包体记录（未预留包体），只跑一次
  if (!cache.downloadsMigrated && cache.installed.length) {
    const existing = new Set(cache.downloads.map((record) => record.modId))
    const migrated = cache.installed
      .filter((entry) => !existing.has(entry.id))
      .map((entry) => {
        const known = cache.known[entry.id] || {}
        return {
          recordId: `m-${entry.id}`,
          modId: entry.id,
          name: known.name || `模组 #${entry.id}`,
          pageUrl: known.pageUrl || '',
          archivePath: '',
          stagedId: '',
          addedAt: entry.installedAt || Date.now(),
          migrated: true
        }
      })
    if (migrated.length) cache.downloads = [...migrated, ...cache.downloads]
    cache.downloadsMigrated = true
    persist(cache)
  }

  return cache
}

function persist(state) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('[modbox] 状态写入失败：', err)
  }
  return state
}

export function saveState(next) {
  cache = {
    favorites: Array.isArray(next.favorites) ? next.favorites : [],
    installed: Array.isArray(next.installed) ? next.installed : [],
    downloads: Array.isArray(next.downloads) ? next.downloads : [],
    hideDownloadNotice: Boolean(next.hideDownloadNotice),
    downloadsMigrated: Boolean(next.downloadsMigrated),
    stagingReconciled: Boolean(next.stagingReconciled),
    snapshotBackfilled: Boolean(next.snapshotBackfilled),
    requirementsBackfilled: Boolean(next.requirementsBackfilled),
    known: next.known && typeof next.known === 'object' ? next.known : {}
  }
  return persist(cache)
}

/* ------------------------------ 下载记录 ------------------------------ */

let downloadSeq = 0

/** 点「下载」时登记一条记录（包体由用户在浏览器下载） */
export function addDownloadRecord(item) {
  const state = loadState()
  const modId = Number(item && item.id)

  // 把列表/详情里的展示信息一起存下来，供「包体记录」页直接渲染（封面/简介/标签/版本）
  const snapshot = {
    name: (item && item.name) || `模组 #${modId}`,
    pageUrl: (item && item.pageUrl) || '',
    version: (item && item.version) || '',
    author: (item && item.author) || '',
    category: (item && item.category) || '',
    summary: (item && item.summary) || '',
    updated: (item && item.updated) || '',
    picture: (item && item.picture) || '',
    tags: Array.isArray(item && item.tags) ? item.tags.slice(0, 10) : []
  }

  const existing = state.downloads.find((record) => record.modId === modId)
  if (existing) {
    // 重复下载：只刷新展示快照，保留已有的 archivePath / stagedId
    return saveState({
      ...state,
      downloads: state.downloads.map((record) =>
        record.modId === modId ? { ...record, ...snapshot } : record
      )
    })
  }

  const record = {
    recordId: `d-${modId}-${Date.now().toString(36)}-${(downloadSeq += 1)}`,
    modId,
    ...snapshot,
    archivePath: '',
    stagedId: '',
    addedAt: Date.now()
  }
  return saveState({ ...state, downloads: [record, ...state.downloads] })
}

export function attachArchiveToDownload({ recordId, archivePath, stagedId }) {
  const state = loadState()
  return saveState({
    ...state,
    downloads: state.downloads.map((record) =>
      record.recordId === recordId ? { ...record, archivePath, stagedId } : record
    )
  })
}

/**
 * 一次性补偿：历史版本里 staging 已解压但没生成包体记录的条目，补上记录（只跑一次）
 */
export function reconcileStagingRecords() {
  const state = loadState()
  if (state.stagingReconciled) return state
  let staging = []
  try {
    staging = loadStaging().mods
  } catch {
    staging = []
  }
  const knownPaths = new Set(state.downloads.map((record) => record.archivePath).filter(Boolean))
  const next = [...state.downloads]
  staging.forEach((mod) => {
    if (!mod.archivePath || knownPaths.has(mod.archivePath)) return
    knownPaths.add(mod.archivePath)
    next.unshift({
      recordId: `h-${Date.now().toString(36)}-${next.length}`,
      modId: 0,
      name: mod.name,
      pageUrl: '',
      archivePath: mod.archivePath,
      stagedId: mod.id,
      addedAt: Date.now()
    })
  })
  return saveState({ ...state, downloads: next, stagingReconciled: true })
}

/**
 * 从下载历史直接解压的包体没有下载记录：补一条，让它出现在「包体记录」页
 * （modId 记为 0，不参与按模组 ID 的查询）
 */
export function addExternalDownloadRecord({ name, archivePath, stagedId, meta } = {}) {
  const state = loadState()
  const info = meta || {}
  const record = {
    recordId: `h-${Date.now().toString(36)}`,
    modId: Number(info.id) || 0,
    name: info.name || name || path.basename(archivePath || 'mod'),
    pageUrl: info.pageUrl || '',
    version: info.version || '',
    author: info.author || '',
    category: info.category || '',
    summary: info.summary || '',
    updated: info.updated || '',
    picture: info.picture || '',
    tags: Array.isArray(info.tags) ? info.tags.slice(0, 10) : [],
    archivePath: archivePath || '',
    stagedId: stagedId || '',
    addedAt: Date.now()
  }
  return saveState({ ...state, downloads: [record, ...state.downloads] })
}

/** 保存某条下载记录的 Nexus 前置依赖列表 */
export function attachRequirementsToDownload(recordId, requirements) {
  const state = loadState()
  return saveState({
    ...state,
    downloads: state.downloads.map((record) =>
      record.recordId === recordId
        ? { ...record, requirements: Array.isArray(requirements) ? requirements : [] }
        : record
    )
  })
}

/** 用 Nexus 详情补全/刷新某条下载记录的展示快照 */
export function updateDownloadSnapshot(recordId, meta) {
  if (!meta) return loadState()
  const state = loadState()
  return saveState({
    ...state,
    downloads: state.downloads.map((record) =>
      record.recordId === recordId
        ? {
            ...record,
            modId: record.modId || Number(meta.id) || 0,
            name: meta.name || record.name,
            pageUrl: meta.pageUrl || record.pageUrl,
            version: meta.version || record.version,
            author: meta.author || record.author,
            category: meta.category || record.category,
            summary: meta.summary || record.summary,
            updated: meta.updated || record.updated,
            picture: meta.picture || record.picture,
            tags: Array.isArray(meta.tags) && meta.tags.length ? meta.tags.slice(0, 10) : record.tags
          }
        : record
    )
  })
}

export function removeDownloadRecord(recordId) {
  const state = loadState()
  return saveState({ ...state, downloads: state.downloads.filter((r) => r.recordId !== recordId) })
}

/** 解除下载记录与某个 staging Mod 的绑定（staging 被移除时调用，避免残留失效 stagedId） */
export function detachStagedId(stagedId) {
  const state = loadState()
  if (!stagedId) return state
  return saveState({
    ...state,
    downloads: state.downloads.map((record) =>
      record.stagedId === stagedId ? { ...record, stagedId: '' } : record
    )
  })
}

export function setDownloadNoticeHidden(hidden) {
  const state = loadState()
  return saveState({ ...state, hideDownloadNotice: Boolean(hidden) })
}

function remember(state, item) {
  if (!item || !item.id) return state
  state.known[item.id] = { ...(state.known[item.id] || {}), ...item }
  return state
}

export function toggleFavorite({ id, item }) {
  const state = remember(loadState(), item)
  const exists = state.favorites.includes(id)
  return saveState({
    ...state,
    favorites: exists ? state.favorites.filter((value) => value !== id) : [...state.favorites, id]
  })
}

export function installMod({ id, version, size, item }) {
  const state = remember(loadState(), item)
  if (state.installed.some((entry) => entry.id === id)) return state
  return saveState({
    ...state,
    installed: [
      ...state.installed,
      {
        id,
        version: version || '',
        size: size || '',
        enabled: true,
        installedAt: Date.now()
      }
    ]
  })
}

export function uninstallMod(id) {
  const state = loadState()
  return saveState({ ...state, installed: state.installed.filter((entry) => entry.id !== id) })
}

export function setEnabled({ id, enabled }) {
  const state = loadState()
  return saveState({
    ...state,
    installed: state.installed.map((entry) =>
      entry.id === id ? { ...entry, enabled: Boolean(enabled) } : entry
    )
  })
}
