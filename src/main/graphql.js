/**
 * Nexus Mods 官方 v2 GraphQL：公开查询无需授权，直接用于搜索 / 分类 / 标签 / 分页。
 * 端点：https://api.nexusmods.com/v2/graphql
 */

const ENDPOINT = 'https://api.nexusmods.com/v2/graphql'
const GAME = 'cyberpunk2077'
const GAME_ID = 3333
const TIMEOUT = 15000
const PAGE_LIMIT = 50

const LIST_QUERY = `query ($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) {
  mods(filter: $filter, sort: $sort, offset: $offset, count: $count) {
    totalCount
    nodes {
      modId
      name
      author
      category
      summary
      version
      downloads
      endorsements
      adultContent
      pictureUrl
      thumbnailUrl
      createdAt
      updatedAt
      tags { name }
    }
  }
}`

const SORTS = {
  popular: [{ downloads: { direction: 'DESC' } }],
  recent: [{ updatedAt: { direction: 'DESC' } }],
  name: [{ name: { direction: 'ASC' } }]
}

function tagFilters(tags) {
  const out = []
  tags.forEach((key) => {
    if (key === 'hot') out.push({ downloads: [{ value: 1000000, op: 'GTE' }] })
    if (key === 'liked') out.push({ endorsements: [{ value: 10000, op: 'GTE' }] })
    if (key === 'recent') {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      out.push({ updatedAt: [{ value: since, op: 'GTE' }] })
    }
    if (key === 'adult') out.push({ adultContent: [{ value: true, op: 'EQUALS' }] })
  })
  return out
}

function normalize(node) {
  const id = Number(node.modId)
  if (!id || !node.name) return null
  const updated = node.updatedAt ? String(node.updatedAt).slice(0, 10) : ''
  const created = node.createdAt ? String(node.createdAt).slice(0, 10) : ''
  return {
    id,
    name: node.name,
    author: node.author || '',
    category: node.category || '',
    categoryId: null,
    summary: node.summary || '',
    version: node.version || '',
    downloads: node.downloads || 0,
    endorsements: node.endorsements || 0,
    adult: Boolean(node.adultContent),
    picture: node.pictureUrl || node.thumbnailUrl || '',
    tags: Array.isArray(node.tags) ? node.tags.map((tag) => tag.name).filter(Boolean) : [],
    updated,
    createdAt: created,
    pageUrl: `https://www.nexusmods.com/${GAME}/mods/${id}`
  }
}

async function post(query, variables) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`GraphQL 返回 HTTP ${res.status}`)
    const json = await res.json()
    if (json.errors && json.errors.length) {
      throw new Error(json.errors[0].message || 'GraphQL 查询失败')
    }
    return json.data
  } finally {
    clearTimeout(timer)
  }
}

const DETAIL_QUERY = `query ($modId: ID!, $gameId: ID!) {
  mod(modId: $modId, gameId: $gameId) {
    modId
    name
    summary
    version
    author
    category
    fileSize
    description
    downloads
    endorsements
    adultContent
    createdAt
    updatedAt
    pictureUrl
    tags { name }
  }
}`

const FACET_QUERY = `query {
  mods(
    filter: { gameDomainName: [{ value: "cyberpunk2077" }] }
    facets: { categoryName: [], tag: [] }
    count: 0
  ) {
    totalCount
    facets { facet value count }
  }
}`

