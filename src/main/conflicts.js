/**
 * Legacy archive 冲突扫描（需求文档 §8.2）。
 * 优先调用 red4-conflicts.exe；找不到工具时降级为「归档清单 + modlist 顺序」的静态分析。
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { readManifest } from './deployer'

function findTool(gamePath) {
  const candidates = [
    path.join(gamePath, 'red4-conflicts.exe'),
    path.join(gamePath, 'tools', 'red4-conflicts.exe'),
    path.join(gamePath, 'tools', 'red4conflicts', 'red4-conflicts.exe'),
    path.join(app.getPath('userData'), 'tools', 'red4-conflicts.exe')
  ]
  return candidates.find((file) => fs.existsSync(file)) || ''
}

/** 把 red4-conflicts 的文本输出按行解析（工具输出格式可能变化，做宽松解析） */
function parseConflictOutput(output) {
  const lines = String(output || '').split(/\r?\n/)
  const entries = []
  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    // 常见格式：文件路径 + 获胜 / 被覆盖 两个 mod
    if (/winner/i.test(trimmed) || /loser/i.test(trimmed) || /conflict/i.test(trimmed)) {
      entries.push({ text: trimmed })
    }
  })
  return { entries, raw: String(output || '').slice(0, 20000) }
}

/** 降级：没有工具时给出归档清单与 modlist 顺序，提示潜在冲突面 */
function fallbackAnalysis(gamePath) {
  const modDir = path.join(gamePath, 'archive', 'pc', 'mod')
  let archives = []
  try {
    archives = fs
      .readdirSync(modDir)
      .filter((name) => /\.archive$/i.test(name))
      .map((name) => {
        const file = path.join(modDir, name)
        let size = 0
        let mtime = 0
        try {
          const stat = fs.statSync(file)
          size = stat.size
          mtime = stat.mtimeMs
        } catch {
          /* ignore */
        }
        return { name, size, mtime }
      })
  } catch {
    archives = []
  }

  const manifest = readManifest()
  const order = (manifest.legacyOrder || []).filter(Boolean)
  const byMod = new Map()
  ;(manifest.entries || []).forEach((entry) => {
    if (!/^archive\/pc\/mod\/.*\.archive$/i.test(entry.deployedPath)) return
    const name = path.basename(entry.deployedPath)
    if (!byMod.has(entry.modName)) byMod.set(entry.modName, [])
    byMod.get(entry.modName).push(name)
  })

  const notes = []
  const multi = [...byMod.entries()].filter(([, list]) => list.length > 1)
  multi.forEach(([modName, list]) => {
    notes.push(`${modName} 部署了多个 archive（${list.join('、')}），文件级冲突风险较高`)
  })
  if (!archives.length) notes.push('archive/pc/mod 目录下没有 archive 文件')
  if (archives.length && order.length && archives.length !== order.length) {
    notes.push(
      `modlist.txt 记录 ${order.length} 个 archive，实际目录里有 ${archives.length} 个（未列出的按默认序加载）`
    )
  }

  return { archives, order, notes }
}

export function scanConflicts(gamePath) {
  if (!gamePath) return { available: false, error: '尚未设置游戏目录' }

  const tool = findTool(gamePath)
  if (tool) {
    try {
      const output = execFileSync(tool, [path.join(gamePath, 'archive', 'pc', 'mod')], {
        encoding: 'utf8',
        timeout: 180000,
        windowsHide: true
      })
      return {
        available: true,
        tool,
        parsed: parseConflictOutput(output),
        fallback: fallbackAnalysis(gamePath)
      }
    } catch (err) {
      return {
        available: true,
        tool,
        error: (err && (err.stderr || err.message)) ? String(err.stderr || err.message).slice(0, 2000) : '扫描失败',
        fallback: fallbackAnalysis(gamePath)
      }
    }
  }

  return {
    available: false,
    tool: '',
    hint: '未找到 red4-conflicts.exe。把工具放到游戏根目录或 tools/red4-conflicts.exe 后可做文件级冲突扫描；当前先给出归档清单与 modlist 顺序。',
    fallback: fallbackAnalysis(gamePath)
  }
}
