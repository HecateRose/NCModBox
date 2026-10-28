/**
 * 诊断日志聚合（需求文档 §8.1 第一阶段）：
 * 只负责把分散的日志文件读出来、按级别高亮 ERROR / WARNING / FAILED，不解析具体格式。
 */
import fs from 'fs'
import path from 'path'

const MAX_READ = 400 // 每个源最多读取的行数

/** 逐行判定级别（仅用于高亮） */
function detectLevel(line) {
  const text = String(line || '')
  if (/\[ERROR\]|\bERROR\b|\bEXCEPTION\b|\bFATAL\b|failed to|\bFAILED\b/i.test(text)) return 'error'
  if (/\[WARN(ING)?\]|\bWARNING\b|\bWARN\b/i.test(text)) return 'warn'
  return 'info'
}

function readTail(file, maxLines) {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return null
    const raw = fs.readFileSync(file, 'utf8')
    const all = raw.split(/\r?\n/)
    const tail = all.slice(-Math.max(1, maxLines))
    return {
      size: stat.size,
      mtime: stat.mtimeMs,
      lines: tail.map((text, index) => ({ n: all.length - tail.length + index + 1, text, level: detectLevel(text) }))
    }
  } catch {
    return null
  }
}

function listLogFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.log$/i.test(name))
      .map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

/** 收集所有已知日志源 */
export function collectLogs(gamePath, { maxLines = MAX_READ } = {}) {
  if (!gamePath) return { sources: [], error: '尚未设置游戏目录' }
  const files = []

  const push = (label, file) => {
    if (!fs.existsSync(file)) return
    const data = readTail(file, maxLines)
    if (!data) return
    files.push({ key: label, label, path: file, ...data })
  }

  // 1) r6/logs（redscript 编译日志等）
  listLogFiles(path.join(gamePath, 'r6', 'logs')).forEach((file) => {
    push(path.basename(file, '.log'), file)
  })

  // 2) CET 日志
  push(
    'Cyber Engine Tweaks',
    path.join(gamePath, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'cyber_engine_tweaks.log')
  )

  // 3) RED4ext 日志
  listLogFiles(path.join(gamePath, 'red4ext', 'logs')).forEach((file) => {
    push('RED4ext · ' + path.basename(file, '.log'), file)
  })

  // 4) RedHotTools 日志（几种常见布局）
  ;[
    path.join(gamePath, 'red4ext', 'plugins', 'RedHotTools', 'logs'),
    path.join(gamePath, 'red4ext', 'plugins', 'RedHotTools')
  ].forEach((dir) => {
    listLogFiles(dir).forEach((file) => push('RedHotTools · ' + path.basename(file, '.log'), file))
  })

  // 5) 游戏根目录下的 .log
  listLogFiles(gamePath).forEach((file) => push('游戏根 · ' + path.basename(file, '.log'), file))

  // 排序：最近修改的在前
  files.sort((a, b) => b.mtime - a.mtime)

  // 统计
  let errorCount = 0
  let warnCount = 0
  files.forEach((source) => {
    source.lines.forEach((line) => {
      if (line.level === 'error') errorCount += 1
      if (line.level === 'warn') warnCount += 1
    })
  })

  return { sources: files, errorCount, warnCount, error: '' }
}
