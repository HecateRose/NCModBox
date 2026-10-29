<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  checkHealth,
  deployedCount,
  importStagedMod,
  launchGame,
  legacyOrderList,
  pickDirectory,
  redmodOrderList,
  refreshDeploy,
  refreshGameStatus,
  reclassifyStaged,
  removeStagedMod,
  rerunRedMod,
  autoSortDeploy,
  resolveAllChanges,
  resolveChange,
  runDeploy,
  savePaths,
  setDeployOrder,
  startNexusDownload,
  state,
  stopGame,
  toggleStagedMod,
  undoDeploy
} from '../store/mods'
import { matchAny } from '../utils/search'
import { scanConflicts } from '../store/mods'

const busy = ref(false)
const keyword = ref('')
const pathsCollapsed = ref(false)
const health = ref(null)
const healthBusy = ref(false)

async function onHealthCheck() {
  healthBusy.value = true
  try {
    health.value = await checkHealth()
  } catch (err) {
    ElMessage({ message: (err && err.message) || '健康检查失败', type: 'error', duration: 3400 })
  } finally {
    healthBusy.value = false
  }
}

const deploy = computed(() => state.deploy)
const deployedIds = computed(() => new Set(deploy.value.deployed.map((entry) => entry.stagedModId)))
const enabledCount = computed(() => deploy.value.mods.filter((mod) => mod.enabled).length)

/** 部署页只分两大类：需要加载排序的 / 直接落目录的 */
/** 页面内模糊搜索：名称 / 类型标签 / 扩展名 / 文件路径 */
const filteredMods = computed(() => {
  const query = keyword.value.trim()
  const mods = deploy.value.mods || []
  if (!query) return mods
  return mods.filter((mod) =>
    matchAny(query, [
      mod.name,
      typeText(mod.types),
      (mod.types || []).join(' '),
      (mod.extensions || []).join(' '),
      (mod.files || []).slice(0, 40).join(' ')
    ])
  )
})

const matchedCount = computed(() => filteredMods.value.length)

const groupedMods = computed(() => {
  const sortable = []
  const direct = []
  const unclassified = []

  filteredMods.value.forEach((mod) => {
    if (mod.unclassified || !(mod.types || []).length) {
      unclassified.push(mod)
      return
    }
    // Legacy Archive 与 REDmod 是唯一两类有加载先后关系的
    if (mod.types.includes('legacy_archive') || mod.types.includes('redmod')) sortable.push(mod)
    else direct.push(mod)
  })

  const groups = [
    {
      key: 'sortable',
      label: '需要加载排序',
      hint: 'Legacy Archive（archive/pc/mod）与 REDmod（mods/）——在下方「加载顺序」里拖拽调整先后',
      mods: sortable
    },
    {
      key: 'direct',
      label: '不需要排序（直接落目录）',
      hint: 'redscript / TweakXL / CET 本体 / CET 插件 / RED4ext 插件——各自落到固定目录，没有先后关系',
      mods: direct
    }
  ]
  if (unclassified.length) {
    groups.push({
      key: 'unclassified',
      label: '未识别',
      hint: '类型无法识别，禁止部署；可点「重新识别」重新扫描',
      mods: unclassified
    })
  }
  return groups.filter((group) => group.mods.length)
})

const activeTab = ref('direct')

/** 当前 tab 下要显示的分组（需要排序 tab 只看 sortable 组） */
const visibleGroups = computed(() => {
  const groups = groupedMods.value
  if (activeTab.value === 'direct') return groups.filter((group) => group.key !== 'sortable')
  if (activeTab.value === 'sorted') return groups.filter((group) => group.key === 'sortable')
  return []
})

const deployTabs = computed(() => {
  const groups = groupedMods.value
  const direct = groups.filter((g) => g.key !== 'sortable').reduce((sum, g) => sum + g.mods.length, 0)
  const sorted = groups.filter((g) => g.key === 'sortable').reduce((sum, g) => sum + g.mods.length, 0)
  const order = (deploy.value.legacyOrder || []).length + (deploy.value.redmodOrder || []).length
  return [
    { key: 'direct', label: '无需排序', count: direct },
    { key: 'sorted', label: '需要排序', count: sorted },
    { key: 'order', label: '排序列表', count: order }
  ]
})

const subtitle = computed(() => {
  if (!deploy.value.gamePath) return '先设置游戏目录，再把 Mod 文件夹导入 staging'
  const base = `${deploy.value.mods.length} 个 staging Mod · ${enabledCount.value} 个已启用 · ${deployedCount.value} 个文件已部署`
  return keyword.value.trim() ? `${base} · 筛选命中 ${matchedCount.value}` : base
})

const canDeploy = computed(
  () => Boolean(deploy.value.gamePath) && !deploy.value.running && enabledCount.value > 0
)

