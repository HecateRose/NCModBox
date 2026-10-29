import { computed, reactive, ref, watch } from 'vue'
import { bridge } from '../api/bridge'
import { sizeToMb } from '../utils/format'

export const state = reactive({
  ready: false,
  loading: false,
  source: 'graphql',
  error: '',
  fetchedAt: 0,

  items: [],
  total: 0,
  page: 1,
  limit: 10,
  facetCategories: [],
  facetTags: [],
  known: {},

  favorites: [],
  installed: [],
  downloads: [],
  // 下载文件夹里真实存在的包体（「下载历史」计数只看这个）
  historyFiles: [],
  hideDownloadNotice: false,
  downloading: {},

  query: '',
  sort: 'popular',
  selectedCategories: [],
  selectedTags: [],

  showTranslation: false,
  translations: {},
  translationPending: false,
  translateReason: '',

  auth: { loggedIn: false, checking: false },

  deploy: {
    gamePath: '',
    stagingPath: '',
    stagingIsDefault: false,
    gameVersion: '',
    redmod: null,
    legacyOrder: [],
    redmodOrder: [],
    mods: [],
    deployed: [],
    changes: [],
    dependencies: { missing: [], checked: [] },
    modRequirements: { missing: [] },
    preflight: { errors: [], warnings: [] },
    running: false,
    loading: false
  },

  hasKey: false,
  keyMasked: ''
})

const timers = new Map()

function applyRemote(remote) {
  if (!remote) return
  state.favorites = Array.isArray(remote.favorites) ? remote.favorites.map(Number) : []
  state.installed = Array.isArray(remote.installed) ? remote.installed : []
  // state.downloads 依赖 archiveExists / deployed / stagedTypes 等派生字段，
  // 由 refreshDownloads() 统一计算；这里拿原始记录覆盖会让整页退化成「未预留」。
  // 仅在尚未加载过时用原始记录兜底。
  if (!state.downloads.length && Array.isArray(remote.downloads) && remote.downloads.length) {
    state.downloads = remote.downloads
  }
  state.hideDownloadNotice = Boolean(remote.hideDownloadNotice)
  if (remote.known && typeof remote.known === 'object') {
    state.known = { ...state.known, ...remote.known }
  }
}

export async function initModStore() {
  if (state.ready) return
  const [remote, settings] = await Promise.all([bridge.getState(), bridge.getSettings()])
  applyRemote(remote)
  state.hasKey = Boolean(settings.hasKey)
  state.keyMasked = settings.masked || ''
  state.ready = true
  bridge.onStateChanged((remote) => {
    applyRemote(remote)
    // 广播只带原始 state，派生字段需要重新算一遍
    refreshDownloads().catch(() => {})
    refreshHistory().catch(() => {})
  })

  watch(
    [
      () => state.query,
      () => state.sort,
      () => state.selectedCategories,
      () => state.selectedTags,
      () => state.limit
    ],
    () => {
      clearTimeout(watchTimer)
      watchTimer = setTimeout(() => fetchPage(1), 260)
    }
  )

  await Promise.all([fetchFacets(), fetchPage(1), refreshDeploy(), refreshDownloads(), refreshHistory()])
  checkAuth()
  bridge.onDownloadProgress((progress) => {
    if (!progress || !progress.modId) return
    state.downloading[progress.modId] = {
      percent: progress.percent,
      phase: progress.phase || '',
      error: progress.error || '',
      done: Boolean(progress.done)
    }
  })
}

/** 登录态探测（Cookie 已持久化，登录一次长期有效） */
export async function checkAuth() {
  state.auth.checking = true
  try {
    const result = await bridge.checkLoginStatus()
    state.auth.loggedIn = Boolean(result && result.loggedIn)
  } catch {
    state.auth.loggedIn = false
  } finally {
    state.auth.checking = false
  }
}

export async function openNexusLogin() {
  await bridge.loginNexus()
  // 登录窗口关闭后自动复查，最多等 5 分钟
  for (let attempt = 0; attempt < 75; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4000))
    await checkAuth()
    if (state.auth.loggedIn) return
  }
}

