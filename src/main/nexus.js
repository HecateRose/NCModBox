/**
 * NexusMods 公共 API 客户端（v1 REST）。
 * 文档：https://app.swaggerhub.com/apis-docs/NexusMods/nexus-mods_public_api_params_in_form_data/1.0
 * 需要用户在设置里填入个人 API Key。
 */
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import { getApiKey, getKeyStatus } from './settings'

const API_ROOT = 'https://api.nexusmods.com/v1'
const SITE_ROOT = 'https://www.nexusmods.com'
const GAME = 'cyberpunk2077'
const GAME_ID = 3333
const CACHE_TTL = 30 * 60 * 1000
const IMAGES_TTL = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT = 20000
const MAX_ITEMS = 400
const MAX_IMAGES = 30

// 图片页 HTML 里的静态图地址
const IMAGE_URL_RE = new RegExp(
  `^https://staticdelivery\\.nexusmods\\.com/mods/${GAME_ID}/images/\\d+/[A-Za-z0-9._-]+\\.(?:jpe?g|png|webp|gif)$`,
  'i'
)

function cacheFile() {
  return path.join(app.getPath('userData'), 'nexus-cache.json')
}

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(payload) {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify(payload), 'utf8')
  } catch (err) {
    console.error('[modbox] 缓存写入失败：', err)
  }
}

function categoriesFile() {
  return path.join(app.getPath('userData'), 'nexus-categories.json')
}

function readCategoriesCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(categoriesFile(), 'utf8'))
    if (parsed && Array.isArray(parsed.list) && parsed.list.length) return parsed
  } catch {
    /* ignore */
  }
  return null
}

function writeCategoriesCache(list) {
  try {
    fs.writeFileSync(categoriesFile(), JSON.stringify({ list, fetchedAt: Date.now() }), 'utf8')
  } catch (err) {
    console.error('[modbox] 分类缓存写入失败：', err)
  }
}