const stagingLabel = computed(() => {
  if (!deploy.value.gamePath && deploy.value.stagingIsDefault) {
    return '未设置（选定游戏目录后自动创建 ModboxStaging）'
  }
  return deploy.value.stagingPath || '未设置'
})

const typeLabels = {
  legacy_archive: 'Legacy archive',
  redscript: 'redscript',
  tweak: 'TweakXL',
  cet: 'CET 插件',
  cet_core: 'CET 本体',
  red4ext_core: 'RED4ext 本体',
  redscript_core: 'redscript 本体',
  game_files: '游戏文件（按原路径）',
  red4ext: 'RED4ext',
  redmod: 'REDmod'
}

function typeText(types) {
  return (types || []).map((type) => typeLabels[type] || type).join(' + ') || '未识别'
}

async function onPickGame() {
  const dir = await pickDirectory()
  if (!dir) return
  await savePaths({ gamePath: dir })
  ElMessage({ message: '游戏目录已更新', type: 'success', duration: 1500 })
}

async function onPickStaging() {
  const dir = await pickDirectory()
  if (!dir) return
  await savePaths({ stagingPath: dir })
  ElMessage({ message: 'staging 目录已更新', type: 'success', duration: 1500 })
}

async function onResetStaging() {
  await savePaths({ stagingPath: '' })
  ElMessage({ message: '已恢复为游戏目录下的默认 staging', type: 'success', duration: 1800 })
}

async function onImport() {
  const result = await importStagedMod()
  if (!result.ok) {
    if (result.error && result.error !== '已取消') {
      ElMessage({ message: result.error, type: 'error', duration: 2600 })
    }
    return
  }
  ElMessage({
    message: result.record.unclassified
      ? `${result.record.name} 类型未识别，已标记为 unclassified`
      : `${result.record.name} 已导入（${typeText(result.record.types)}）`,
    type: result.record.unclassified ? 'warning' : 'success',
    duration: 2600
  })
}

async function onDeploy() {
  busy.value = true
  try {
    const result = await runDeploy()
    if (result.ok) {
      ElMessage({
        message: `部署完成，新增 ${result.added.length} 个硬链接`,
        type: 'success',
        duration: 2200
      })
      result.warnings.forEach((text) => ElMessage({ message: text, type: 'warning', duration: 3200 }))
    } else {
      ElMessageBox.alert((result.errors || []).join('\n'), '部署被阻止', {
        confirmButtonText: '知道了',
        customClass: 'deploy-alert'
      })
    }
  } finally {
    busy.value = false
  }
}

