/**
 * 部署器（需求文档第一阶段）：
 * - 类型识别（不猜测，识别失败即 unclassified）
 * - 硬链接部署 + manifest 记录
 * - 撤销部署只删 manifest 中仍是硬链接的文件
 * - 部署前外部变更检测（refchange / valchange / deleted / srcdeleted）
 * - 生成 archive/pc/mod/modlist.txt
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync, spawn } from 'child_process'
import { app } from 'electron'

const LEGACY_DIR = path.join('archive', 'pc', 'mod')
const SCRIPT_DIR = path.join('r6', 'scripts')
const TWEAK_DIR = path.join('r6', 'tweaks')
const CET_DIR = path.join('bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods')
const RED4EXT_DIR = path.join('red4ext', 'plugins')
const REDMOD_DIR = 'mods'

const MANIFEST_NAME = 'deploy-manifest.json'
const STAGING_INDEX = 'staging.json'

/* ------------------------------ 路径 ------------------------------ */

export function stagingRoot() {
  return path.join(app.getPath('userData'), 'staging')
}

function manifestFile() {
  return path.join(app.getPath('userData'), MANIFEST_NAME)
}

function stagingIndexFile() {
  return path.join(app.getPath('userData'), STAGING_INDEX)
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/* ------------------------------ staging ------------------------------ */

export function loadStaging() {
  const data = readJson(stagingIndexFile(), { mods: [] })
  return { mods: Array.isArray(data.mods) ? data.mods : [] }
}

function saveStaging(data) {
  writeJson(stagingIndexFile(), data)
  return data
}

function walk(dir, base = dir, depth = 0, files = []) {
  if (depth > 8) return files
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  entries.forEach((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, depth + 1, files)
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join('/'))
  })
  return files
}

/** 按特征文件分类；识别不到就返回 unclassified，绝不猜测 */
export function classifyFiles(files) {
  const lower = files.map((file) => file.toLowerCase())
  const has = (ext) => lower.some((file) => file.endsWith(ext))
  const hasInfoJson = lower.some((file) => file === 'info.json' || file.endsWith('/info.json'))
  const hasRedmodSub = lower.some((file) =>
    ['archives/', 'scripts/', 'tweaks/', 'customsounds/'].some((dir) => file.includes(dir))
  )
  const cetPluginPath = lower.some((file) => file.includes('cyber_engine_tweaks/mods/'))
  // CET 本体：cyber_engine_tweaks/ 下但不是 mods/ 里的文件（fonts / scripts / tweakdb / .asi / global.ini 等）
  const cetCorePath = lower.some(
    (file) => file.includes('cyber_engine_tweaks') && !file.includes('cyber_engine_tweaks/mods/')
  )
  const red4extPath = lower.some((file) => file.includes('red4ext/plugins'))
  // RED4ext 本体：red4ext/RED4ext.dll（包内没有 plugins 目录）
  const red4extCore = lower.some((file) => file.endsWith('red4ext/red4ext.dll'))
  // 插件目录内的资源不算独立类型：ArchiveXL 的 Bundle/*.archive、Scripts/*.reds 属于插件本体
  const isPluginFile = (file) =>
    file.includes('red4ext/plugins/') || file.includes('cyber_engine_tweaks/mods/')
  const coreFiles = lower.filter((file) => !isPluginFile(file))
  const hasCore = (ext) => coreFiles.some((file) => file.endsWith(ext))

  const types = []
  if (hasInfoJson && hasRedmodSub) types.push('redmod')
  if (hasCore('.archive') || hasCore('.xl')) types.push('legacy_archive')
  if (hasCore('.reds')) types.push('redscript')
  if (hasCore('.tweak')) types.push('tweak')
  if (has('init.lua') && cetPluginPath) types.push('cet')
  if (cetCorePath) types.push('cet_core')
  if (has('.dll') && red4extPath) types.push('red4ext')
  if (red4extCore) types.push('red4ext_core')

  // redscript 本体：替换引擎自带的脚本编译器（scc）
  const redscriptCore = lower.some(
    (file) => file.endsWith('engine/tools/scc.exe') || file.endsWith('engine/config/base/scripts.ini')
  )
  if (redscriptCore) types.push('redscript_core')

  // 通用兜底：整个包都是游戏根目录结构（bin / r6 / red4ext / archive / mods / engine / sdk）
  // 这类包（引擎工具、原生插件、混合资源）无法用扩展名归类，但路径本身已说明去处，按原路径部署即可
  const GAME_ROOT_DIRS = ['bin/', 'r6/', 'red4ext/', 'archive/', 'mods/', 'engine/', 'sdk/']
  const atGameRoot = lower.every((file) => GAME_ROOT_DIRS.some((dir) => file.startsWith(dir)))
  if (!types.length && lower.length > 0 && atGameRoot) types.push('game_files')

  const extensions = [...new Set(lower.map((file) => path.extname(file)).filter(Boolean))]

  // REDmod 模组自带 archives/scripts/tweaks，不能把这些内部文件当成 Legacy 部署
  if (types.includes('redmod')) {
    return { types: ['redmod'], unclassified: false, extensions, mixed: false }
  }

  if (!types.length) return { types: [], unclassified: true, extensions, mixed: false }
  return {
    types,
    unclassified: false,
    extensions,
    mixed: types.length > 1
  }
}