function fileSizeLabel(kb) {
  const size = Number(kb) || 0
  if (!size) return ''
  const bytes = size * 1024
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 详情：v2 GraphQL 一次拿全，包含 BBCode 简介与文件体积（KB） */
export async function getModDetailGql(id) {
  const modId = Number(id)
  if (!modId) return { item: null, error: '无效的模组 ID' }
  try {
    const data = await post(DETAIL_QUERY, { modId, gameId: GAME_ID })
    const node = data && data.mod
    if (!node) return { item: null, error: 'Nexus 没有返回该模组' }
    return {
      item: {
        ...normalize(node),
        description: node.description || '',
        fileSize: fileSizeLabel(node.fileSize),
        license: ''
      },
      error: ''
    }
  } catch (err) {
    return { item: null, error: err && err.message ? err.message : '详情加载失败' }
  }
}

const REQUIREMENTS_QUERY = `query ($modId: ID!, $gameId: ID!) {
  mod(modId: $modId, gameId: $gameId) {
    modId
    name
    modRequirements {
      nexusRequirements {
        totalCount
        nodes { modId modName url notes externalRequirement }
      }
    }
  }
}`

/** 批量查询模组最新版本（用于更新校验），一次请求最多 20 个 */
export async function getModVersions(ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 20)
  if (!list.length) return { items: [], error: '' }
  const parts = list
    .map((id) => `m${id}: mod(modId: ${id}, gameId: ${GAME_ID}) { modId name version updatedAt }`)
    .join(' ')
  try {
    const data = await post(`query { ${parts} }`, {})
    const items = list
      .map((id) => data && data[`m${id}`])
      .filter(Boolean)
      .map((node) => ({
        modId: Number(node.modId),
        name: node.name || '',
        version: node.version || '',
        updatedAt: node.updatedAt ? String(node.updatedAt).slice(0, 10) : ''
      }))
    return { items, error: '' }
  } catch (err) {
    return { items: [], error: (err && err.message) || '版本查询失败' }
  }
}

/** 某个模组的前置依赖（Nexus 官方 requirements） */
export async function getModRequirements(id) {
  const modId = Number(id)
  if (!modId) return { requirements: [], error: '无效的模组 ID' }
  try {
    const data = await post(REQUIREMENTS_QUERY, { modId, gameId: GAME_ID })
    const node = data && data.mod
    if (!node) return { requirements: [], error: 'Nexus 没有返回该模组' }
    const page = (node.modRequirements && node.modRequirements.nexusRequirements) || {}
    const requirements = (page.nodes || []).map((item) => ({
      modId: Number(item.modId) || 0,
      name: String(item.modName || ''),
      url: String(item.url || ''),
      notes: String(item.notes || ''),
      external: Boolean(item.externalRequirement)
    }))
    return { requirements, error: '' }
  } catch (err) {
    return { requirements: [], error: (err && err.message) || '前置信息加载失败' }
  }
}

/** 分类与标签的聚合（含数量），用于筛选面板 */
export async function getFacets() {
  try {
    const data = await post(FACET_QUERY, {})
    const page = (data && data.mods) || {}
    const categories = []
    const tags = []
    ;(page.facets || []).forEach((facet) => {
      const entry = { name: facet.value, count: facet.count }
      if (facet.facet === 'categoryName') categories.push(entry)
      else if (facet.facet === 'tag') tags.push(entry)
    })
    categories.sort((a, b) => b.count - a.count)
    tags.sort((a, b) => b.count - a.count)
    return { categories, tags, totalCount: Number(page.totalCount) || 0, error: '' }
  } catch (err) {
    return { categories: [], tags: [], totalCount: 0, error: err && err.message ? err.message : '筛选数据加载失败' }
  }
}

/**
 * 统一的列表查询：关键词 + 分类 + 标签 + 排序 + 分页，全部走服务端。
 */
export async function queryMods({
  text = '',
  categories = [],
  tags = [],
  sort = 'popular',
  offset = 0,
  count = 20
} = {}) {
  const keyword = String(text || '').trim()
  const filter = { gameDomainName: [{ value: GAME }] }

  if (keyword) filter.name = [{ value: keyword, op: 'WILDCARD' }]
  if (categories.length) filter.categoryName = categories.map((name) => ({ value: name }))
  tagFilters(tags).forEach((entry) => Object.assign(filter, entry))

  const sortInput = keyword
    ? [{ relevance: { direction: 'DESC' } }, ...(SORTS[sort] || [])]
    : SORTS[sort] || SORTS.popular

  try {
    const data = await post(LIST_QUERY, {
      filter,
      sort: sortInput,
      offset: Math.max(0, Number(offset) || 0),
      count: Math.min(PAGE_LIMIT, Math.max(1, Number(count) || 20))
    })

    const page = (data && data.mods) || {}
    const items = (page.nodes || []).map(normalize).filter(Boolean)
    return {
      items,
      totalCount: Number(page.totalCount) || items.length,
      error: ''
    }
  } catch (err) {
    return {
      items: [],
      totalCount: 0,
      error: err && err.name === 'AbortError' ? '查询超时' : err.message || '查询失败'
    }
  }
}
