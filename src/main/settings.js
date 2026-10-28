import fs from 'fs'
import path from 'path'
import { app } from 'electron'

function settingsFile() {
  return path.join(app.getPath('userData'), 'modbox-settings.json')
}

export function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeSettings(next) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.error('[modbox] 设置写入失败：', err)
  }
  return next
}

export function getApiKey() {
  return String(readSettings().apiKey || '').trim()
}

export function maskKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export function setApiKey(key) {
  const settings = readSettings()
  settings.apiKey = String(key || '').trim()
  writeSettings(settings)
  return { hasKey: Boolean(settings.apiKey), masked: maskKey(settings.apiKey) }
}

export function getKeyStatus() {
  const key = getApiKey()
  return { hasKey: Boolean(key), masked: maskKey(key) }
}

/* ------------------------------ 游戏 / staging 路径 ------------------------------ */

export function getPaths() {
  const settings = readSettings()
  return {
    gamePath: String(settings.gamePath || ''),
    stagingPath: String(settings.stagingPath || ''),
    // 包体（压缩包）下载目录；空 = 使用 userData/mod-packages 默认值
    downloadPath: String(settings.downloadPath || '')
  }
}

export function setPaths({ gamePath, stagingPath, downloadPath }) {
  const settings = readSettings()
  if (typeof gamePath === 'string') settings.gamePath = gamePath
  if (typeof stagingPath === 'string') settings.stagingPath = stagingPath
  if (typeof downloadPath === 'string') settings.downloadPath = downloadPath
  writeSettings(settings)
  return getPaths()
}