/**
 * 从 Nexus 下载的 zip 文件名解析模组 ID。
 * Nexus 命名格式：<模组名> <文件版本> <modId> <文件版本> <时间戳> <hash>.zip
 * 例如 "Native Settings UI 1.97 3518 1.97 2026-10-22T15-26Z cB3xB00Va.zip" → 3518
 */
let gameVersionCache = { path: '', version: '' }

/** 读游戏 exe 的产品版本（例如 "2.5"），按 gamePath 缓存 */
export function getGameVersion(gamePath) {
  if (!gamePath) return ''
  if (gameVersionCache.path === gamePath && gameVersionCache.version) return gameVersionCache.version
  try {
    const exe = path.join(gamePath, 'bin', 'x64', 'Cyberpunk2077.exe')
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Item -LiteralPath '${String(exe).replace(/'/g, "''")}').VersionInfo.ProductVersion`
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }
    )
    const version = String(output || '').trim()
    if (version) gameVersionCache = { path: gamePath, version }
    return version
  } catch {
    return ''
  }
}

/** 从 Nexus 下载文件名解析适配的游戏版本（"game version 2.31" / "游戏版本 2.3"） */
export function parseGameVersionFromName(name) {
  const match = String(name || '').match(/(?:game\s*version|游戏版本)\s*([\d.]+)/i)
  return match ? match[1].replace(/\.$/, '') : ''
}

export function parseModIdFromArchiveName(name) {
  const tokens = String(name || '').replace(/\.zip$/i, '').split(/\s+/)
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (/^\d{2,7}$/.test(tokens[i]) && /^\d+\.\d+(\.\d+)?$/.test(tokens[i + 1])) {
      return Number(tokens[i])
    }
  }
  return 0
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'mod'
}

/** 把外部文件夹复制进 staging，返回记录 */
export function importFolder(sourceDir, stagingBase) {
  const name = path.basename(sourceDir)
  const id = `${slugify(name)}-${Date.now().toString(36)}`
  const base = stagingBase || stagingRoot()
  fs.mkdirSync(base, { recursive: true })
  const target = path.join(base, id)
  fs.mkdirSync(target, { recursive: true })
  fs.cpSync(sourceDir, target, { recursive: true })

  const files = walk(target)
  const info = classifyFiles(files)
  const record = {
    id,
    name,
    source: sourceDir,
    dir: target,
    files,
    types: info.types,
    unclassified: info.unclassified,
    extensions: info.extensions,
    enabled: !info.unclassified,
    importedAt: Date.now()
  }
  const data = loadStaging()
  data.mods = [...data.mods.filter((mod) => mod.id !== id), record]
  saveStaging(data)
  return record
}

/** 查找内置 7-Zip（开发时在项目 tools/，打包后在 resources/tools/） */
function find7zBinary() {
  const candidates = []
  try {
    candidates.push(path.join(app.getAppPath(), 'tools', '7z', '7z.exe'))
  } catch {
    /* ignore */
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'tools', '7z', '7z.exe'))
  }
  return candidates.find((file) => fs.existsSync(file)) || ''
}

const ARCHIVE_EXT = /\.(zip|7z|rar|tar|gz|tgz)$/i

/**
 * 导入已下载的压缩包：解压到 staging 并登记。
 * 内置 7-Zip 支持 zip / 7z / rar / tar / gz；找不到内置 7z 时仅 zip 可回退 PowerShell。
 */