/** 一键下载：登记记录 → 真实下载 → 自动解压进 staging */
/** 一键下载：把登录态交给主进程判断 → 打开 mod 文件页 → 用户点 Manual → 程序接管落盘与解压 */
export async function startNexusDownload(mod) {
  // 不再用前端缓存的登录态做预判（启动探测可能还没完成，会先弹一次登录窗口）
  state.downloading[mod.id] = { percent: 0, phase: '准备下载' }
  try {
    // 列表项是 Vue 响应式代理，直接过 IPC 会克隆失败；统一转成纯值再传
    const payload = JSON.parse(JSON.stringify(mod))
    const result = await bridge.downloadNexus(payload)
    if (result && result.needsLogin) {
      await bridge.loginNexus()
      await checkAuth()
    }
    return result
  } catch (err) {
    return { ok: false, error: (err && err.message) || '下载请求失败（IPC 错误）' }
  } finally {
    delete state.downloading[mod.id]
    await Promise.all([refreshDownloads(), refreshDeploy()])
  }
}

/** 手动解压已下载但不是 zip 的包体 */
export async function extractDownload(recordId) {
  const result = await bridge.extractDownload(recordId)
  await Promise.all([refreshDownloads(), refreshDeploy()])
  return result
}

let watchTimer = null

/** 分类与标签：来自 v2 GraphQL 的 facets 聚合（含数量） */
export async function fetchFacets() {
  try {
    const result = await bridge.getFacets()
    if (Array.isArray(result.categories)) state.facetCategories = result.categories
    if (Array.isArray(result.tags)) state.facetTags = result.tags
  } catch {
    /* 拿不到不影响列表 */
  }
}

/** 统一的列表请求：关键词 / 分类 / 标签 / 排序 / 分页都走服务端 */
export async function fetchPage(page = 1) {
  const target = Math.max(1, Number(page) || 1)
  state.loading = true
  state.error = ''
  try {
    // 只用纯值传参，避免 Vue 响应式代理无法结构化克隆
    const result = await bridge.queryMods({
      text: String(state.query || ''),
      categories: state.selectedCategories.slice(),
      tags: state.selectedTags.slice(),
      sort: String(state.sort || 'popular'),
      offset: (target - 1) * state.limit,
      count: state.limit
    })
    state.items = Array.isArray(result.items) ? result.items : []
    state.total = Number(result.totalCount) || 0
    state.page = target
    state.error = result.error || ''
    const known = { ...state.known }
    state.items.forEach((item) => {
      known[item.id] = { ...(known[item.id] || {}), ...item }
    })
    state.known = known
    if (typeof result.hasKey === 'boolean') state.hasKey = result.hasKey
  } catch (err) {
    state.items = []
    state.total = 0
    state.error = err && err.message ? err.message : '列表加载失败'
  } finally {
    state.loading = false
  }
}

export async function goToPage(page) {
  const target = Math.max(1, Math.min(pageCount.value, Number(page) || 1))
  if (target === state.page && state.items.length) return
  await fetchPage(target)
}

export const pageCount = computed(() =>
  Math.max(1, Math.ceil((state.total || 0) / Math.max(1, state.limit)))
)

export const hasNextPage = computed(() => state.page < pageCount.value)

export async function refreshCatalog() {
  await Promise.all([fetchFacets(), fetchPage(state.page)])
}

export async function saveApiKey(key) {
  const status = await bridge.saveApiKey(key)
  state.hasKey = Boolean(status.hasKey)
  state.keyMasked = status.masked || ''
  if (status.hasKey) await refreshCatalog()
  return status
}

/* ------------------------------ 收藏 / 安装 ------------------------------ */

export function isFavorite(id) {
  return state.favorites.includes(Number(id))
}

const plain = (value) => JSON.parse(JSON.stringify(value))

export async function toggleFavorite(mod) {
  if (!mod) return false
  applyRemote(await bridge.toggleFavorite({ id: Number(mod.id), item: plain(mod) }))
  return isFavorite(mod.id)
}

export function installedEntry(id) {
  return state.installed.find((entry) => entry.id === Number(id))
}

export function isInstalled(id) {
  return Boolean(installedEntry(id))
}

export function downloadProgress(id) {
  const value = state.downloading[id]
  return value === undefined ? null : Math.round(value)
}

/** 模拟下载进度：真实部署需要读写游戏目录，这里只维护安装状态 */
export function installMod(mod) {
  if (!mod || state.downloading[mod.id] !== undefined || isInstalled(mod.id)) {
    return Promise.resolve(false)
  }
  state.downloading[mod.id] = 0

  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      const current = state.downloading[mod.id]
      if (current === undefined) {
        clearInterval(timer)
        timers.delete(mod.id)
        resolve(false)
        return
      }
      const next = Math.min(100, current + 6 + Math.random() * 16)
      if (next >= 100) {
        clearInterval(timer)
        timers.delete(mod.id)
        delete state.downloading[mod.id]
        applyRemote(
          await bridge.install({
            id: mod.id,
            version: mod.version || '',
            size: mod.fileSize || '',
            item: plain(mod)
          })
        )
        resolve(true)
        return
      }
      state.downloading[mod.id] = next
    }, 220)
    timers.set(mod.id, timer)
  })
}

