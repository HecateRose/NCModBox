<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  attachDownload,
  checkModUpdates,
  extractDownload,
  hideDownloadNotice,
  refreshDownloads,
  removeDownloadRecord,
  runDeploy,
  ensureTranslations,
  state,
  toggleStagedMod,
  tr,
  updateMod
} from '../store/mods'
import { modCover } from '../utils/art'
import { matchAny } from '../utils/search'

const tab = ref('kept')
const busy = ref(false)
const checking = ref(false)
const updates = ref({})
const translating = ref(false)

async function onToggleTranslation() {
  if (state.showTranslation) {
    state.showTranslation = false
    return
  }
  state.showTranslation = true
  translating.value = true
  try {
    await ensureTranslations(
      records.value.map((record) => record.summary).filter(Boolean).slice(0, 20)
    )
  } finally {
    translating.value = false
  }
}

async function onCheckUpdates() {
  checking.value = true
  try {
    const result = await checkModUpdates()
    if (result && result.error) {
      ElMessage({ message: result.error, type: 'error', duration: 3600 })
      return
    }
    const map = {}
    ;((result && result.items) || []).forEach((item) => {
      map[item.recordId] = item
    })
    updates.value = map
    const count = ((result && result.items) || []).filter((item) => item.hasUpdate).length
    ElMessage({
      message: count ? `发现 ${count} 个可更新的 Mod` : '所有 Mod 已是最新版本',
      type: count ? 'warning' : 'success',
      duration: 2600
    })
  } finally {
    checking.value = false
  }
}

async function onUpdate(record) {
  busy.value = true
  try {
    const result = await updateMod(record.recordId)
    if (result && result.ok) {
      ElMessage({
        message: `「${record.name}」已更新${result.redeployed ? '并重新部署' : ''}`,
        type: 'success',
        duration: 3200
      })
      const next = { ...updates.value }
      delete next[record.recordId]
      updates.value = next
    } else {
      ElMessage({ message: (result && result.error) || '更新失败', type: 'error', duration: 4200 })
    }
  } finally {
    busy.value = false
  }
}

const keyword = ref('')

const records = computed(() => state.downloads)

/** 页面内模糊搜索：名称 / 版本 / 作者 / 分类 / 简介 / 标签 / 包体路径 */
const filteredRecords = computed(() => {
  const query = keyword.value.trim()
  if (!query) return records.value
  return records.value.filter((record) =>
    matchAny(query, [
      record.name,
      record.version,
      record.author,
      record.category,
      record.summary,
      (record.tags || []).join(' '),
      record.archivePath
    ])
  )
})

function recordCover(record) {
  if (record.picture) return record.picture
  return modCover({ id: record.modId || 0, name: record.name }, { w: 216, h: 104 })
}

function recordTags(record) {
  return (record.tags || []).slice(0, 4)
}
const keptCount = computed(() => records.value.filter((record) => record.archiveExists).length)
const missingCount = computed(() => records.value.length - keptCount.value)

const shown = computed(() =>
  filteredRecords.value.filter((record) =>
    tab.value === 'kept' ? record.archiveExists : !record.archiveExists
  )
)

const matchedCount = computed(() => filteredRecords.value.length)

async function onAttach(record) {
  busy.value = true
  try {
    const result = await attachDownload(record.recordId)
    if (result.ok) {
      ElMessage({
        message: `已解压到 staging：${result.staged.name}（${result.staged.types.join(' + ') || '未识别'}）`,
        type: 'success',
        duration: 3000
      })
      if (result.staged.unclassified) {
        ElMessage({
          message: '包体类型未识别，已标记 unclassified，请在部署页处理',
          type: 'warning',
          duration: 4000
        })
      }
    } else if (result.error !== '已取消') {
      ElMessage({ message: result.error, type: 'error', duration: 3600 })
    }
  } finally {
    busy.value = false
  }
}

