import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('state:get'),
  toggleFavorite: (payload) => ipcRenderer.invoke('state:favorite', payload),
  install: (payload) => ipcRenderer.invoke('state:install', payload),
  uninstall: (id) => ipcRenderer.invoke('state:uninstall', id),
  setEnabled: (payload) => ipcRenderer.invoke('state:set-enabled', payload),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveApiKey: (key) => ipcRenderer.invoke('settings:save-key', key),
  queryMods: (payload) => ipcRenderer.invoke('mods:query', payload),
  getFacets: () => ipcRenderer.invoke('mods:facets'),
  translate: (texts, target) => ipcRenderer.invoke('translate:batch', { texts, target }),
  translateStatus: () => ipcRenderer.invoke('translate:status'),
  prepareTranslateModel: () => ipcRenderer.invoke('translate:prepare'),
  clearTranslateModel: () => ipcRenderer.invoke('translate:clear'),
  getModDetail: (id) => ipcRenderer.invoke('mod:detail', id),
  getModImages: (id) => ipcRenderer.invoke('mod:images', id),

  getPaths: () => ipcRenderer.invoke('paths:get'),
  setPaths: (payload) => ipcRenderer.invoke('paths:set', payload),
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),

  getDeployState: () => ipcRenderer.invoke('deploy:state'),
  importStaged: () => ipcRenderer.invoke('deploy:import'),
  toggleStaged: (payload) => ipcRenderer.invoke('deploy:toggle', payload),
  removeStaged: (id) => ipcRenderer.invoke('deploy:remove', id),
  reclassifyStaged: (id) => ipcRenderer.invoke('deploy:reclassify', id),
  runDeploy: (payload) => ipcRenderer.invoke('deploy:run', payload || {}),
  undoDeploy: (payload) => ipcRenderer.invoke('deploy:undo', payload || {}),
  resolveChange: (payload) => ipcRenderer.invoke('deploy:resolve-change', payload),
  resolveAllChanges: (payload) => ipcRenderer.invoke('deploy:resolve-all', payload),
  getDeployChanges: () => ipcRenderer.invoke('deploy:changes'),
  regenerateModlist: () => ipcRenderer.invoke('deploy:modlist'),
  runRedMod: () => ipcRenderer.invoke('deploy:redmod'),
  setDeployOrder: (payload) => ipcRenderer.invoke('deploy:order', payload),

  launchGame: () => ipcRenderer.invoke('game:launch'),
  stopGame: () => ipcRenderer.invoke('game:stop'),
  getGameStatus: () => ipcRenderer.invoke('game:status'),

  checkUpdates: () => ipcRenderer.invoke('mods:check-updates'),
  updateMod: (recordId) => ipcRenderer.invoke('download:update', recordId),

  addDownload: (item) => ipcRenderer.invoke('download:add', item),
  listDownloads: () => ipcRenderer.invoke('download:list'),
  attachDownload: (recordId) => ipcRenderer.invoke('download:attach', recordId),
  removeDownload: (recordId) => ipcRenderer.invoke('download:remove', recordId),
  hideDownloadNotice: (hidden) => ipcRenderer.invoke('download:hide-notice', hidden),

  loginNexus: () => ipcRenderer.invoke('auth:login'),
  checkLoginStatus: () => ipcRenderer.invoke('auth:status'),
  downloadNexus: (item) => ipcRenderer.invoke('download:nexus', item),
  extractDownload: (recordId) => ipcRenderer.invoke('download:extract', recordId),
  onDownloadProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('download:progress', handler)
    return () => ipcRenderer.removeListener('download:progress', handler)
  },

  listHistory: () => ipcRenderer.invoke('history:list'),
  openHistoryFile: (filePath) => ipcRenderer.invoke('history:open', filePath),
  extractHistoryFile: (filePath) => ipcRenderer.invoke('history:extract', filePath),
  deleteHistoryFile: (filePath) => ipcRenderer.invoke('history:delete', filePath),

  openModWindow: (id) => ipcRenderer.invoke('window:open-mod', id),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),

  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  collectLogs: (payload) => ipcRenderer.invoke('logs:collect', payload),
  scanConflicts: () => ipcRenderer.invoke('conflicts:scan'),

  onStateChanged: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('state:changed', handler)
    return () => ipcRenderer.removeListener('state:changed', handler)
  },

  onMaximized: (callback) => {
    const handler = (_event, value) => callback(value)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  }
}

contextBridge.exposeInMainWorld('modbox', api)