export function importArchive(zipPath, stagingBase) {
  if (!ARCHIVE_EXT.test(zipPath || '')) {
    throw new Error('不支持的压缩包格式（支持 zip / 7z / rar / tar / gz）')
  }
  const base = stagingBase || stagingRoot()
  fs.mkdirSync(base, { recursive: true })

  const name = path.basename(zipPath).replace(ARCHIVE_EXT, '')
  const id = `${slugify(name)}-${Date.now().toString(36)}`
  let dest = path.join(base, id)
  fs.mkdirSync(dest, { recursive: true })

  const sevenZip = find7zBinary()
  try {
    if (sevenZip) {
      execFileSync(sevenZip, ['x', '-y', `-o${dest}`, zipPath], {
        timeout: 600000,
        windowsHide: true,
        encoding: 'utf8'
      })
    } else if (/\.zip$/i.test(zipPath)) {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${dest}" -Force`
        ],
        { timeout: 300000, windowsHide: true }
      )
    } else {
      throw new Error('未找到内置 7-Zip，无法解压此格式；请解压后用「导入文件夹」')
    }
  } catch (err) {
    fs.rmSync(path.join(base, id), { recursive: true, force: true })
    throw new Error(`解压失败：${(err && err.message) || '未知错误'}`)
  }

  // 很多压缩包会包一层同名目录，此时把根指到那一层。
  // 但如果唯一的顶层目录是游戏根目录本身（red4ext / r6 / bin / archive / mods / engine / sdk），
  // 说明这个包就是"只有插件目录"的合法结构，下移会剥掉路径前缀、导致类型识别和部署全部错位。
  try {
    const children = fs.readdirSync(dest, { withFileTypes: true })
    const GAME_ROOT_DIRS = ['bin', 'r6', 'red4ext', 'archive', 'mods', 'engine', 'sdk']
    if (
      children.length === 1 &&
      children[0].isDirectory() &&
      !GAME_ROOT_DIRS.includes(children[0].name.toLowerCase())
    ) {
      dest = path.join(dest, children[0].name)
    }
  } catch {
    /* ignore */
  }

  const files = walk(dest)
  const info = classifyFiles(files)
  const record = {
    id,
    name,
    source: zipPath,
    archivePath: zipPath,
    dir: dest,
    files,
    types: info.types,
    unclassified: info.unclassified,
    extensions: info.extensions,
    enabled: !info.unclassified,
    importedAt: Date.now()
  }
  const data = loadStaging()
  data.mods = [...data.mods.filter((mod) => mod.id !== id), record]
  saveStaging(data)
  return record
}

export function removeStaged(id) {
  const data = loadStaging()
  const hit = data.mods.find((mod) => mod.id === id)
  if (hit && hit.dir && fs.existsSync(hit.dir)) {
    fs.rmSync(hit.dir, { recursive: true, force: true })
  }
  data.mods = data.mods.filter((mod) => mod.id !== id)
  saveStaging(data)
  return data
}

/**
 * 迁移旧版 importArchive 留下的错位 staging 记录：
 * 旧逻辑会把「顶层只有 red4ext/ r6/ bin/ …」的包误当成包装目录剥掉前缀，
 * 导致类型识别错位（Codeware 因此被拆成 r6/scripts）。这里用当前分类规则重算并修正。
 */
export function migrateStagingPaths() {
  const GAME_ROOT_DIRS = ['bin', 'r6', 'red4ext', 'archive', 'mods', 'engine', 'sdk']
  const data = loadStaging()
  let changed = 0
  data.mods.forEach((mod) => {
    if (!mod || !mod.dir) return
    const base = path.basename(mod.dir).toLowerCase()
    if (!GAME_ROOT_DIRS.includes(base)) return
    const parent = path.dirname(mod.dir)
    if (!fs.existsSync(parent) || !fs.existsSync(mod.dir)) return
    const files = (mod.files || []).map((file) => base + '/' + file)
    const info = classifyFiles(files)
    mod.dir = parent
    mod.files = files
    mod.types = info.types
    mod.unclassified = info.unclassified
    mod.extensions = info.extensions
    changed += 1
  })
  if (changed) saveStaging(data)
  return changed
}

export function toggleStaged(id, enabled) {
  const data = loadStaging()
  data.mods = data.mods.map((mod) =>
    mod.id === id ? { ...mod, enabled: Boolean(enabled) } : mod
  )
  saveStaging(data)
  return data
}

/** 对已导入的 Mod 重新扫描并分类（分类规则更新或误判时用） */
export function reclassifyStaged(id) {
  const data = loadStaging()
  const mod = data.mods.find((item) => item.id === id)
  if (!mod) return { ok: false, error: '找不到该 staging 记录' }
  if (!mod.dir || !fs.existsSync(mod.dir)) {
    return { ok: false, error: 'staging 目录不存在，请移除后重新导入' }
  }
  const files = walk(mod.dir)
  const info = classifyFiles(files)
  mod.files = files
  mod.types = info.types
  mod.unclassified = info.unclassified
  mod.extensions = info.extensions
  if (!info.unclassified) mod.enabled = true
  saveStaging(data)
  return { ok: true, record: mod }
}

/* ------------------------------ 环境检查 ------------------------------ */

export function isGameRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Cyberpunk2077.exe'], {
      encoding: 'utf8',
      windowsHide: true
    })
    return /Cyberpunk2077\.exe/i.test(out)
  } catch {
    return false
  }
}

function sameDrive(a, b) {
  const root = (p) => path.parse(path.resolve(p)).root.toLowerCase()
  return root(a) === root(b)
}

function isWritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/* ------------------------------ 部署计划 ------------------------------ */