export async function uninstallMod(id) {
  applyRemote(await bridge.uninstall(id))
}

export async function setEnabled(id, enabled) {
  applyRemote(await bridge.setEnabled({ id, enabled }))
}

/* ------------------------------ 本地列表（收藏 / 已安装） ------------------------------ */

export function resolveMod(id) {
  const key = Number(id)
  return state.known[key] || state.items.find((item) => item.id === key) || null
}

export const categoryOptions = computed(() => state.facetCategories)

export const tagOptions = computed(() => state.facetTags)

export function toggleCategoryFilter(name) {
  const list = state.selectedCategories
  state.selectedCategories = list.includes(name)
    ? list.filter((item) => item !== name)
    : [...list, name]
}

export function toggleTagFilter(key) {
  const list = state.selectedTags
  state.selectedTags = list.includes(key)
    ? list.filter((item) => item !== key)
    : [...list, key]
}

export function clearFilters() {
  state.selectedCategories = []
  state.selectedTags = []
}

export function tagLabel(name) {
  return name
}

export function categoryFilterLabel(name) {
  return name
}

/** 搜索：关键词已绑定在 state.query，这里直接重新请求第一页 */
export async function searchNow() {
  await fetchPage(1)
}

export async function exitSearch() {
  state.query = ''
  await fetchPage(1)
}

export function useModList(scope) {
  return computed(() => {
    if (scope === 'favorites') {
      return state.favorites.map((id) => resolveMod(id)).filter(Boolean)
    }
    return state.installed
      .map((entry) => {
        const known = resolveMod(entry.id)
        if (!known) return { id: entry.id, name: `模组 #${entry.id}`, summary: '', author: '' }
        return { ...known, version: entry.version || known.version }
      })
      .filter(Boolean)
  })
}

/** 收藏 / 已安装这类本地列表：按每页条数切片 */
export function useLocalPager(scope) {
  const list = useModList(scope)
  const page = ref(1)

  const total = computed(() => list.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / state.limit)))
  const shown = computed(() => {
    const start = (page.value - 1) * state.limit
    return list.value.slice(start, start + state.limit)
  })

  watch(
    [total, () => state.limit],
    () => {
      if (page.value > pageCount.value) page.value = pageCount.value
    },
    { immediate: true }
  )

  async function goToPage(target) {
    page.value = Math.max(1, Math.min(pageCount.value, Number(target) || 1))
  }

  return { list, shown, total, page, pageCount, goToPage, loading: computed(() => false) }
}

/* ------------------------------ 翻译（列表 / 分类 / 标签） ------------------------------ */

/** 取译文，未开启或未翻译时返回原文 */
export function tr(text) {
  if (!state.showTranslation || !text) return text
  return state.translations[text] || text
}

/** 批量翻译并缓存，失败会写回原文避免反复请求 */
export async function ensureTranslations(list) {
  const targets = [...new Set((list || []).map((item) => String(item || '').trim()))].filter(
    (text) => text && !(text in state.translations)
  )
  if (!targets.length) return

  // 本地模型是 CPU 推理，长文本很慢：分批请求，每批回来就写状态，界面渐进显示
  const CHUNK = 5
  const MAX = 40
  state.translationPending = true
  let failures = 0
  try {
    for (let start = 0; start < Math.min(targets.length, MAX); start += CHUNK) {
      const batch = targets.slice(start, start + CHUNK)
      try {
        const result = await bridge.translate(batch, 'zh-CN')
        batch.forEach((text, index) => {
          const value = result && result.texts ? result.texts[index] : ''
          state.translations[text] = value || text
        })
        state.translateReason = (result && result.reason) || ''
        failures = 0
      } catch {
        failures += 1
        batch.forEach((text) => {
          state.translations[text] = text
        })
        state.translateReason = '翻译服务连接失败'
        if (failures >= 2) break
      }
    }
  } finally {
    state.translationPending = false
  }
}