async function onUndo() {
  try {
    await ElMessageBox.confirm(
      '将删除 manifest 中记录且仍是硬链接的文件，被外部修改过的文件会保留。继续？',
      '撤销部署',
      { confirmButtonText: '撤销', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  busy.value = true
  try {
    const result = await undoDeploy()
    ElMessage({
      message: `已移除 ${result.removed.length} 个文件${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`,
      type: 'success',
      duration: 2400
    })
    result.skipped.forEach((item) =>
      ElMessage({ message: `${item.path}：${item.reason}`, type: 'warning', duration: 3200 })
    )
  } finally {
    busy.value = false
  }
}

async function onAutoSort() {
  try {
    await ElMessageBox.confirm(
      '将按 Mod 分组重排 Legacy archive 的加载顺序（同一 Mod 的 archive 相邻、Mod 之间按名称排序），会覆盖当前手动顺序。继续？',
      '自动排序',
      { confirmButtonText: '自动排序', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  busy.value = true
  try {
    const result = await autoSortDeploy()
    if (result && result.ok) {
      ElMessage({
        message: result.count ? `已自动排序 ${result.count} 个 archive（按 Mod 分组）` : '当前没有已部署的 Legacy archive',
        type: 'success',
        duration: 2600
      })
    } else {
      ElMessage({ message: (result && result.error) || '自动排序失败', type: 'error', duration: 3400 })
    }
  } finally {
    busy.value = false
  }
}

async function onRedMod() {
  busy.value = true
  try {
    const result = await rerunRedMod()
    ElMessage({
      message: result.ok ? 'REDmod 部署完成' : `REDmod 部署失败：${result.error}`,
      type: result.ok ? 'success' : 'error',
      duration: 3200
    })
  } finally {
    busy.value = false
  }
}

const conflicts = ref(null)
const scanBusy = ref(false)

async function onScanConflicts() {
  scanBusy.value = true
  try {
    const result = await scanConflicts()
    conflicts.value = result && result.error && !result.fallback ? { available: false, error: result.error } : result
  } catch (err) {
    conflicts.value = { available: false, error: (err && err.message) || '扫描失败' }
  } finally {
    scanBusy.value = false
  }
}

async function onLaunchOrStop() {
  if (deploy.value.running) {
    try {
      await ElMessageBox.confirm(
        '强制结束 Cyberpunk 2077 进程？未保存的游戏进度会丢失。',
        '停止游戏',
        { confirmButtonText: '结束进程', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    const result = await stopGame()
    if (result.ok) {
      ElMessage({ message: '已结束游戏进程', type: 'success', duration: 1800 })
    } else {
      ElMessage({ message: result.error || '结束进程失败', type: 'error', duration: 3200 })
    }
    return
  }

  const result = await launchGame()
  if (!result.ok) {
    ElMessage({ message: result.error, type: 'error', duration: 2600 })
    return
  }
  ElMessage({ message: '游戏启动中…', type: 'success', duration: 1800 })
}

async function onRemove(mod) {
  try {
    await ElMessageBox.confirm(`从 staging 删除「${mod.name}」？已部署的链接不会被删除。`, '移除 Mod', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  await removeStagedMod(mod.id)
}

async function onReclassify(mod) {
  busy.value = true
  try {
    const result = await reclassifyStaged(mod.id)
    if (!result.ok) {
      ElMessage({ message: result.error, type: 'error', duration: 3400 })
      return
    }
    if (result.record.unclassified) {
      ElMessage({
        message: `仍然无法识别（扫描到：${(result.record.extensions || []).join(' ') || '无特征文件'}）`,
        type: 'warning',
        duration: 4200
      })
    } else {
      ElMessage({
        message: `已识别为：${typeText(result.record.types)}`,
        type: 'success',
        duration: 3000
      })
    }
  } finally {
    busy.value = false
  }
}

/* ------------------------------ 外部变更处理 ------------------------------ */

const changeLabels = {
  refchange: '被替换',
  valchange: '被修改',
  deleted: '已删除',
  srcdeleted: '源已删除'
}

const changeTagTypes = {
  refchange: 'danger',
  valchange: 'warning',
  deleted: 'info',
  srcdeleted: 'info'
}

function changeLabel(type) {
  return changeLabels[type] || type
}

function changeDetail(change) {
  if (change.type === 'deleted') return '游戏目录中的这个文件已不存在，staging 中仍有源文件，可以恢复。'
  if (change.type === 'srcdeleted') return 'staging 中的源文件已被删除，无法恢复；只能接受现状或重新导入该 Mod。'
  if (change.type === 'refchange') return '游戏目录中的文件已不是本管理器建立的硬链接（被其他工具替换过）。接受后不再跟踪它。'
  return '链接仍在，但内容或修改时间与记录不一致。'
}

async function onAccept(change) {
  busy.value = true
  try {
    const result = await resolveChange({ path: change.path, action: 'accept' })
    if (result.ok) {
      ElMessage({ message: `已接受外部状态：${change.path}`, type: 'success', duration: 2200 })
      if (result.type === 'refchange') {
        ElMessage({
          message: '该文件已被标记为外部文件，之后撤销部署时不会再删除它',
          type: 'info',
          duration: 3400
        })
      }
    } else {
      ElMessage({ message: result.error, type: 'error', duration: 3400 })
    }
  } finally {
    busy.value = false
  }
}

async function onRestore(change) {
  busy.value = true
  try {
    const result = await resolveChange({ path: change.path, action: 'restore' })
    if (result.ok) {
      ElMessage({ message: `已恢复为 staging 状态：${change.path}`, type: 'success', duration: 2400 })
    } else {
      ElMessage({ message: result.error, type: 'error', duration: 3800 })
    }
  } finally {
    busy.value = false
  }
}

async function onAcceptAll() {
  if (!deploy.value.changes.length) return
  busy.value = true
  try {
    const result = await resolveAllChanges('accept')
    if (result && result.failed) {
      ElMessage({
        message: `已接受 ${result.processed} 处，${result.failed} 处失败：${(result.errors || []).slice(0, 2).join('；')}`,
        type: 'warning',
        duration: 4200
      })
    } else {
      ElMessage({ message: `已接受全部 ${result ? result.processed : 0} 处外部变更`, type: 'success', duration: 2400 })
    }
  } catch (err) {
    ElMessage({ message: (err && err.message) || '批量接受失败', type: 'error', duration: 3400 })
  } finally {
    busy.value = false
  }
}

async function onRestoreAll() {
  if (!deploy.value.changes.length) return
  busy.value = true
  try {
    const result = await resolveAllChanges('restore')
    if (result && result.failed) {
      ElMessage({
        message: `已恢复 ${result.processed} 处，${result.failed} 处失败：${(result.errors || []).slice(0, 2).join('；')}`,
        type: 'warning',
        duration: 4200
      })
    } else {
      ElMessage({ message: `已恢复全部 ${result ? result.processed : 0} 处外部变更`, type: 'success', duration: 2400 })
    }
  } catch (err) {
    ElMessage({ message: (err && err.message) || '批量恢复失败', type: 'error', duration: 3400 })
  } finally {
    busy.value = false
  }
}

/* ------------------------------ 单 Mod 部署 ------------------------------ */

async function onDeployOne(mod) {
  busy.value = true
  try {
    if (!mod.enabled) await toggleStagedMod(mod.id, true)
    const result = await runDeploy([mod.id])
    if (result.ok) {
      ElMessage({
        message: `「${mod.name}」部署完成，新增 ${result.added.length} 个文件`,
        type: 'success',
        duration: 2400
      })
      ;(result.warnings || []).forEach((text) =>
        ElMessage({ message: text, type: 'warning', duration: 3200 })
      )
    } else {
      ElMessageBox.alert((result.errors || []).join('\n'), '部署被阻止', {
        confirmButtonText: '知道了',
        customClass: 'deploy-alert'
      })
    }
  } finally {
    busy.value = false
  }
}

async function onUndoOne(mod) {
  busy.value = true
  try {
    const result = await undoDeploy([mod.id])
    ElMessage({
      message: `「${mod.name}」已撤销 ${result.removed.length} 个文件${
        result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''
      }`,
      type: 'success',
      duration: 2400
    })
    result.skipped.forEach((item) =>
      ElMessage({ message: `${item.path}：${item.reason}`, type: 'warning', duration: 3200 })
    )
  } finally {
    busy.value = false
  }
}

/* ------------------------------ 加载顺序 ------------------------------ */

const drag = ref({ kind: '', from: -1 })

/** 自定义拖拽（HTML5 DnD 在 Electron 下不稳定，改用鼠标事件） */
const dragState = ref({ active: false, kind: '', from: -1, to: -1 })

function onRowMouseDown(kind, index, event) {
  if (event.button !== 0) return
  event.preventDefault()
  dragState.value = { active: true, kind, from: index, to: index }
  window.addEventListener('mousemove', onRowMouseMove)
  window.addEventListener('mouseup', onRowMouseUp)
}

function onRowMouseMove(event) {
  if (!dragState.value.active) return
  const el = document.elementFromPoint(event.clientX, event.clientY)
  const row = el && el.closest ? el.closest('.sort-item') : null
  if (!row) return
  const rows = [...row.parentElement.querySelectorAll('.sort-item')]
  const to = rows.indexOf(row)
  if (to >= 0) dragState.value.to = to
}

async function onRowMouseUp() {
  window.removeEventListener('mousemove', onRowMouseMove)
  window.removeEventListener('mouseup', onRowMouseUp)
  const { active, kind, from, to } = dragState.value
  dragState.value = { active: false, kind: '', from: -1, to: -1 }
  if (!active || !kind || from < 0 || to < 0 || to === from) return
  await moveTo(kind, from, to)
}

async function moveTo(kind, from, to) {
  const source = kind === 'legacy' ? legacyOrderList.value : redmodOrderList.value
  const list = source.map((item) => (kind === 'legacy' ? item.name : item.slug))
  if (from < 0 || from >= list.length) return
  const [moved] = list.splice(from, 1)
  list.splice(Math.min(Math.max(to, 0), list.length), 0, moved)
  await setDeployOrder(kind, list)
  ElMessage({
    message: kind === 'legacy' ? '顺序已保存，modlist.txt 已重写' : 'REDmod 顺序已保存',
    type: 'success',
    duration: 1500
  })
}

async function onDownloadPrereq(item) {
  const modId = Number(item.modId)
  const name = item.name || item.label || '前置'
  if (!modId) {
    ElMessage.warning('这条前置没有 Nexus ID，请到 Nexus 手动下载')
    return
  }
  busy.value = true
  try {
    const result = await startNexusDownload({ id: modId, name })
    if (result && result.needsLogin) {
      ElMessage.info('已打开登录窗口，登录完成后再点一次下载')
    } else if (result && result.ok) {
      ElMessage({
        message: `「${name}」已下载并解压到 staging，启用后重新部署即可`,
        type: 'success',
        duration: 4200
      })
    } else if (result && result.error) {
      ElMessage({ message: result.error, type: 'error', duration: 4200 })
    }
  } finally {
    busy.value = false
  }
}

function onDragStart(kind, index, event) {
  drag.value = { kind, from: index }
  // 某些 Chromium 环境下不 setData 会直接取消拖拽
  try {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  } catch {
    /* ignore */
  }
}

async function onDrop(kind, index) {
  const { kind: fromKind, from } = drag.value
  drag.value = { kind: '', from: -1 }
  if (fromKind !== kind || from < 0 || from === index) return

  const source = kind === 'legacy' ? legacyOrderList.value : redmodOrderList.value
  const list = source.map((item) => (kind === 'legacy' ? item.name : item.slug))
  const [moved] = list.splice(from, 1)
  list.splice(index, 0, moved)

  await setDeployOrder(kind, list)
  ElMessage({
    message: kind === 'legacy' ? '顺序已保存，modlist.txt 已重写' : 'REDmod 顺序已保存',
    type: 'success',
    duration: 1800
  })
}

/** 上移/下移加载顺序（与拖拽共用同一套持久化） */
async function onMove(kind, index, delta) {
  const source = kind === 'legacy' ? legacyOrderList.value : redmodOrderList.value
  const target = index + delta
  if (target < 0 || target >= source.length) return
  await moveTo(kind, index, target)
}

let statusTimer = null

onMounted(() => {
  refreshDeploy()
  // 游戏进程可能自行退出/崩溃，定时刷新运行状态（停止/启动按钮随之切换）
  statusTimer = setInterval(() => {
    if (!busy.value) refreshGameStatus()
  }, 5000)
})

onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
})
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="page-head-text">
        <h2>部署管理</h2>
        <p>{{ subtitle }}</p>
      </div>

      <div class="page-head-tools">
        <el-input
          v-model="keyword"
          class="local-search"
          size="small"
          clearable
          placeholder="筛选：名称 / 类型 / 扩展名…"
        />
        <el-button class="btn-ghost" @click="onImport">导入文件夹</el-button>
        <el-button class="btn-ghost" :loading="healthBusy" @click="onHealthCheck">健康检查</el-button>
        <el-button class="btn-dark" :disabled="!canDeploy" :loading="busy" @click="onDeploy">部署</el-button>
        <el-button class="btn-ghost" :disabled="!deploy.deployed.length" :loading="busy" @click="onUndo">
          撤销部署
        </el-button>
        <el-button class="btn-ghost" @click="onLaunchOrStop">
          {{ deploy.running ? '停止游戏' : '启动游戏' }}
        </el-button>
      </div>
    </header>

    <div class="deploy-tabs">
      <button
        v-for="tab in deployTabs"
        :key="tab.key"
        class="deploy-tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.count" class="deploy-tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <template v-if="activeTab === 'direct'">
    <section v-if="health" class="panel">
      <div class="panel-head-row">
        <h3 class="panel-title">
          健康检查
          <el-tag v-if="health.ok && !health.warns" type="success" effect="plain" size="small">全部正常</el-tag>
          <el-tag v-if="health.errors" type="danger" effect="plain" size="small">错误 {{ health.errors }}</el-tag>
          <el-tag v-if="health.warns" type="warning" effect="plain" size="small">警告 {{ health.warns }}</el-tag>
        </h3>
        <el-button class="btn-ghost" size="small" :loading="healthBusy" @click="onHealthCheck">重新检查</el-button>
      </div>
      <p v-if="!health.issues.length" class="panel-sub">没有发现问题。</p>
      <div v-else class="mod-list">
        <div v-for="(issue, index) in health.issues" :key="index" class="deploy-row">
          <div class="deploy-main">
            <p class="row-summary">
              <el-tag
                size="small"
                :type="issue.level === 'error' ? 'danger' : issue.level === 'warn' ? 'warning' : 'info'"
                effect="plain"
              >
                {{ issue.level === 'error' ? '错误' : issue.level === 'warn' ? '警告' : '提示' }}
              </el-tag>
              <strong>{{ issue.title }}</strong>
              <span> {{ issue.detail }}</span>
            </p>
            <p v-if="issue.fix" class="row-summary">{{ issue.fix }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head-row">
        <h3 class="panel-title">路径设置</h3>
        <button class="collapse-toggle" @click="pathsCollapsed = !pathsCollapsed">
          {{ pathsCollapsed ? '展开' : '收起' }}
        </button>
      </div>

      <template v-if="!pathsCollapsed">
        <div class="path-row">
          <span class="path-label">游戏目录</span>
          <el-input :model-value="deploy.gamePath || '未设置'" readonly size="small" />
          <el-button class="btn-ghost" size="small" @click="onPickGame">选择</el-button>
        </div>

        <div class="path-row">
          <span class="path-label">staging</span>
          <el-input :model-value="stagingLabel" readonly size="small" :class="{ 'is-muted': !deploy.gamePath && deploy.stagingIsDefault }" />
          <el-tag v-if="!deploy.stagingIsDefault" size="small" effect="plain">自定义</el-tag>
          <el-button class="btn-ghost" size="small" @click="onPickStaging">选择</el-button>
          <el-button v-if="!deploy.stagingIsDefault" class="btn-ghost" size="small" @click="onResetStaging">
            恢复默认
          </el-button>
        </div>

        <p class="panel-sub">
          默认 staging 位于游戏根目录下的 <code>ModboxStaging</code>，选定游戏目录后自动创建，保证与游戏同分区、硬链接可用。
          部署只使用硬链接，硬链接不可行时不会降级为复制；游戏运行时禁止部署。
        </p>
      </template>
    </section>

    <el-alert
      v-if="deploy.running"
      class="flat-alert"
      type="warning"
      show-icon
      :closable="false"
      title="游戏正在运行"
      description="检测到 Cyberpunk2077.exe，部署与撤销已被禁止。请先退出游戏。"
    />

    <el-alert
      v-if="deploy.preflight.errors.length"
      class="flat-alert"
      type="error"
      show-icon
      :closable="false"
      title="部署预检未通过"
      :description="deploy.preflight.errors.join('；')"
    />

    <section v-if="deploy.modRequirements && deploy.modRequirements.missing.length" class="panel">
      <h3 class="panel-title">Mod 前置依赖缺失（软警告）</h3>
      <p class="panel-sub">
        以下是已启用 Mod 在 Nexus 上声明的前置，但 staging 里没有对应的已下载 Mod。
        缺失不会阻止部署，但相关 Mod 可能不生效；到 Nexus 页面下载对应前置后重新部署即可。
      </p>

      <div class="mod-list">
        <div
          v-for="(item, index) in deploy.modRequirements.missing"
          :key="`${item.requiredBy}-${item.modId}-${index}`"
          class="deploy-row"
        >
          <div class="deploy-main">
            <div class="deploy-title">
              <strong>{{ item.name }}</strong>
              <el-tag size="small" type="warning" effect="plain">未安装</el-tag>
            </div>
            <p class="row-summary">
              被以下 Mod 需要：{{ item.requiredBy
              }}<template v-if="item.notes"> · {{ item.notes }}</template>
            </p>
          </div>
          <div class="deploy-actions">
            <el-button class="btn-dark" size="small" :loading="busy" @click="onDownloadPrereq(item)">
              下载安装
            </el-button>
          </div>
        </div>
      </div>
    </section>

        <section v-if="deploy.dependencies && deploy.dependencies.missing.length" class="panel">
      <h3 class="panel-title">核心框架依赖缺失（软警告）</h3>
      <p class="panel-sub">
        下面这些框架没有在游戏目录里检测到。缺失不会阻止部署，但依赖它们的 Mod 在游戏里可能不生效；
        装好框架后重新启动游戏即可。检测方式为文件存在性，不校验版本。
      </p>

      <div class="mod-list">
        <div v-for="item in deploy.dependencies.missing" :key="item.key" class="deploy-row">
          <div class="deploy-main">
            <div class="deploy-title">
              <strong>{{ item.label }}</strong>
              <el-tag size="small" type="warning" effect="plain">未检测到</el-tag>
            </div>
            <p class="row-summary">
              需要它：{{ item.mods.join('、') }} · 期望位置：{{ item.hint }}
            </p>
          </div>
          <div class="deploy-actions">
            <el-button class="btn-dark" size="small" :loading="busy" @click="onDownloadPrereq(item)">
              下载安装
            </el-button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="deploy.changes.length" class="panel">
      <div class="panel-head-row">
        <h3 class="panel-title">检测到外部变更（{{ deploy.changes.length }}）</h3>
        <div class="panel-actions">
          <el-button class="btn-ghost" size="small" :loading="busy" @click="onRestoreAll">
            全部恢复 staging
          </el-button>
          <el-button class="btn-dark" size="small" :loading="busy" @click="onAcceptAll">
            全部接受
          </el-button>
        </div>
      </div>
      <p class="panel-sub">
        直接点「全部接受」或「全部恢复」即可批量处理，也可以逐条处理。
        <b>恢复 staging</b> 会把游戏目录中的文件改回指向 staging 的硬链接；<b>接受外部状态</b>
        则信任当前文件并更新记录（标记为外部文件，之后撤销部署不再删除它）。
        现在部署时也会自动接受外部变更，不需要再手动逐条确认。
      </p>

      <div class="mod-list">
        <div v-for="change in deploy.changes" :key="change.path" class="deploy-row">
          <div class="deploy-main">
            <div class="deploy-title">
              <strong>{{ change.path }}</strong>
              <el-tag size="small" :type="changeTagTypes[change.type] || 'info'" effect="plain">
                {{ changeLabel(change.type) }}
              </el-tag>
              <span class="row-summary">{{ change.mod }}</span>
            </div>
            <p class="row-summary">{{ changeDetail(change) }}</p>
          </div>

          <div class="deploy-actions">
            <el-button
              class="btn-ghost"
              size="small"
              :disabled="change.type === 'srcdeleted' || busy"
              :loading="busy"
              @click="onRestore(change)"
            >
              恢复 staging
            </el-button>
            <el-button class="btn-dark" size="small" :loading="busy" @click="onAccept(change)">
              接受外部状态
            </el-button>
          </div>
        </div>
      </div>
    </section>

    <el-alert
      v-if="deploy.redmod && deploy.redmod.ok === false"
      class="flat-alert"
      type="error"
      show-icon
      :closable="false"
      title="REDmod 部署失败"
      :description="`${deploy.redmod.error} —— 修复前启动游戏会被阻止。`"
    >
      <template #default>
        <el-button class="btn-dark" size="small" :loading="busy" @click="onRedMod">
          重新运行 redMod deploy
        </el-button>
      </template>
    </el-alert>

    <el-alert
      v-if="deploy.redmod && deploy.redmod.ok"
      class="flat-alert"
      type="success"
      show-icon
      :closable="false"
      title="REDmod 已部署"
      description="redMod.exe deploy 执行成功，启动游戏前会校验该状态。"
    />
    </template>

    <template v-if="activeTab === 'order'">
    <section class="panel">
      <div class="panel-head-row">
        <h3 class="panel-title">冲突扫描</h3>
        <div class="panel-actions">
          <el-button class="btn-ghost" size="small" :loading="busy" @click="onAutoSort">自动排序</el-button>
          <el-button class="btn-ghost" size="small" :loading="scanBusy" @click="onScanConflicts">
            {{ conflicts ? '重新扫描' : '开始扫描' }}
          </el-button>
        </div>
      </div>
      <p class="panel-sub">
        扫描 <code>archive/pc/mod</code> 的文件级冲突。优先调用 red4-conflicts.exe（放在游戏根目录或
        tools/red4-conflicts.exe）；未安装工具时退化为归档清单与 modlist 顺序的静态分析，仅供人工核对。
      </p>

      <template v-if="conflicts">
        <el-alert
          v-if="conflicts.available && conflicts.error"
          class="flat-alert"
          type="error"
          show-icon
          :closable="false"
          title="冲突扫描失败"
          :description="conflicts.error"
        />
        <template v-else-if="conflicts.available">
          <p class="panel-sub">已调用：{{ conflicts.tool }}</p>
          <div v-if="conflicts.parsed && conflicts.parsed.entries.length" class="mod-list">
            <div v-for="(entry, index) in conflicts.parsed.entries" :key="index" class="deploy-row">
              <div class="deploy-main">
                <p class="row-summary">{{ entry.text }}</p>
              </div>
            </div>
          </div>
          <pre v-else class="conflict-raw">{{ conflicts.parsed.raw || '工具没有输出冲突信息' }}</pre>
        </template>
        <p v-else class="panel-sub">{{ conflicts.hint }}</p>

        <template v-if="conflicts.fallback">
          <p class="panel-sub">
            archive 清单（{{ conflicts.fallback.archives.length }}）· modlist 记录
            {{ conflicts.fallback.order.length }} 条
          </p>
          <div v-if="conflicts.fallback.archives.length" class="mod-list">
            <div
              v-for="(item, index) in conflicts.fallback.archives"
              :key="item.name"
              class="deploy-row"
            >
              <div class="deploy-main">
                <p class="row-summary">
                  {{ index + 1 }}. {{ item.name }} · {{ (item.size / 1024 / 1024).toFixed(1) }} MB
                </p>
              </div>
            </div>
          </div>
          <p v-for="note in conflicts.fallback.notes" :key="note" class="panel-sub conflict-note">
            {{ note }}
          </p>
        </template>
      </template>
    </section>

    <section class="panel">
      <h3 class="panel-title">加载顺序</h3>
      <p class="panel-sub">
        拖拽行或点 ↑↓ 调整，上方先加载，文件级冲突时<b>上方获胜</b>；REDmod 永远在 Legacy archive 之后加载（不可调整）。
      </p>

      <div v-if="!legacyOrderList.length && !redmodOrderList.length" class="panel-sub sort-empty">
        当前没有需要排序的条目。只有 <b>Legacy archive（.archive）</b> 和 <b>REDmod（mods/）</b> 参与加载顺序；
        CET 本体 / CET 插件 / redscript / tweak / 游戏文件都是直接落到固定目录，不存在先后关系。
        部署一个 archive 类 Mod 后，这里会出现可拖拽的列表。
      </div>

      <div v-if="legacyOrderList.length" class="sort-group">
        <p class="sort-label">Legacy archive · 写入 modlist.txt（{{ legacyOrderList.length }}）</p>
        <div class="sort-list">
          <div
            v-for="(item, index) in legacyOrderList"
            :key="item.name"
            class="sort-item"
            :class="{
              'is-dragging': dragState.active && dragState.kind === 'legacy' && dragState.from === index
            }"
            @mousedown="onRowMouseDown('legacy', index, $event)"
          >
            <span class="sort-index">{{ index + 1 }}</span>
            <span class="sort-name">{{ item.name }}</span>
            <span class="sort-mod">{{ item.mod }}</span>
            <span class="sort-actions">
              <button class="sort-move" :disabled="index === 0" @click.stop="onMove('legacy', index, -1)">↑</button>
              <button
                class="sort-move"
                :disabled="index === legacyOrderList.length - 1"
                @click.stop="onMove('legacy', index, 1)"
              >
                ↓
              </button>
            </span>
            <span class="sort-handle">⋮⋮</span>
          </div>
        </div>
      </div>

      <div v-if="legacyOrderList.length && redmodOrderList.length" class="sort-divider">
        以下 REDmod 始终在以上 archive 之后加载
      </div>

      <div v-if="redmodOrderList.length" class="sort-group">
        <p class="sort-label">REDmod · mods/ 目录（{{ redmodOrderList.length }}）</p>
        <div class="sort-list">
          <div
            v-for="(item, index) in redmodOrderList"
            :key="item.slug"
            class="sort-item"
            :class="{
              'is-dragging': dragState.active && dragState.kind === 'redmod' && dragState.from === index
            }"
            @mousedown="onRowMouseDown('redmod', index, $event)"
          >
            <span class="sort-index">{{ index + 1 }}</span>
            <span class="sort-name">{{ item.slug }}</span>
            <span class="sort-mod">{{ item.mod }}</span>
            <span class="sort-actions">
              <button class="sort-move" :disabled="index === 0" @click.stop="onMove('redmod', index, -1)">↑</button>
              <button
                class="sort-move"
                :disabled="index === redmodOrderList.length - 1"
                @click.stop="onMove('redmod', index, 1)"
              >
                ↓
              </button>
            </span>
            <span class="sort-handle">⋮⋮</span>
          </div>
        </div>
      </div>
    </section>
    </template>

    <div v-show="activeTab !== 'order'">
        <p v-if="deploy.mods.length" class="panel-sub list-hint">
      列表按加载方式分组。开关表示「全量部署时是否包含这个 Mod」；<b>已部署的 Mod 不显示开关</b>，
      要取消请点「撤销此 Mod」。（开关不会卸载已写入游戏目录的文件）
    </p>

    <el-empty
      v-if="!deploy.mods.length"
      description="还没有 staging 中的 Mod"
      :image-size="88"
    >
      <div class="panel-sub" style="max-width: 520px; margin: 0 auto 14px; text-align: left">
        把解压后的 Mod 文件夹导入 staging（不会改动原文件），再执行部署。类型由特征文件自动判定，识别不到时会被标记为
        unclassified，不会猜测路径。
      </div>
      <el-button class="btn-dark" @click="onImport">导入文件夹</el-button>
    </el-empty>

    <div v-else class="mod-groups">
      <section v-for="group in visibleGroups" :key="group.key" class="mod-group">
        <header class="mod-group-head">
          <h4>{{ group.label }}</h4>
          <span class="mod-group-count">{{ group.mods.length }}</span>
          <span class="mod-group-hint">{{ group.hint }}</span>
        </header>
        <div class="mod-list">
          <div v-for="mod in group.mods" :key="mod.id" class="deploy-row">
        <div class="deploy-main">
          <div class="deploy-title">
            <strong>{{ mod.name }}</strong>
            <el-tag size="small" effect="plain">{{ typeText(mod.types) }}</el-tag>
            <el-tag
              v-if="mod.gameVersion"
              size="small"
              :type="deploy.gameVersion && mod.gameVersion !== deploy.gameVersion ? 'warning' : 'info'"
              effect="plain"
            >
              适配 {{ mod.gameVersion
              }}<template v-if="deploy.gameVersion && mod.gameVersion !== deploy.gameVersion">
                ≠ 当前 {{ deploy.gameVersion }}</template>
            </el-tag>
            <el-tag v-if="deployedIds.has(mod.id)" size="small" type="success" effect="plain">已部署</el-tag>
            <el-tag v-if="mod.unclassified" size="small" type="warning" effect="plain">未识别</el-tag>
          </div>
          <p class="row-summary">{{ mod.files.length }} 个文件{{ mod.extensions.length ? ` · ${mod.extensions.slice(0, 6).join(' / ')}` : '' }}</p>
        </div>

        <div class="deploy-actions">
          <el-switch
            v-if="!deployedIds.has(mod.id)"
            :model-value="mod.enabled"
            :disabled="mod.unclassified"
            @change="(value) => toggleStagedMod(mod.id, value)"
          />
          <el-button
            v-if="mod.unclassified"
            class="btn-ghost"
            size="small"
            :loading="busy"
            @click="onReclassify(mod)"
          >
            重新识别
          </el-button>
          <el-button
            v-if="deployedIds.has(mod.id)"
            class="btn-ghost"
            size="small"
            :loading="busy"
            @click="onUndoOne(mod)"
          >
            撤销此 Mod
          </el-button>
          <el-button
            v-else
            class="btn-ghost"
            size="small"
            :disabled="mod.unclassified || !mod.enabled || deploy.running"
            :loading="busy"
            @click="onDeployOne(mod)"
          >
            部署此 Mod
          </el-button>
          <el-button class="btn-ghost" size="small" @click="onRemove(mod)">移除</el-button>
        </div>
          </div>
        </div>
      </section>
    </div>
    </div>
  </section>
</template>