/** 计算某个文件在游戏目录中的落点 */
function targetFor(mod, file) {
  const rel = file.toLowerCase()
  const relPath = file.replace(/\//g, path.sep)
  const base = path.basename(file)

  // REDmod 优先：整个目录进 mods/<slug>，内部资源不能当 Legacy
  if (mod.types.includes('redmod')) {
    return path.join(REDMOD_DIR, slugify(mod.name), relPath)
  }

  // 本体类 / 游戏根结构包：整包按游戏根相对路径落位；
  // x64/... 说明解压根已经是 bin（例如 CET 包只含 bin 目录），补一层 bin
  const rootLike =
    mod.types.includes('cet_core') ||
    mod.types.includes('red4ext_core') ||
    mod.types.includes('redscript_core') ||
    mod.types.includes('game_files')
  if (rootLike) {
    if (rel.startsWith('x64/')) return path.join('bin', relPath)
    return relPath
  }

  // 插件目录优先于扩展名：插件自带的 archive/xl/reds 归属插件，不拆到 Legacy/脚本目录
  if (rel.includes('red4ext/plugins/')) {
    return relPath
  }
  if (rel.includes('cyber_engine_tweaks/mods/')) {
    const idx = relPath.toLowerCase().indexOf('mods')
    return path.join(CET_DIR, relPath.slice(idx + 5))
  }

  // 常规类型：已经自带游戏内相对路径的，保留目录结构（插件/mods 里的子目录结构不能摊平）
  if (rel.startsWith('archive/pc/mod/')) return relPath
  if (rel.startsWith('r6/scripts/')) return relPath
  if (rel.startsWith('r6/tweaks/')) return relPath
  if (rel.endsWith('.archive') || rel.endsWith('.xl')) return path.join(LEGACY_DIR, base)
  if (rel.endsWith('.reds')) return path.join(SCRIPT_DIR, base)
  if (rel.endsWith('.tweak')) return path.join(TWEAK_DIR, base)

  // 混合包里的其余文件：只有落在已知游戏根目录下才原样部署（不猜其它路径）
  if (/^(bin|r6|red4ext|archive|mods|engine)\//.test(rel)) return relPath

  return null
}

export function buildPlan(staging, gamePath, { onlyIds = null } = {}) {
  const entries = []
  const errors = []
  const warnings = []

  staging.mods
    .filter((mod) => (onlyIds && onlyIds.length ? onlyIds.includes(mod.id) : mod.enabled))
    .forEach((mod) => {
      if (mod.unclassified) {
        errors.push({ mod: mod.name, message: '类型无法识别，请手动指定类型后再部署' })
        return
      }
      const isRedmod = mod.types.includes('redmod')
      let skippedFiles = 0
      mod.files.forEach((file) => {
        const rel = targetFor(mod, file)
        if (!rel) {
          skippedFiles += 1
          return
        }
        const stagingFile = path.join(mod.dir, file.split('/').join(path.sep))
        let stat = null
        try {
          stat = fs.statSync(stagingFile)
        } catch {
          stat = null
        }
        if (!stat) return
        entries.push({
          stagedModId: mod.id,
          modName: mod.name,
          modType: mod.types.join('+'),
          deployedPath: rel.split(path.sep).join('/'),
          stagingPath: stagingFile,
          fileSize: stat.size,
          srcMtimeMs: stat.mtimeMs,
          // REDmod 用复制（redMod.exe 需要真实目录），其余走硬链接
          linkType: isRedmod ? 'copy' : 'hardlink'
        })
      })
      if (skippedFiles > 0) {
        warnings.push(
          mod.name + '：跳过 ' + skippedFiles + ' 个安装器结构文件（fomod / 可选键盘布局等，不影响主体功能）'
        )
      }
    })

  // 目标重名检查（同一文件被多个 mod 部署）
  const seen = new Map()
  entries.forEach((entry) => {
    const key = entry.deployedPath.toLowerCase()
    if (seen.has(key) && seen.get(key) !== entry.stagedModId) {
      warnings.push(`文件冲突：${entry.deployedPath} 同时来自多个 Mod，后部署的会覆盖`)
    }
    seen.set(key, entry.stagedModId)
  })

  return { entries, errors, warnings, gamePath }
}

/* ------------------------------ manifest ------------------------------ */

export function readManifest() {
  const data = readJson(manifestFile(), null)
  if (!data || !Array.isArray(data.entries)) {
    return { manifestVersion: 1, gamePath: '', deployedAt: '', entries: [] }
  }
  return data
}

function writeManifest(manifest) {
  writeJson(manifestFile(), manifest)
}

/* ------------------------------ 外部变更检测 ------------------------------ */

function statSafe(file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

export function detectExternalChanges(gamePath) {
  const manifest = readManifest()
  const changes = []

  manifest.entries.forEach((entry) => {
    // 已由用户「接受外部状态」的文件不再纳入跟踪，避免反复报同一条变更
    if (entry.linkType === 'external') return

    const target = path.join(gamePath, entry.deployedPath.split('/').join(path.sep))
    const targetStat = statSafe(target)
    const stagingStat = statSafe(entry.stagingPath)

    const base = {
      path: entry.deployedPath,
      mod: entry.modName,
      stagedModId: entry.stagedModId,
      linkType: entry.linkType,
      targetExists: Boolean(targetStat),
      stagingExists: Boolean(stagingStat),
      targetSize: targetStat ? targetStat.size : 0,
      stagingSize: stagingStat ? stagingStat.size : 0
    }

    if (!targetStat) {
      changes.push({ ...base, type: 'deleted' })
      return
    }
    if (!stagingStat) {
      changes.push({ ...base, type: 'srcdeleted' })
      return
    }

    // REDmod 是复制部署（redMod.exe 需要真实目录），源与目标 inode 天然不同，
    // 必须用大小 + 修改时间比较；否则每个 REDmod 条目都会被误报成 refchange。
    if (entry.linkType === 'copy') {
      const untouched =
        targetStat.size === entry.fileSize &&
        Math.abs(targetStat.mtimeMs - (entry.srcMtimeMs || 0)) < 2000
      if (!untouched) changes.push({ ...base, type: 'refchange' })
      return
    }

    const linked = targetStat.ino === stagingStat.ino && targetStat.dev === stagingStat.dev
    if (!linked) {
      changes.push({ ...base, type: 'refchange' })
      return
    }
    if (targetStat.size !== stagingStat.size || targetStat.mtimeMs !== stagingStat.mtimeMs) {
      changes.push({ ...base, type: 'valchange' })
    }
  })

  return changes
}

/**
 * 处理一条外部变更（需求文档 §3.3：refchange / valchange 不得自动 resolve）。
 * action = 'accept'：接受外部状态并更新 manifest
 * action = 'restore'：恢复为 staging 状态
 */
export function resolveExternalChange({ gamePath, path: deployedPath, action } = {}) {
  if (!gamePath) return { ok: false, error: '尚未设置游戏目录' }
  if (isGameRunning()) return { ok: false, error: '游戏正在运行，禁止修改游戏目录' }
  if (!deployedPath) return { ok: false, error: '缺少目标文件' }

  const manifest = readManifest()
  const entry = manifest.entries.find(
    (item) => item.deployedPath.toLowerCase() === String(deployedPath).toLowerCase()
  )
  if (!entry) return { ok: false, error: `manifest 中没有该条目：${deployedPath}` }

  const change = detectExternalChanges(gamePath).find(
    (item) => item.path.toLowerCase() === String(deployedPath).toLowerCase()
  )
  if (!change) return { ok: false, error: '该条目当前没有外部变更' }

  const target = path.join(gamePath, entry.deployedPath.split('/').join(path.sep))
  const targetStat = statSafe(target)
  const stagingStat = statSafe(entry.stagingPath)

  if (action === 'accept') {
    if (change.type === 'deleted' || change.type === 'srcdeleted') {
      // deleted：游戏目录文件被删；srcdeleted：staging 源没了。
      // 接受 = 该条目从 manifest 移除（游戏目录中残留的文件不再由管理器负责）
      manifest.entries = manifest.entries.filter((item) => item !== entry)
    } else if (change.type === 'refchange') {
      // 接受游戏目录的当前内容：标记 external，撤销时不再删除它
      entry.linkType = 'external'
      entry.fileSize = targetStat.size
      entry.srcMtimeMs = targetStat.mtimeMs
      entry.acceptedAt = Date.now()
    } else if (change.type === 'valchange') {
      // 硬链接被原地编辑（staging 一起变了）：记录对齐当前状态即可
      entry.fileSize = stagingStat.size
      entry.srcMtimeMs = stagingStat.mtimeMs
      entry.acceptedAt = Date.now()
    }
    writeManifest(manifest)
    regenerateArchiveModlist(gamePath)
    return { ok: true, action, type: change.type, changes: detectExternalChanges(gamePath) }
  }

  if (action === 'restore') {
    if (change.type === 'srcdeleted') {
      return { ok: false, error: 'staging 中的源文件已被删除，无法恢复；请重新导入该 Mod' }
    }
    if (!stagingStat) return { ok: false, error: 'staging 源文件不存在，无法恢复' }
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target)
    } catch (err) {
      return { ok: false, error: `无法移除现有文件：${err && err.message}` }
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      if (entry.linkType === 'copy') fs.copyFileSync(entry.stagingPath, target)
      else fs.linkSync(entry.stagingPath, target)
    } catch (err) {
      return { ok: false, error: `恢复失败：${err && err.message}` }
    }
    entry.linkType = entry.linkType === 'external' ? 'hardlink' : entry.linkType
    entry.fileSize = stagingStat.size
    entry.srcMtimeMs = stagingStat.mtimeMs
    delete entry.acceptedAt
    writeManifest(manifest)
    regenerateArchiveModlist(gamePath)
    return { ok: true, action, type: change.type, changes: detectExternalChanges(gamePath) }
  }

  return { ok: false, error: '未知操作（只支持 accept / restore）' }
}

/** 比较两个文件内容是否一致（大小 + sha1），用于接管已存在但不受管理的文件 */
function isSameContent(a, b) {
  try {
    const sa = fs.statSync(a)
    const sb = fs.statSync(b)
    if (sa.size !== sb.size) return false
    const ha = crypto.createHash('sha1').update(fs.readFileSync(a)).digest('hex')
    const hb = crypto.createHash('sha1').update(fs.readFileSync(b)).digest('hex')
    return ha === hb
  } catch {
    return false
  }
}

/* ------------------------------ 部署 / 撤销 ------------------------------ */

export function preflight(gamePath, stagingPath) {
  const errors = []
  const warnings = []

  if (!gamePath) errors.push('尚未设置游戏目录')
  if (!fs.existsSync(gamePath)) errors.push('游戏目录不存在')

  fs.mkdirSync(stagingPath, { recursive: true })
  if (!sameDrive(stagingPath, gamePath)) {
    errors.push('staging 与游戏目录不在同一磁盘分区，硬链接无法建立（不允许降级为复制）')
  }
  if (isGameRunning()) errors.push('检测到游戏正在运行，禁止部署或撤销部署')
  if (gamePath && !isWritable(gamePath)) errors.push('游戏目录不可写')

  const staging = loadStaging()
  const hasUnclassified = staging.mods.some((mod) => mod.enabled && mod.unclassified)
  if (hasUnclassified) warnings.push('存在未识别类型的 Mod，已跳过')

  // 硬链接不能跨磁盘：staging 里的实际目录必须和游戏目录同分区
  // （历史数据可能是从旧版本解压到 userData/staging 的 C 盘目录）
  const crossDevice = staging.mods.filter(
    (mod) => mod.enabled && mod.dir && fs.existsSync(mod.dir) && !sameDrive(mod.dir, gamePath)
  )
  if (crossDevice.length) {
    errors.push(
      `以下 Mod 的 staging 目录与游戏不在同一磁盘，无法建立硬链接，请移除后从「包体记录」重新解压：${crossDevice
        .map((mod) => mod.name)
        .join('、')}`
    )
  }

  return { errors, warnings }
}

export function deploy(gamePath, stagingPath, { onlyIds = null } = {}) {
  const check = preflight(gamePath, stagingPath)
  if (check.errors.length) {
    return { ok: false, errors: check.errors, warnings: check.warnings, added: [], changes: [] }
  }

  const changes = detectExternalChanges(gamePath)
  if (changes.some((item) => item.type === 'refchange' || item.type === 'valchange')) {
    return {
      ok: false,
      errors: ['检测到外部修改，请先在「外部变更」中确认后再部署'],
      warnings: check.warnings,
      added: [],
      changes
    }
  }

  const staging = loadStaging()
  const plan = buildPlan(staging, gamePath, { onlyIds })
  if (plan.errors.length) {
    return { ok: false, errors: plan.errors.map((e) => `${e.mod}：${e.message}`), warnings: plan.warnings, added: [], changes }
  }

  const manifest = readManifest()
  const ownedBy = new Map(manifest.entries.map((entry) => [entry.deployedPath.toLowerCase(), entry]))
  const added = []
  const created = []
  const replaced = [] // 跨 mod 覆盖：记录被顶掉的旧条目

  try {
    plan.entries.forEach((entry) => {
      const key = entry.deployedPath.toLowerCase()
      const owner = ownedBy.get(key)
      const target = path.join(gamePath, entry.deployedPath.split('/').join(path.sep))

      if (owner && owner.stagedModId === entry.stagedModId) return // 自己已部署

      if (owner && owner.stagedModId !== entry.stagedModId) {
        // 同一个文件被另一个 mod 占用：内容一致就跳过；不一致则后者覆盖前者
        // （典型场景：CHS 汉化补丁覆盖本体同名文件，装了汉化就是要顶掉原版）
        if (fs.existsSync(target) && isSameContent(entry.stagingPath, target)) return
        if (fs.existsSync(target)) fs.unlinkSync(target)
        manifest.entries = manifest.entries.filter((item) => item.deployedPath.toLowerCase() !== key)
        ownedBy.delete(key)
        replaced.push({ path: entry.deployedPath, previous: owner.modName, current: entry.modName })
      }

      fs.mkdirSync(path.dirname(target), { recursive: true })
      if (fs.existsSync(target)) {
        // 目标已存在但 manifest 里没有：如果内容与 staging 源完全一致，
        // 说明是同一版本文件被外部放置或旧记录丢失，直接接管（移除后重建硬链接）；
        // 内容不一致才阻止，避免覆盖用户手动改过的文件。
        if (!isSameContent(entry.stagingPath, target)) {
          throw new Error(
            `目标已存在且不受管理：${entry.deployedPath}（与 staging 中的文件内容不一致，请先手动确认或删除该文件）`
          )
        }
        fs.unlinkSync(target)
      }
      if (entry.linkType === 'copy') {
        fs.copyFileSync(entry.stagingPath, target)
      } else {
        fs.linkSync(entry.stagingPath, target)
      }
      created.push(target)
      added.push(entry)
    })
  } catch (err) {
    created.reverse().forEach((file) => {
      try {
        fs.unlinkSync(file)
      } catch {
        /* 回滚失败时保留现场 */
      }
    })
    const raw = (err && err.message) || '部署失败'
    const message = /EXDEV|cross-device/i.test(raw)
      ? '硬链接不能跨磁盘：该 Mod 的 staging 文件与游戏目录不在同一分区。请在部署页移除它，再从「包体记录」重新解压（会落到游戏目录下的默认 staging）。'
      : raw
    return { ok: false, errors: [message], warnings: plan.warnings, added: [], changes }
  }

  const hasRedmod = added.some((entry) => entry.linkType === 'copy')
  const redmod = hasRedmod ? runRedMod(gamePath) : { ok: true, skipped: true }

  // 新部署的条目追加到排序列表末尾，已有顺序保持不变
  const newArchives = added
    .filter((entry) => /^archive\/pc\/mod\/.*\.archive$/i.test(entry.deployedPath))
    .map((entry) => path.basename(entry.deployedPath))
  const legacyOrder = [
    ...(manifest.legacyOrder || []).filter((name) => !newArchives.includes(name)),
    ...newArchives
  ]
  const newSlugs = [
    ...new Set(
      added.filter((entry) => entry.linkType === 'copy').map((entry) => entry.deployedPath.split('/')[1])
    )
  ]
  const redmodOrder = [
    ...(manifest.redmodOrder || []).filter((slug) => !newSlugs.includes(slug)),
    ...newSlugs
  ]

  writeManifest({
    manifestVersion: 1,
    gamePath,
    deployedAt: new Date().toISOString(),
    entries: [...manifest.entries, ...added],
    redmod,
    legacyOrder,
    redmodOrder
  })

  regenerateArchiveModlist(gamePath)

  return {
    ok: true,
    errors: [],
    warnings: [
      ...plan.warnings,
      ...(hasRedmod && !redmod.ok ? [`REDmod 部署失败：${redmod.error}`] : []),
      ...replaced.map((item) => `覆盖冲突：${item.current} 顶替了 ${item.previous} 的 ${item.path}`)
    ],
    added,
    replaced,
    changes,
    redmod,
    manifest: readManifest()
  }
}

/** 调用游戏自带的 redMod.exe deploy；失败时由调用方阻止启动 */
export function runRedMod(gamePath) {
  // 不同版本放在 tools/redmod/bin 或 tools/redmod 下，逐一探测
  const candidates = [
    path.join(gamePath, 'tools', 'redmod', 'bin', 'redMod.exe'),
    path.join(gamePath, 'tools', 'redmod', 'redMod.exe')
  ]
  const exe = candidates.find((item) => fs.existsSync(item))
  if (!exe) {
    return {
      ok: false,
      error: `未找到 redMod.exe，已检查：${candidates.join(' | ')}`
    }
  }
  try {
    const output = execFileSync(exe, ['deploy'], {
      cwd: path.dirname(exe),
      timeout: 180000,
      encoding: 'utf8',
      windowsHide: true
    })
    return { ok: true, output: String(output || '').slice(-2000), at: Date.now() }
  } catch (err) {
    const detail = err && (err.stderr || err.message) ? String(err.stderr || err.message) : '未知错误'
    return { ok: false, error: detail.slice(0, 800), at: Date.now() }
  }
}

export function undeploy(gamePath, { onlyIds = null } = {}) {
  const manifest = readManifest()
  const removed = []
  const skipped = []
  const scoped = Boolean(onlyIds && onlyIds.length)
  const targets = scoped
    ? manifest.entries.filter((entry) => onlyIds.includes(entry.stagedModId))
    : manifest.entries
  const remaining = scoped
    ? manifest.entries.filter((entry) => !onlyIds.includes(entry.stagedModId))
    : []

  targets.forEach((entry) => {
    const target = path.join(gamePath, entry.deployedPath.split('/').join(path.sep))
    const targetStat = statSafe(target)
    if (!targetStat) return

    // 用户已「接受外部状态」的文件不再删除
    if (entry.linkType === 'external') {
      skipped.push({ path: entry.deployedPath, reason: '已接受为外部文件，未删除' })
      return
    }

    // 硬链接：inode 必须一致；复制式（REDmod）：大小与修改时间必须未被外部改动
    let untouched = false
    if (entry.linkType === 'copy') {
      untouched =
        targetStat.size === entry.fileSize &&
        Math.abs(targetStat.mtimeMs - (entry.srcMtimeMs || 0)) < 2000
    } else {
      const stagingStat = statSafe(entry.stagingPath)
      untouched = Boolean(
        stagingStat && targetStat.ino === stagingStat.ino && targetStat.dev === stagingStat.dev
      )
    }

    if (!untouched) {
      skipped.push({ path: entry.deployedPath, reason: '已被外部修改，未删除' })
      return
    }
    try {
      fs.unlinkSync(target)
      removed.push(entry.deployedPath)
    } catch {
      skipped.push({ path: entry.deployedPath, reason: '删除失败' })
    }
  })

  // 清理 REDmod 留下的空目录
  ;['mods'].forEach((dirName) => {
    const dir = path.join(gamePath, dirName)
    if (!fs.existsSync(dir)) return
    try {
      fs.readdirSync(dir).forEach((child) => {
        const full = path.join(dir, child)
        if (fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0) {
          fs.rmdirSync(full)
        }
      })
    } catch {
      /* 目录被占用时忽略 */
    }
  })

  // 清理排序表，避免遗留已不存在的 archive / slug
  const removedArchiveNames = new Set(
    removed
      .map((item) => path.basename(item))
      .filter((name) => /\.archive$/i.test(name))
  )
  const remainingSlugs = new Set(
    remaining
      .filter((entry) => entry.linkType === 'copy')
      .map((entry) => entry.deployedPath.split('/')[1])
  )
  const legacyOrder = (manifest.legacyOrder || []).filter((name) => !removedArchiveNames.has(name))
  const redmodOrder = (manifest.redmodOrder || []).filter((slug) => remainingSlugs.has(slug))
  const keepsRedmod = remaining.some((entry) => entry.linkType === 'copy')

  // 撤销过 REDmod 时让 redMod.exe 重新同步 mods/（best-effort，不阻塞撤销）
  let redmod = keepsRedmod ? manifest.redmod || { ok: true, skipped: true } : { ok: true, skipped: true }
  if (targets.some((entry) => entry.linkType === 'copy')) {
    const rerun = runRedMod(gamePath)
    if (keepsRedmod) redmod = rerun
  }

  writeManifest({
    manifestVersion: 1,
    gamePath,
    deployedAt: new Date().toISOString(),
    entries: remaining,
    redmod,
    legacyOrder,
    redmodOrder
  })
  regenerateArchiveModlist(gamePath)
  return { ok: true, removed, skipped, redmod }
}

/* ------------------------------ 排序 ------------------------------ */

/** 未列出的 archive 会后加载；列表里先出现的先加载并在冲突中获胜 */
export function regenerateArchiveModlist(gamePath) {
  const manifest = readManifest()
  const legacy = manifest.entries
    .filter((entry) => entry.deployedPath.toLowerCase().startsWith('archive/pc/mod/'))
    // modlist.txt 只列 .archive；.xl 是 ArchiveXL 扩展，不参与 archive 加载顺序
    .filter((entry) => /\.archive$/i.test(entry.deployedPath))
    .map((entry) => path.basename(entry.deployedPath))

  const order = readManifest().legacyOrder || []
  const unique = [...new Set(legacy)].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    // 未在排序表中的排在最后，保持字母序可预期
    if (ia < 0 && ib < 0) return a.localeCompare(b)
    if (ia < 0) return 1
    if (ib < 0) return -1
    return ia - ib
  })

  const target = path.join(gamePath, LEGACY_DIR, 'modlist.txt')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // 先列出的先加载，冲突时先加载者获胜
  fs.writeFileSync(target, unique.join('\n'), 'utf8')
  return unique
}

