/**
 * 包体库：下载记录与本地包体文件的派生状态。
 *
 * 「包体状态识别」的两个派生字段都在这里计算，避免各处重复且口径不一：
 *  - archiveExists：「已预留」= 记录绑定的压缩包仍在磁盘上
 *  - deployed：记录绑定的 staging Mod 真的进了部署 manifest
 * 另外 stagedId 只在 staging 记录仍存在时才算有效（staging 被移除后不能再指向它）。
 */
import fs from 'fs'
import path from 'path'
import { packagesDir } from './downloader'
import {
  getGameVersion,
  loadStaging,
  parseGameVersionFromName,
  parseModIdFromArchiveName,
  readManifest
} from './deployer'
import { getPaths } from './settings'
import { loadState, saveState } from './store'

/** 从 staging 记录名解析 modId（形如 "TweakXL 4197 1.12.0 2026-..." 的第二段数字） */
function modIdFromStagingName(name) {
  const match = String(name || '').match(/^(.+?)\s+(\d{2,6})\s+\S+/)
  return match ? Number(match[2]) : 0
}

/** staging 记录名是否包含指定 modId（带空格边界，避免部分匹配） */
function stagedMatchesModId(staged, modId) {
  if (!staged || !modId) return false
  return String(staged.name || '').includes(' ' + modId + ' ')
}

/**
 * 推断下载记录应绑定的 staging 记录。
 * 优先用已保存的绑定，但必须通过 modId 校验（历史数据里出现过 TweakXL 被绑到 redscript 记录上的错绑）；
 * 校验失败时按 modId 重新匹配，匹配不到再按名称前缀兜底。
 */
function inferStagedRecord(record, stagedById, stagingMods) {
  const modId = Number(record.modId) || 0
  const current = record.stagedId ? stagedById.get(record.stagedId) : null
  if (current && stagedMatchesModId(current, modId)) return current

  const byModId = stagingMods.find((mod) => modIdFromStagingName(mod.name) === modId)
  if (byModId) return byModId

  const recordName = String(record.name || '').toLowerCase().trim()
  if (recordName) {
    const byName = stagingMods.filter((mod) => String(mod.name || '').toLowerCase().startsWith(recordName + ' '))
    if (byName.length === 1) return byName[0]
  }
  return null
}

/**
 * 导入/解压后把 staging 记录回绑到对应的下载记录（按 modId 匹配）。
 * 导入文件夹时没有现成的 recordId，靠这里补上联动，避免包体记录显示未部署。
 */
export function attachStagedToDownload(staged) {
  if (!staged || !staged.id) return false
  const modId = modIdFromStagingName(staged.name)
  if (!modId) return false
  const state = loadState()
  const record = (state.downloads || []).find((item) => Number(item.modId) === modId)
  if (!record || record.stagedId === staged.id) return false
  record.stagedId = staged.id
  saveState(state)
  return true
}

/**
 * 校验下载记录绑定的压缩包路径是否属于这条记录（按文件名解析 modId）。
 * 历史数据里出现过 TweakXL 记录指向 redscript 压缩包的情况；错绑时按 modId 在下载目录自愈，
 * 找不到就当作「未预留」，避免解压/删除时操作错文件。
 */
function resolveArchiveBinding(record) {
  const recordModId = Number(record.modId) || 0
  const savedPath = record.archivePath || ''
  if (savedPath && fs.existsSync(savedPath)) {
    const parsedId = parseModIdFromArchiveName(path.basename(savedPath))
    if (!parsedId || !recordModId || parsedId === recordModId) {
      return { archivePath: savedPath, archiveExists: true }
    }
  }
  // 错绑或文件不存在：按 modId 在下载目录里找正确的包
  if (recordModId) {
    try {
      const dir = packagesDir()
      const match = fs.readdirSync(dir).find((name) => {
        const parsedId = parseModIdFromArchiveName(name)
        return parsedId === recordModId
      })
      if (match) {
        return { archivePath: path.join(dir, match), archiveExists: true }
      }
    } catch {
      /* 下载目录不存在时忽略 */
    }
  }
  // 错绑的路径不展示（指向别的模组的包，展示只会误导），统一显示为「未预留」
  return { archivePath: '', archiveExists: false }
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 包体目录里的文件（真实下载落盘的位置） */
export function listPackageFiles() {
  const dir = packagesDir()
  let files = []
  try {
    files = fs.readdirSync(dir).map((name) => {
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      return { name, path: full, size: stat.size, sizeLabel: formatSize(stat.size), mtime: stat.mtimeMs }
    })
  } catch {
    files = []
  }
  files.sort((a, b) => b.mtime - a.mtime)

  const state = loadState()
  const byPath = new Map(state.downloads.map((record) => [record.archivePath, record]))
  const stagingMods = loadStaging().mods
  const stagedById = new Map(stagingMods.map((mod) => [mod.id, mod]))

  return {
    dir,
    files: files.map((file) => {
      const record = byPath.get(file.path)
      const staged = record ? inferStagedRecord(record, stagedById, stagingMods) : null
      return {
        ...file,
        mod: record ? record.name : '',
        recordId: record ? record.recordId : '',
        // staging 记录已被移除时不再声称「已解压」，否则会骗用户
        stagedId: staged ? record.stagedId : '',
        stagedTypes: staged ? staged.types.join(' + ') : ''
      }
    })
  }
}

/** 已下载页的数据：记录 + 派生字段 */
export function listDownloadRecords() {
  const state = loadState()
  const currentGameVersion = getGameVersion(getPaths().gamePath)
  const deployedIds = new Set(readManifest().entries.map((entry) => entry.stagedModId))
  const stagingMods = loadStaging().mods
  const stagedById = new Map(stagingMods.map((mod) => [mod.id, mod]))

  // 下载目录里按文件名解析出的 modId 建立索引，用于校验/自愈错绑的压缩包路径
  const filesByModId = new Map()
  try {
    const dir = packagesDir()
    fs.readdirSync(dir).forEach((name) => {
      const full = path.join(dir, name)
      try {
        if (!fs.statSync(full).isFile()) return
      } catch {
        return
      }
      const parsedId = parseModIdFromArchiveName(name)
      if (parsedId) filesByModId.set(parsedId, full)
    })
  } catch {
    /* 下载目录不存在时忽略 */
  }

  return {
    records: state.downloads.map((record) => {
      const staged = inferStagedRecord(record, stagedById, stagingMods)
      // 旧记录没存展示快照：用 known 里的模组资料补齐
      const known = state.known[record.modId] || {}
      // 下载文件名里标注的适配游戏版本（如 "game version 2.31"）
      const gameVersion = parseGameVersionFromName(record.archivePath || record.name || '')
      return {
        ...record,
        gameVersion,
        currentGameVersion,
        gameVersionMismatch: Boolean(gameVersion && currentGameVersion && gameVersion !== currentGameVersion),
        name: record.name || known.name || '',
        version: record.version || known.version || '',
        author: record.author || known.author || '',
        category: record.category || known.category || '',
        summary: record.summary || known.summary || '',
        picture: record.picture || known.picture || '',
        tags: (Array.isArray(record.tags) && record.tags.length ? record.tags : known.tags) || [],
        // 失效的绑定要清掉，否则「部署」按钮会指向一个已经不存在的 staging Mod
        stagedId: staged ? record.stagedId : '',
        stagedTypes: staged ? staged.types.join(' + ') : '',
        ...resolveArchiveBinding(record),
        deployed: Boolean(staged && deployedIds.has(record.stagedId))
      }
    }),
    hideDownloadNotice: state.hideDownloadNotice
  }
}