async function onDeploy(record) {
  if (!record.stagedId) return
  busy.value = true
  try {
    await toggleStagedMod(record.stagedId, true)
    const result = await runDeploy()
    if (result.ok) {
      ElMessage({
        message: `部署完成，写入 ${result.added.length} 个文件${
          result.redmod && result.redmod.ok === false ? '（REDmod 部署失败，启动会被阻止）' : ''
        }`,
        type: 'success',
        duration: 3000
      })
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

async function onRemove(record) {
  try {
    await ElMessageBox.confirm(
      '会一并移除这条记录绑定的 staging Mod（如果已部署，会先撤销部署）。压缩包文件本身不会被删除。继续？',
      '移除记录',
      { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  const result = await removeDownloadRecord(record.recordId)
  if (result && result.ok === false) {
    ElMessage({ message: result.error, type: 'error', duration: 3800 })
    return
  }
  ElMessage({
    message: record.stagedId ? '记录已移除，关联的 staging Mod 已一并移除' : '记录已移除',
    type: 'success',
    duration: 2600
  })
}

async function onHide() {
  await hideDownloadNotice()
}

async function onExtract(record) {
  busy.value = true
  try {
    const result = await extractDownload(record.recordId)
    if (result.ok) {
      ElMessage({
        message: `已解压到 staging：${result.staged.name}（${result.staged.types.join(' + ') || '未识别'}）`,
        type: 'success',
        duration: 3000
      })
    } else {
      ElMessage({ message: result.error, type: 'error', duration: 3600 })
    }
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  // 包体记录的部署状态由后端 record.deployed 提供，不需要再拉一遍全量部署状态
  await refreshDownloads()
})
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="page-head-text">
        <h2>包体记录</h2>
        <p>
          {{ records.length }} 个包体记录 · 已预留 {{ keptCount }} · 未预留 {{ missingCount
          }}<template v-if="keyword.trim()"> · 筛选命中 {{ matchedCount }}</template>
        </p>
      </div>

      <div class="page-head-tools">
        <el-input
          v-model="keyword"
          class="local-search"
          size="small"
          clearable
          placeholder="筛选：名称 / 简介 / 标签…"
        />
        <el-button
          class="btn-ghost"
          :loading="checking"
          :disabled="!records.length"
          @click="onCheckUpdates"
        >
          检查更新
        </el-button>
        <el-button class="btn-ghost" :disabled="!records.length" @click="tab = 'kept'">已预留</el-button>
        <el-button class="btn-ghost" :disabled="!records.length" @click="tab = 'missing'">未预留</el-button>
      </div>
    </header>

    <el-alert
      v-if="!state.hideDownloadNotice"
      class="flat-alert"
      type="info"
      :closable="false"
      title="包体与部署的关系"
    >
      <template #default>
        <div class="alert-flow">
          点列表的「下载」会打开 Nexus 文件页，在页面里点 Manual → Slow download，程序自动落盘、解压并登记为包体记录。
          也可以从「已下载」页对本地 zip 直接解压，同样会在这里出现记录。
          <b>压缩包还在下载目录 = 已预留；压缩包被删掉但记录仍在 = 未预留。</b>
        </div>
        <div class="notice-actions">
          <el-button class="btn-ghost" size="small" @click="onHide">不再提示</el-button>
        </div>
      </template>
    </el-alert>

    <el-tabs v-if="records.length" v-model="tab" class="flat-tabs">
      <el-tab-pane name="kept">
        <template #label>
          已预留包体
          <span class="tab-count">{{ keptCount }}</span>
        </template>

        <div v-if="!shown.length" class="panel-sub" style="padding: 20px 2px">
          该分类下暂无记录。绑定 zip 后，记录会出现在这里。
        </div>
        <div v-else class="mod-list">
          <div v-for="record in shown" :key="record.recordId" class="deploy-row record-row">
            <img
              class="record-cover"
              :src="recordCover(record)"
              :alt="record.name"
              draggable="false"
            />
            <div class="deploy-main record-main">
              <div class="deploy-title">
                <strong>{{ record.name }}</strong>
                <span v-if="record.version" class="row-version">v{{ record.version }}</span>
                <el-tag
                  v-if="record.gameVersion"
                  size="small"
                  :type="record.gameVersionMismatch ? 'warning' : 'info'"
                  effect="plain"
                >
                  适配 {{ record.gameVersion
                  }}<template v-if="record.gameVersionMismatch"> ≠ 当前 {{ record.currentGameVersion }}</template>
                </el-tag>
                <el-tag
                  v-if="updates[record.recordId] && updates[record.recordId].hasUpdate"
                  size="small"
                  type="warning"
                  effect="plain"
                >
                  可更新 {{ updates[record.recordId].localVersion }} →
                  {{ updates[record.recordId].latestVersion }}
                </el-tag>
                <el-tag size="small" type="success" effect="plain">已预留</el-tag>
                <el-tag size="small" :type="record.deployed ? 'success' : 'info'" effect="plain">
                  {{ record.deployed ? '已部署' : '未部署' }}
                </el-tag>
              </div>
              <p class="row-summary">{{ tr(record.summary) || record.archivePath }}</p>
              <div v-if="recordTags(record).length" class="row-tags">
                <span v-if="record.category" class="chip chip-strong">{{ record.category }}</span>
                <span v-for="tag in recordTags(record)" :key="tag" class="chip chip-plain">{{ tag }}</span>
                <span v-if="record.author" class="chip">{{ record.author }}</span>
              </div>
            </div>

            <div class="deploy-actions">
              <el-button
                v-if="record.archiveExists && !record.stagedId"
                class="btn-ghost"
                size="small"
                :loading="busy"
                @click="onExtract(record)"
              >
                解压
              </el-button>
              <el-button
                class="btn-dark"
                size="small"
                :disabled="!record.stagedId || state.deploy.running"
                :loading="busy"
                @click="onDeploy(record)"
              >
                部署
              </el-button>
              <el-button
                v-if="updates[record.recordId] && updates[record.recordId].hasUpdate"
                class="btn-dark"
                size="small"
                :loading="busy"
                @click="onUpdate(record)"
              >
                更新
              </el-button>
              <el-button class="btn-ghost" size="small" @click="onRemove(record)">移除记录</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="missing">
        <template #label>
          未预留包体
          <span class="tab-count">{{ missingCount }}</span>
        </template>

        <div v-if="!shown.length" class="panel-sub" style="padding: 20px 2px">
          没有缺失包体的记录——所有已登记的包体都还在原处。
        </div>
        <div v-else class="mod-list">
          <div v-for="record in shown" :key="record.recordId" class="deploy-row record-row">
            <img
              class="record-cover"
              :src="recordCover(record)"
              :alt="record.name"
              draggable="false"
            />
            <div class="deploy-main record-main">
              <div class="deploy-title">
                <strong>{{ record.name }}</strong>
                <span v-if="record.version" class="row-version">v{{ record.version }}</span>
                <el-tag
                  v-if="record.gameVersion"
                  size="small"
                  :type="record.gameVersionMismatch ? 'warning' : 'info'"
                  effect="plain"
                >
                  适配 {{ record.gameVersion
                  }}<template v-if="record.gameVersionMismatch"> ≠ 当前 {{ record.currentGameVersion }}</template>
                </el-tag>
                <el-tag
                  v-if="updates[record.recordId] && updates[record.recordId].hasUpdate"
                  size="small"
                  type="warning"
                  effect="plain"
                >
                  可更新 {{ updates[record.recordId].localVersion }} →
                  {{ updates[record.recordId].latestVersion }}
                </el-tag>
                <el-tag size="small" type="warning" effect="plain">未预留</el-tag>
                <el-tag size="small" :type="record.deployed ? 'success' : 'info'" effect="plain">
                  {{ record.deployed ? '已部署' : '未部署' }}
                </el-tag>
              </div>
              <p class="row-summary">
                {{ tr(record.summary) || record.archivePath || '尚未绑定压缩包' }}
              </p>
              <div v-if="recordTags(record).length" class="row-tags">
                <span v-if="record.category" class="chip chip-strong">{{ record.category }}</span>
                <span v-for="tag in recordTags(record)" :key="tag" class="chip chip-plain">{{ tag }}</span>
                <span v-if="record.author" class="chip">{{ record.author }}</span>
              </div>
            </div>

            <div class="deploy-actions">
              <el-button class="btn-ghost" size="small" :loading="busy" @click="onAttach(record)">
                选择包体
              </el-button>
              <el-button
                class="btn-dark"
                size="small"
                :disabled="!record.stagedId || state.deploy.running"
                :loading="busy"
                @click="onDeploy(record)"
              >
                部署
              </el-button>
              <el-button
                v-if="updates[record.recordId] && updates[record.recordId].hasUpdate"
                class="btn-dark"
                size="small"
                :loading="busy"
                @click="onUpdate(record)"
              >
                更新
              </el-button>
              <el-button class="btn-ghost" size="small" @click="onRemove(record)">移除记录</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-empty v-if="!records.length" description="还没有包体记录" :image-size="88">
      <div class="panel-sub" style="max-width: 520px; margin: 0 auto 14px">
        在浏览页点「下载」登记记录并打开 Nexus 下载页；下载解压后回到这里绑定包体即可部署。
      </div>
      <el-button class="btn-dark" @click="$router.push('/browse')">去浏览页</el-button>
      <el-button class="btn-ghost" @click="$router.push('/deploy')">去部署页</el-button>
    </el-empty>
  </section>
</template>