/** 保存排序（legacy 会立刻重写 modlist.txt） */
export function setDeployOrder({ kind, order, gamePath }) {
  const manifest = readManifest()
  const list = Array.isArray(order) ? order : []
  if (kind === 'legacy') manifest.legacyOrder = list
  else if (kind === 'redmod') manifest.redmodOrder = list
  writeManifest(manifest)
  if (kind === 'legacy' && gamePath) regenerateArchiveModlist(gamePath)
  return {
    legacyOrder: manifest.legacyOrder || [],
    redmodOrder: manifest.redmodOrder || []
  }
}

/* ------------------------------ 启动游戏 ------------------------------ */

/** 强制结束游戏进程（游戏卡在错误弹窗 / 崩溃残留时用） */
export function stopGame() {
  if (!isGameRunning()) return { ok: true, alreadyStopped: true }
  try {
    execFileSync('taskkill', ['/IM', 'Cyberpunk2077.exe', '/F', '/T'], {
      windowsHide: true,
      encoding: 'utf8'
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err && err.message) || '结束游戏进程失败' }
  }
}

export function launchGame(gamePath) {
  if (!gamePath) return { ok: false, error: '尚未设置游戏目录' }
  if (isGameRunning()) return { ok: false, error: '游戏已在运行' }

  // 第二阶段：REDmod 部署失败时禁止启动
  const manifest = readManifest()
  const hasRedmod = manifest.entries.some((entry) => entry.linkType === 'copy')
  if (hasRedmod && manifest.redmod && manifest.redmod.ok === false) {
    return {
      ok: false,
      error: `REDmod 部署失败，已阻止启动：${manifest.redmod.error || '未知错误'}`
    }
  }

  const exe = path.join(gamePath, 'bin', 'x64', 'Cyberpunk2077.exe')
  if (!fs.existsSync(exe)) return { ok: false, error: `找不到游戏可执行文件：${exe}` }

  const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' })
  child.unref()
  return { ok: true }
}
