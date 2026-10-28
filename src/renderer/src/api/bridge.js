/**
 * 统一封装 Electron 暴露的 window.modbox。
 * 在纯浏览器里打开时（例如只跑 vite），降级到 localStorage，数据源不可用但界面可调。
 */
const LS_KEY = 'modbox-state'

function readLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY))
    if (parsed && Array.isArray(parsed.favorites) && Array.isArray(parsed.installed)) return parsed
  } catch {
    /* ignore */
  }
  return { favorites: [], installed: [], known: {} }
}

function writeLocal(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state))
  return state
}

const fallback = {
  getState: async () => readLocal(),
  toggleFavorite: async ({ id, item }) => {
    const state = readLocal()
    const known = { ...(state.known || {}) }
    if (item && item.id) known[item.id] = item
    const favorites = state.favorites.includes(id)
      ? state.favorites.filter((value) => value !== id)
      : [...state.favorites, id]
    return writeLocal({ ...state, known, favorites })
  },
  install: async ({ id, version, size, item }) => {
    const state = readLocal()
    const known = { ...(state.known || {}) }
    if (item && item.id) known[item.id] = item
    if (state.installed.some((entry) => entry.id === id)) return state
    return writeLocal({
      ...state,
      known,
      installed: [
        ...state.installed,
        { id, version: version || '', size: size || '', enabled: true, installedAt: Date.now() }
      ]
    })
  },
  uninstall: async (id) => {
    const state = readLocal()
    return writeLocal({ ...state, installed: state.installed.filter((entry) => entry.id !== id) })
  },
  setEnabled: async ({ id, enabled }) => {
    const state = readLocal()
    return writeLocal({
      ...state,
      installed: state.installed.map((entry) =>
        entry.id === id ? { ...entry, enabled: Boolean(enabled) } : entry
      )
    })
  },

  getSettings: async () => ({ hasKey: false, masked: '' }),
  saveApiKey: async () => ({ hasKey: false, masked: '' }),
  queryMods: async () => ({
    items: [],
    totalCount: 0,
    error: '浏览器预览模式下无法访问 Nexus API，请在 Electron 中运行'
  }),
  getFacets: async () => ({ categories: [], tags: [], totalCount: 0, error: '' }),
  getModDetail: async () => ({ item: null, error: '浏览器预览模式下无法访问 Nexus API' }),
  getModImages: async () => ({ images: [], source: 'error', error: '浏览器预览模式下无法访问 Nexus' }),
  translate: async (texts) => ({ texts, failed: texts.length, total: texts.length }),
  translateStatus: async () => ({ ready: false, loading: false, progress: 0, error: '' }),
  prepareTranslateModel: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  clearTranslateModel: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),

  getPaths: async () => ({ gamePath: '', stagingPath: '' }),
  setPaths: async () => ({ gamePath: '', stagingPath: '' }),
  pickDirectory: async () => '',
  getDeployState: async () => ({
    gamePath: '',
    stagingPath: '',
    mods: [],
    deployed: [],
    changes: [],
    preflight: { errors: [], warnings: [] },
    running: false
  }),
  importStaged: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  toggleStaged: async () => ({ mods: [] }),
  removeStaged: async () => ({ mods: [] }),
  reclassifyStaged: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  runDeploy: async () => ({ ok: false, errors: ['浏览器预览模式下不可用'] }),
  undoDeploy: async () => ({ ok: false, removed: [], skipped: [] }),
  resolveChange: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  getDeployChanges: async () => [],
  regenerateModlist: async () => [],
  runRedMod: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  setDeployOrder: async () => ({ legacyOrder: [], redmodOrder: [] }),
  launchGame: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  stopGame: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  getGameStatus: async () => ({ running: false }),

  checkUpdates: async () => ({ items: [], error: '浏览器预览模式下不可用' }),
  updateMod: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),

  addDownload: async () => ({ ok: false }),
  listDownloads: async () => ({ records: [], hideDownloadNotice: false }),
  attachDownload: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  removeDownload: async () => ({ ok: false }),
  hideDownloadNotice: async () => ({ ok: true }),

  loginNexus: async () => true,
  checkLoginStatus: async () => ({ loggedIn: false }),
  downloadNexus: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  extractDownload: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  onDownloadProgress: () => () => {},

  listHistory: async () => ({ files: [] }),
  openHistoryFile: async () => true,
  extractHistoryFile: async () => ({ ok: false, error: '浏览器预览模式下不可用' }),
  deleteHistoryFile: async () => true,

  openModWindow: async () => {},
  minimize: () => {},
  closeWindow: () => {},
  toggleMaximize: () => {},
  isMaximized: async () => false,
  openExternal: async (url) => window.open(url, '_blank'),
  collectLogs: async () => ({ sources: [], error: '浏览器预览模式下不可用' }),
  scanConflicts: async () => ({ available: false, error: '浏览器预览模式下不可用' }),
  onStateChanged: () => () => {},
  onMaximized: () => () => {}
}

export const bridge = typeof window !== 'undefined' && window.modbox ? window.modbox : fallback
export const isElectron = Boolean(typeof window !== 'undefined' && window.modbox)
