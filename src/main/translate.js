/**
 * 翻译（纯本地离线）：默认 opus-mt 英中快速模型，非中文目标时用 NLLB 多语言模型。
 * 结果按文本哈希缓存到本地；模型未就绪时返回明确原因，由设置在设置里下载。
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import { translateWithLocal } from './localTranslate'

function cacheFile() {
  return path.join(app.getPath('userData'), 'translate-cache.json')
}

let memory = null

function readCache() {
  if (memory) return memory
  try {
    memory = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) || {}
  } catch {
    memory = {}
  }
  return memory
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify(memory), 'utf8')
  } catch (err) {
    console.error('[modbox] 翻译缓存写入失败：', err)
  }
}

function hash(text, target) {
  return crypto.createHash('sha1').update(`${target}|${text}`).digest('hex').slice(0, 20)
}

export async function translateTexts(texts, target = 'zh-CN') {
  const list = Array.isArray(texts) ? texts : []
  const cache = readCache()
  const out = new Array(list.length).fill('')
  const pending = []

  // 1) 先命中缓存，收集需要翻译的文本
  list.forEach((text, index) => {
    const value = String(text || '')
    if (!value.trim()) {
      out[index] = value
      return
    }
    const hit = cache[hash(value, target)]
    if (hit && hit.v) {
      out[index] = hit.v
      return
    }
    pending.push({ index, text: value })
  })

  if (!pending.length) {
    return { texts: out, failed: 0, total: list.length, reason: '', engine: 'local' }
  }

  // 2) 本地模型翻译（translateWithLocal 内部会在需要时加载/下载模型）
  const local = await translateWithLocal(
    pending.map((item) => item.text),
    target
  )
  if (!local.ok) {
    return {
      texts: out,
      failed: pending.length,
      total: list.length,
      reason: local.error || '本地翻译失败，请在设置里检查翻译模型',
      engine: 'local'
    }
  }

  let failed = 0
  pending.forEach((item, index) => {
    const value = (local.results && local.results[index]) || ''
    if (value) {
      cache[hash(item.text, target)] = { v: value, t: Date.now() }
      out[item.index] = value
    } else {
      out[item.index] = ''
      failed += 1
    }
  })
  saveCache()

  return {
    texts: out,
    failed,
    total: list.length,
    reason: failed ? '部分文本本地翻译失败' : '',
    engine: 'local'
  }
}
