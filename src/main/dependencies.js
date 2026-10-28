/**
 * 核心框架依赖嗅探（需求文档 §5.2：软警告，不阻止部署）。
 * 只做存在性检查，不解析版本；结果用于启动游戏前提示。
 */
import fs from 'fs'
import path from 'path'
import { loadStaging, readManifest } from './deployer'
import { loadState } from './store'

const CORE_FRAMEWORKS = {
  cet: {
    label: 'Cyber Engine Tweaks',
    modId: 107,
    hint: 'bin/x64/plugins/cyber_engine_tweaks.asi',
    // 只看本体特征文件：只有目录（插件残留）不算装了 CET
    installed: (game) =>
      fs.existsSync(path.join(game, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks.asi'))
  },
  redscript: {
    label: 'redscript',
    modId: 1511,
    hint: 'engine/tools/scc.exe',
    // redscript 本体替换的是引擎自带脚本编译器
    installed: (game) => fs.existsSync(path.join(game, 'engine', 'tools', 'scc.exe'))
  },
  archivexl: {
    label: 'ArchiveXL',
    modId: 4198,
    hint: 'red4ext/plugins/ArchiveXL',
    installed: (game) => fs.existsSync(path.join(game, 'red4ext', 'plugins', 'ArchiveXL'))
  },
  tweakxl: {
    label: 'TweakXL',
    modId: 4197,
    hint: 'red4ext/plugins/TweakXL',
    installed: (game) => fs.existsSync(path.join(game, 'red4ext', 'plugins', 'TweakXL'))
  },
  red4ext: {
    label: 'RED4ext',
    modId: 2380,
    hint: 'red4ext/RED4ext.dll',
    installed: (game) => fs.existsSync(path.join(game, 'red4ext', 'RED4ext.dll'))
  }
}

const FRAMEWORK_BY_MOD_ID = {
  107: 'cet',
  1511: 'redscript',
  4198: 'archivexl',
  4197: 'tweakxl',
  2380: 'red4ext'
}

const FRAMEWORK_BY_NAME = {
  'cyber engine tweaks': 'cet',
  cet: 'cet',
  redscript: 'redscript',
  archivexl: 'archivexl',
  tweakxl: 'tweakxl',
  red4ext: 'red4ext'
}

/**
 * 按已启用 staging Mod 的文件特征推断需要哪些核心框架，
 * 再检查游戏目录里是否已安装。
 */
export function checkDependencies(gamePath) {
  if (!gamePath) return { missing: [], checked: [], error: '尚未设置游戏目录' }

  let mods = []
  try {
    mods = loadStaging().mods.filter((mod) => mod.enabled && !mod.unclassified)
  } catch {
    mods = []
  }

  // 下载记录按 stagingId 建索引，用来读 Nexus 前置声明
  const byStagedId = new Map()
  try {
    loadState().downloads.forEach((record) => {
      if (record.stagedId) byStagedId.set(record.stagedId, record)
    })
  } catch {
    /* ignore */
  }

  const needed = {}
  const add = (key, modName) => {
    if (!needed[key]) needed[key] = []
    if (!needed[key].includes(modName)) needed[key].push(modName)
  }

  mods.forEach((mod) => {
    const lower = (mod.files || []).map((file) => String(file).toLowerCase())
    if (lower.some((file) => file.endsWith('.reds'))) add('redscript', mod.name)
    if (lower.some((file) => file.endsWith('.xl'))) add('archivexl', mod.name)
    if (lower.some((file) => file.endsWith('.tweak'))) add('tweakxl', mod.name)
    if ((mod.types || []).includes('red4ext')) add('red4ext', mod.name)
    if ((mod.types || []).includes('cet')) add('cet', mod.name)

    // Nexus 前置声明是权威信息：即使文件特征没体现，声明了框架也算需求
    const record = byStagedId.get(mod.id)
    const requirements = (record && Array.isArray(record.requirements)) ? record.requirements : []
    requirements.forEach((req) => {
      const key = FRAMEWORK_BY_MOD_ID[Number(req.modId)] || FRAMEWORK_BY_NAME[String(req.name || '').toLowerCase()]
      if (key) add(key, mod.name)
    })
  })

  const checked = []
  const missing = []
  Object.keys(needed).forEach((key) => {
    const framework = CORE_FRAMEWORKS[key]
    if (!framework) return
    let ok = false
    try {
      ok = Boolean(framework.installed(gamePath))
    } catch {
      ok = false
    }
    const entry = {
      key,
      label: framework.label,
      hint: framework.hint,
      modId: framework.modId || 0,
      mods: needed[key],
      installed: ok
    }
    checked.push(entry)
    if (!ok) missing.push(entry)
  })

  return { missing, checked }
}

/**
 * 具体 Mod 的前置依赖检查（Nexus requirements）。
 * 按 Nexus modId 对照已启用 staging Mod 的下载记录；站外前置（external）无法自动判断，跳过。
 */
export function checkModRequirements(gamePath) {
  let staging = []
  try {
    staging = loadStaging().mods.filter((mod) => mod.enabled && !mod.unclassified)
  } catch {
    staging = []
  }

  const state = loadState()
  const byStagedId = new Map()
  state.downloads.forEach((record) => {
    if (record.stagedId) byStagedId.set(record.stagedId, record)
  })

  // 已安装的 Nexus 模组 ID：staging 里启用的 + manifest 里已部署的
  const installedIds = new Set()
  staging.forEach((mod) => {
    const record = byStagedId.get(mod.id)
    if (record && record.modId) installedIds.add(Number(record.modId))
  })
  try {
    readManifest().entries.forEach((entry) => {
      const record = byStagedId.get(entry.stagedModId)
      if (record && record.modId) installedIds.add(Number(record.modId))
    })
  } catch {
    /* ignore */
  }

  const missing = []
  const seen = new Set()
  staging.forEach((mod) => {
    const record = byStagedId.get(mod.id)
    const requirements = (record && Array.isArray(record.requirements)) ? record.requirements : []
    requirements.forEach((req) => {
      if (!req || req.external) return
      if (req.modId && installedIds.has(Number(req.modId))) return
      // 前置本身是核心框架、且游戏目录里已经装好 → 视为满足
      const frameworkKey =
        FRAMEWORK_BY_MOD_ID[Number(req.modId)] || FRAMEWORK_BY_NAME[String(req.name || '').toLowerCase()]
      if (frameworkKey && gamePath) {
        try {
          if (CORE_FRAMEWORKS[frameworkKey] && CORE_FRAMEWORKS[frameworkKey].installed(gamePath)) return
        } catch {
          /* ignore */
        }
      }
      const key = `${mod.id}::${req.modId || req.name}`
      if (seen.has(key)) return
      seen.add(key)
      missing.push({
        requiredBy: mod.name,
        modId: req.modId || 0,
        name: req.name || '未知前置',
        url: req.url || '',
        notes: req.notes || ''
      })
    })
  })
  return missing
}