/** 主页翻译总开关：列表简介 + 分类名 */
export async function toggleTranslation() {
  state.showTranslation = !state.showTranslation
  if (!state.showTranslation) return
  await ensureTranslations([
    ...state.items.map((item) => item.summary),
    ...state.facetCategories.map((item) => item.name)
  ])
}

// 翻页或筛选后，已开启翻译则补翻新出现的简介
watch(
  () => state.items,
  (items) => {
    if (!state.showTranslation) return
    ensureTranslations(items.map((item) => item.summary))
  }
)

/* ------------------------------ 已下载（包体） ------------------------------ */

export async function refreshHistory() {
  try {
    const data = await bridge.listHistory()
    state.historyFiles = (data && data.files) || []
  } catch {
    state.historyFiles = []
  }
}

/** 校验所有下载记录在 Nexus 上的最新版本 */
export async function checkModUpdates() {
  return bridge.checkUpdates()
}

/** 下载新版本并自动替换 staging / 重新部署 */
export async function updateMod(recordId) {
  const result = await bridge.updateMod(recordId)
  await Promise.all([refreshDownloads(), refreshDeploy()])
  return result
}

export async function refreshDownloads() {
  const data = await bridge.listDownloads()
  state.downloads = (data && data.records) || []
  state.hideDownloadNotice = Boolean(data && data.hideDownloadNotice)
}

export async function addDownloadRecord(item) {
  await bridge.addDownload(item)
  await refreshDownloads()
}

export async function attachDownload(recordId) {
  const result = await bridge.attachDownload(recordId)
  await Promise.all([refreshDownloads(), refreshDeploy()])
  return result
}

export async function removeDownloadRecord(recordId) {
  const result = await bridge.removeDownload(recordId)
  // 删除记录会联动移除绑定的 staging Mod（已部署的会先撤销），所以部署页也要刷新
  await Promise.all([refreshDownloads(), refreshDeploy()])
  return result
}

export async function hideDownloadNotice() {
  await bridge.hideDownloadNotice(true)
  state.hideDownloadNotice = true
}

export const downloadIds = computed(() => new Set(state.downloads.map((record) => record.modId)))

/** 某个模组的包体记录（downloads 按 modId 查） */
export function downloadRecordFor(id) {
  return state.downloads.find((record) => record.modId === Number(id))
}

/** 本地是否有该模组的包体记录（旧的 state.installed 已废弃，不再参与判断） */
export function isDownloaded(id) {
  return Boolean(downloadRecordFor(id))
}

/** 是否已部署：包体记录绑定到 staging，且该 staging Mod 在部署 manifest 里 */
export function isDeployed(id) {
  const record = downloadRecordFor(id)
  if (!record || !record.stagedId) return false
  return state.deploy.deployed.some((entry) => entry.stagedModId === record.stagedId)
}

/* ------------------------------ 诊断 ------------------------------ */

/** 收集游戏日志（主进程读取，渲染层只负责展示） */
export async function collectLogs(payload) {
  return bridge.collectLogs(payload || {})
}

/** 冲突扫描（有 red4-conflicts.exe 时调用工具，否则降级为静态分析） */
export async function scanConflicts() {
  return bridge.scanConflicts()
}

/* ------------------------------ 部署 ------------------------------ */

/** 轻量刷新游戏运行状态（轮询用，不拉全量部署状态） */
export async function refreshGameStatus() {
  try {
    const status = await bridge.gameStatus()
    state.deploy.running = Boolean(status && status.running)
  } catch {
    /* 忽略偶发失败 */
  }
}

export async function refreshDeploy() {
  state.deploy.loading = true
  try {
    const data = await bridge.getDeployState()
    Object.assign(state.deploy, data || {})
  } finally {
    state.deploy.loading = false
  }
  // 外部变更需要逐条 stat，异步补上，不阻塞首屏渲染
  refreshDeployChanges()
}

/** 只刷新外部变更（慢操作，异步补） */
export async function refreshDeployChanges() {
  try {
    const changes = await bridge.getDeployChanges()
    if (Array.isArray(changes)) state.deploy.changes = changes
  } catch {
    /* 忽略 */
  }
}

export async function importStagedMod() {
  const result = await bridge.importStaged()
  if (result.ok) await refreshDeploy()
  return result
}

export async function toggleStagedMod(id, enabled) {
  await bridge.toggleStaged({ id, enabled })
  await refreshDeploy()
}

export async function reclassifyStaged(id) {
  const result = await bridge.reclassifyStaged(id)
  await refreshDeploy()
  return result
}