/** 分类变动很少，缓存 7 天；接口失败时用缓存兜底，避免筛选栏空掉 */
async function loadCategories() {
  const cached = readCategoriesCache()
  if (cached && Date.now() - cached.fetchedAt < 7 * 24 * 3600 * 1000) return cached.list
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await apiGet(`/games/${GAME}/categories.json`)
      const list = (Array.isArray(res) ? res : []).map((item) => ({
        id: item.category_id,
        name: item.name
      }))
      if (list.length) {
        writeCategoriesCache(list)
        return list
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
  return cached ? cached.list : []
}

function imagesFile() {
  return path.join(app.getPath('userData'), 'nexus-images.json')
}

function readImagesCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(imagesFile(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeImagesCache(payload) {
  try {
    fs.mkdirSync(path.dirname(imagesFile()), { recursive: true })
    fs.writeFileSync(imagesFile(), JSON.stringify(payload), 'utf8')
  } catch (err) {
    console.error('[modbox] 图片缓存写入失败：', err)
  }
}

async function apiGet(pathname) {
  const key = getApiKey()
  if (!key) {
    const error = new Error('尚未配置 Nexus API Key')
    error.code = 'NO_KEY'
    throw error
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const res = await fetch(`${API_ROOT}${pathname}`, {
      headers: {
        apikey: key,
        Accept: 'application/json',
        'User-Agent': 'NightCity-Modbox/1.0'
      },
      signal: controller.signal
    })
    if (!res.ok) {
      const error = new Error(
        res.status === 401 || res.status === 403
          ? 'API Key 无效或没有权限'
          : `Nexus API 返回 HTTP ${res.status}`
      )
      error.code = res.status === 401 || res.status === 403 ? 'BAD_KEY' : 'HTTP'
      throw error
    }
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError') {
      const error = new Error('请求超时，请检查网络连接')
      error.code = 'TIMEOUT'
      throw error
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function dayOf(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

function normalize(raw) {
  if (!raw) return null
  const id = raw.mod_id ?? raw.id
  if (!id) return null
  return {
    id: Number(id),
    name: raw.name || '',
    author: raw.author || raw.uploaded_by || '未知作者',
    version: raw.version || '',
    summary: raw.summary || '',
    picture: raw.picture_url || '',
    downloads: raw.mod_downloads ?? 0,
    uniqueDownloads: raw.mod_unique_downloads ?? 0,
    endorsements: raw.endorsements ?? raw.endorsement_count ?? 0,
    updated: dayOf(raw.updated_timestamp),
    createdAt: dayOf(raw.created_timestamp),
    categoryId: raw.category_id ?? null,
    adult: Boolean(raw.contains_adult_content),
    pageUrl: `https://www.nexusmods.com/${GAME}/mods/${id}`
  }
}

function categoryName(categories, id) {
  const hit = categories.find((item) => item.id === id)
  return hit ? hit.name : ''
}

/** 缩略图地址还原成大图，并去掉查询串与重复项 */
function normalizeImageUrls(list) {
  const out = new Set()
  ;(list || []).forEach((raw) => {
    let url = String(raw).split('?')[0]
    url = url.replace('/images/thumbnails/', '/images/')
    if (!IMAGE_URL_RE.test(url)) return
    out.add(url)
  })
  return [...out].slice(0, MAX_IMAGES)
}

function fileSizeLabel(filesPayload) {
  const files = filesPayload && Array.isArray(filesPayload.files) ? filesPayload.files : []
  if (!files.length) return ''
  const main = files.filter((file) => (file.category_name || '').toUpperCase() === 'MAIN')
  const pool = main.length ? main : files
  const bytes = pool.reduce((max, file) => {
    // Nexus 的 size / size_kb 单位都是 KB；个别情况下 size 已是字节
    const raw = Number(file.size_kb ?? file.size ?? 0)
    const size = raw > 50000000 ? raw : raw * 1024
    return size > max ? size : max
  }, 0)
  if (!bytes) return ''
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function mergeKnown(known, item) {
  if (!item || !item.id) return known
  known[item.id] = { ...(known[item.id] || {}), ...item }
  return known
}

/** 过滤空条目：没有名字的（通常是 updated.json 只返回 id）一律不进列表 */
function isUsable(item) {
  if (!item || !item.id) return false
  const name = String(item.name || '').trim()
  return Boolean(name)
}

async function mapLimit(list, limit, worker) {
  const results = []
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await worker(list[index])
      } catch {
        results[index] = null
      }
    }
  })
  await Promise.all(runners)
  return results
}

export async function getCatalog({ force = false } = {}) {
  const status = getKeyStatus()
  if (!status.hasKey) {
    return {
      items: [],
      categories: [],
      known: {},
      pendingIds: [],
      hasMore: false,
      source: 'no-key',
      hasKey: false,
      error: '尚未配置 Nexus API Key',
      fetchedAt: 0
    }
  }

  const cached = readCache()
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    // 旧缓存可能没有分类，补一次
    if (!Array.isArray(cached.categories) || !cached.categories.length) {
      const list = await loadCategories()
      if (list.length) {
        cached.categories = list
        writeCache(cached)
      }
    }
    if (Array.isArray(cached.categories) && cached.categories.length) {
      cached.items.forEach((item) => {
        if (!item.category) item.category = categoryName(cached.categories, item.categoryId)
      })
    }
    return {
      ...cached,
      hasMore: Array.isArray(cached.pendingIds) && cached.pendingIds.length > 0,
      source: 'cache',
      hasKey: true,
      error: ''
    }
  }

  try {
    // v1 API 没有「全站分页搜索」，能拿到的只有这些榜单；用最近一月更新补充样本量
    const [trending, latestAdded, latestUpdated, monthUpdated, fetchedCategories] =
      await Promise.all([
        apiGet(`/games/${GAME}/mods/trending.json`),
        apiGet(`/games/${GAME}/mods/latest_added.json`).catch(() => []),
        apiGet(`/games/${GAME}/mods/latest_updated.json`).catch(() => []),
        apiGet(`/games/${GAME}/mods/updated.json?period=1m`)
          .catch(() => apiGet(`/games/${GAME}/mods/updated.json?period=1w`))
          .catch(() => []),
        loadCategories()
      ])

    const cachedCategories = cached && Array.isArray(cached.categories) ? cached.categories : []
    const categories = fetchedCategories.length ? fetchedCategories : cachedCategories

    const map = new Map()
    const ingest = (list) => {
      if (!Array.isArray(list)) return
      list.forEach((raw) => {
        const item = normalize(raw)
        if (!item) return
        item.category = categoryName(categories, item.categoryId)
        if (!map.has(item.id)) map.set(item.id, item)
      })
    }
    ingest(trending)
    ingest(latestAdded)
    ingest(latestUpdated)
    ingest(monthUpdated)

    if (!map.size) throw new Error('Nexus 没有返回任何模组数据')

    const known = cached ? { ...(cached.known || {}) } : {}
    const items = []
    const pendingIds = []

    ;[...map.values()].forEach((item) => {
      if (isUsable(item)) items.push(item)
      else pendingIds.push(item.id)
    })

    items.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
    items.forEach((item) => mergeKnown(known, item))

    const payload = {
      items: items.slice(0, MAX_ITEMS),
      categories,
      known,
      pendingIds: pendingIds.slice(0, 1200),
      fetchedAt: Date.now()
    }
    writeCache(payload)
    return {
      ...payload,
      hasMore: pendingIds.length > 0,
      source: 'live',
      hasKey: true,
      error: ''
    }
  } catch (err) {
    if (cached) {
      return { ...cached, source: 'stale', hasKey: true, error: err.message }
    }
    return {
      items: [],
      categories: [],
      known: {},
      pendingIds: [],
      hasMore: false,
      source: 'error',
      hasKey: true,
      error: err.message,
      fetchedAt: 0
    }
  }
}

/**
 * 继续加载：updated.json 里只有 ID 的条目，按需补齐名称 / 封面 / 简介。
 * 每次最多抓 20 条，详情接口并发 5。
 */
export async function loadMoreCatalog(count = 20) {
  const cached = readCache()
  if (!cached) return { items: [], hasMore: false, remaining: 0, error: '缓存已失效，请先刷新列表' }
  if (!getKeyStatus().hasKey) {
    return { items: [], hasMore: false, remaining: 0, error: '尚未配置 Nexus API Key' }
  }

  const knownIds = new Set(cached.items.map((item) => item.id))
  const pending = (cached.pendingIds || [])
    .filter((id) => !knownIds.has(id))
    .slice(0, Math.max(1, Math.min(50, count)))

  if (!pending.length) {
    return { items: [], hasMore: false, remaining: 0, error: '' }
  }

  const categories =
    cached.categories && cached.categories.length ? cached.categories : await loadCategories()
  const fetched = await mapLimit(pending, 5, async (id) => {
    const detail = await apiGet(`/games/${GAME}/mods/${id}.json`)
    const item = normalize(detail)
    if (!item) return null
    item.category = detail.category_name || categoryName(categories, item.categoryId)
    return item
  })

  const added = fetched.filter(isUsable)
  const usedIds = new Set([...knownIds, ...pending])
  const remainingIds = (cached.pendingIds || []).filter((id) => !usedIds.has(id))
  const known = cached.known || {}

  added.forEach((item) => mergeKnown(known, item))

  writeCache({
    ...cached,
    items: [...cached.items, ...added].slice(0, 800),
    pendingIds: remainingIds,
    known
  })

  return { items: added, hasMore: remainingIds.length > 0, remaining: remainingIds.length, error: '' }
}

export async function getModDetail(id) {
  const numericId = Number(id)
  if (!numericId) return { item: null, error: '无效的模组 ID' }

  const cached = readCache()
  const fallback = cached && cached.known ? cached.known[numericId] : null

  try {
    const [detail, files] = await Promise.all([
      apiGet(`/games/${GAME}/mods/${numericId}.json`),
      apiGet(`/games/${GAME}/mods/${numericId}/files.json`).catch(() => null)
    ])

    const item = normalize(detail)
    if (!item) throw new Error('Nexus 返回的数据无法解析')

    item.category = detail.category_name || (fallback && fallback.category) || ''
    item.description = detail.description || ''
    item.fileSize = fileSizeLabel(files)
    item.license = detail.license || ''
    item.adult = Boolean(detail.contains_adult_content)

    if (cached) {
      cached.known = mergeKnown(cached.known || {}, item)
      writeCache(cached)
    }

    return { item, source: 'live' }
  } catch (err) {
    if (fallback) return { item: fallback, source: 'cache', error: err.message }
    return { item: null, source: 'error', error: err.message }
  }
}

/**
 * 图集：v1 API 不提供 Images 页数据，这里读取站点图片页 HTML 里的静态图地址。
 * 结果按模组缓存 6 小时；被风控拦截时回退缓存并给出提示。
 */
export async function getModImages(id) {
  const numericId = Number(id)
  if (!numericId) return { images: [], source: 'error', error: '无效的模组 ID' }

  const cache = readImagesCache()
  const hit = cache[numericId]
  if (hit && Array.isArray(hit.images) && Date.now() - hit.fetchedAt < IMAGES_TTL) {
    return { images: hit.images, source: 'cache', error: '' }
  }

  let win = null
  try {
    // Cloudflare 会拦普通请求，用屏幕外的真实窗口加载页面后再读取图片地址
    win = new BrowserWindow({
      show: true,
      x: -3200,
      y: 0,
      skipTaskbar: true,
      frame: false,
      width: 1440,
      height: 1000,
      webPreferences: { backgroundThrottling: false }
    })

    // Cloudflare 挑战页可能让 loadURL 长时间不返回，这里等 DOM 就绪后直接轮询
    win.loadURL(`${SITE_ROOT}/${GAME}/mods/${numericId}?tab=images`).catch(() => {})
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 10000)
      win.webContents.once('dom-ready', () => {
        clearTimeout(timer)
        resolve()
      })
      win.webContents.once('did-fail-load', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    let images = []
    for (let round = 0; round < 6; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const urls = await Promise.race([
        new Promise((resolve) => setTimeout(() => resolve([]), 4000)),
        win.webContents
        .executeJavaScript(
          `(() => {
            const set = new Set()
            document.querySelectorAll('img').forEach((el) => {
              const values = [el.currentSrc, el.src, el.getAttribute('data-src'), el.getAttribute('srcset')]
              values.forEach((value) => {
                if (!value) return
                String(value).split(',').forEach((part) => {
                  const url = part.trim().split(' ')[0]
                  if (url && url.includes('/mods/3333/images/')) set.add(url)
                })
              })
            })
            document.querySelectorAll('a[href]').forEach((a) => {
              if (a.href.includes('/mods/3333/images/')) set.add(a.href)
            })
            window.scrollBy(0, 600)
            return Array.from(set)
          })()`
          )
          .catch(() => [])
      ])
      images = normalizeImageUrls(urls)
      if (images.length) break
    }

    if (!images.length) throw new Error('图片页没有可读取的图片')

    writeImagesCache({ ...cache, [numericId]: { images, fetchedAt: Date.now() } })
    return { images, source: 'live', error: '' }
  } catch (err) {
    if (hit && Array.isArray(hit.images) && hit.images.length) {
      return { images: hit.images, source: 'cache', error: err.message }
    }
    return { images: [], source: 'error', error: err.message }
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}

/** 分类列表（缓存 7 天），供筛选面板使用 */
export async function getCategories() {
  return loadCategories()
}

/** 截图工具用：取缓存里的第一个模组 ID */
export function getFirstModId() {
  const cached = readCache()
  if (!cached || !Array.isArray(cached.items) || !cached.items.length) return null
  return cached.items[0].id
}

export function rememberItem(item) {
  if (!item || !item.id) return
  const cached = readCache()
  if (!cached) return
  cached.known = mergeKnown(cached.known || {}, item)
  writeCache(cached)
}