export async function removeStagedMod(id) {
  await bridge.removeStaged(id)
  await refreshDeploy()
}

export async function runDeploy(modIds) {
  const result = await bridge.runDeploy(Array.isArray(modIds) && modIds.length ? { modIds } : {})
  await refreshDeploy()
  return result
}

export async function undoDeploy(modIds) {
  const result = await bridge.undoDeploy(Array.isArray(modIds) && modIds.length ? { modIds } : {})
  await refreshDeploy()
  return result
}

/** 处理一条外部变更：accept=接受外部状态，restore=恢复 staging 状态 */
export async function resolveChange(payload) {
  const result = await bridge.resolveChange(payload)
  await refreshDeploy()
  return result
}

/** 自动排序 Legacy archive：按 Mod 分组重排加载顺序 */
export async function autoSortDeploy() {
  const result = await bridge.autoSortDeploy()
  await refreshDeploy()
  return result
}

/** 健康检查：检查 staging/部署/缓存/框架等常见问题 */
export async function checkHealth() {
  return bridge.healthCheck()
}

/** 全量重新部署：撤销当前部署后按当前列表整体重建（Vortex 式） */
export async function redeployAll() {
  const result = await bridge.redeployAll()
  await refreshDeploy()
  return result
}

/** 批量处理全部外部变更：accept=全部接受，restore=全部恢复 */
export async function resolveAllChanges(action = 'accept') {
  const result = await bridge.resolveAllChanges({ action })
  await refreshDeploy()
  return result
}

/** 已部署的 Legacy archive（按用户排序，未排序的按字母序排在后面） */
export const legacyOrderList = computed(() => {
  const map = new Map()
  state.deploy.deployed
    .filter(
      (entry) =>
        entry.linkType !== 'copy' && /^archive\/pc\/mod\/.+\.archive$/i.test(entry.deployedPath)
    )
    .forEach((entry) => {
      const name = entry.deployedPath.split('/').pop()
      if (name && !map.has(name)) map.set(name, { name, mod: entry.modName })
    })
  const order = state.deploy.legacyOrder || []
  return [...map.values()].sort((a, b) => {
    const ia = order.indexOf(a.name)
    const ib = order.indexOf(b.name)
    if (ia < 0 && ib < 0) return a.name.localeCompare(b.name)
    if (ia < 0) return 1
    if (ib < 0) return -1
    return ia - ib
  })
})

/** 已部署的 REDmod 目录（始终在 archive 之后加载） */
export const redmodOrderList = computed(() => {
  const map = new Map()
  state.deploy.deployed
    .filter((entry) => entry.linkType === 'copy')
    .forEach((entry) => {
      const slug = entry.deployedPath.split('/')[1]
      if (slug && !map.has(slug)) map.set(slug, { slug, mod: entry.modName })
    })
  const order = state.deploy.redmodOrder || []
  return [...map.values()].sort((a, b) => {
    const ia = order.indexOf(a.slug)
    const ib = order.indexOf(b.slug)
    if (ia < 0 && ib < 0) return a.slug.localeCompare(b.slug)
    if (ia < 0) return 1
    if (ib < 0) return -1
    return ia - ib
  })
})

export async function setDeployOrder(kind, order) {
  await bridge.setDeployOrder({ kind, order })
  await refreshDeploy()
}

export async function rerunRedMod() {
  const result = await bridge.runRedMod()
  await refreshDeploy()
  return result
}

export async function launchGame() {
  const result = await bridge.launchGame()
  // 进程启动需要一点时间，稍后再刷新一次运行状态
  setTimeout(() => refreshDeploy().catch(() => {}), 2500)
  await refreshDeploy()
  return result
}

/** 强制结束游戏进程（卡在错误弹窗或崩溃残留时用） */
export async function stopGame() {
  const result = await bridge.stopGame()
  setTimeout(() => refreshDeploy().catch(() => {}), 1500)
  await refreshDeploy()
  return result
}

export async function savePaths(payload) {
  const paths = await bridge.setPaths(payload)
  await refreshDeploy()
  return paths
}

export function pickDirectory() {
  return bridge.pickDirectory()
}

export const deployedCount = computed(() => state.deploy.deployed.length)
export const stagedCount = computed(() => state.deploy.mods.length)

export const installedSize = computed(() =>
  state.installed.reduce((sum, entry) => sum + sizeToMb(entry.size), 0)
)
