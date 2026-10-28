<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { bridge } from '../api/bridge'
import { refreshDeploy, refreshDownloads, refreshHistory, state } from '../store/mods'
import { relativeDate } from '../utils/format'
import { matchAny } from '../utils/search'

const files = computed(() => state.historyFiles)
const busy = ref(false)
const downloadDir = ref('')

async function loadDir() {
  try {
    const paths = await bridge.getPaths()
    downloadDir.value = paths.downloadPath || ''
  } catch {
    downloadDir.value = ''
  }
}

async function onChangeDir() {
  const dir = await bridge.pickDirectory()
  if (!dir) return
  await bridge.setPaths({ downloadPath: dir })
  await loadDir()
  await refresh()
  ElMessage.success('下载目录已更新')
}

const keyword = ref('')

/** 页面内模糊搜索：文件名 / 来源模组 / 类型 / 路径 */
const filteredFiles = computed(() => {
  const query = keyword.value.trim()
  if (!query) return files.value
  return files.value.filter((file) =>
    matchAny(query, [file.name, file.mod, file.stagedTypes, file.path])
  )
})

const zipCount = computed(() => filteredFiles.value.filter((file) => /\.(zip|7z|rar|tar|gz|tgz)$/i.test(file.name)).length)

async function refresh() {
  await refreshHistory()
}

async function onOpen(file) {
  await bridge.openHistoryFile(file.path)
}

async function onExtract(file) {
  busy.value = true
  try {
    const result = await bridge.extractHistoryFile(file.path)
    if (result.ok) {
      ElMessage({
        message: `已解压到 staging：${result.staged.name}（${result.staged.types.join(' + ') || '未识别'}），已加入包体记录`,
        type: 'success',
        duration: 3400
      })
      await Promise.all([refresh(), refreshDownloads(), refreshDeploy()])
    } else {
      ElMessage({ message: result.error, type: 'error', duration: 3600 })
    }
  } finally {
    busy.value = false
  }
}

async function onDelete(file) {
  try {
    await ElMessageBox.confirm(`删除本地包体「${file.name}」？staging 已解压的内容不受影响。`, '删除文件', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  await bridge.deleteHistoryFile(file.path)
  await refresh()
}

onMounted(async () => {
  await Promise.all([refresh(), loadDir()])
})
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="page-head-text">
        <h2>已下载</h2>
        <p>
          {{ files.length }} 个本地包体<template v-if="keyword.trim()">（筛选命中 {{ filteredFiles.length }}）</template>
          · 其中压缩包 {{ zipCount }} 个可一键解压 ·
          目录：{{ downloadDir || '用户数据目录 / mod-packages（默认）' }}
        </p>
      </div>
      <div class="page-head-tools">
        <el-input
          v-model="keyword"
          class="local-search"
          size="small"
          clearable
          placeholder="筛选：文件名 / 模组 / 类型…"
        />
        <el-button class="btn-ghost" @click="onChangeDir">修改下载目录</el-button>
        <el-button class="btn-ghost" @click="refresh">刷新</el-button>
      </div>
    </header>

    <div v-if="!files.length" class="notice-card">
      <h3>包体目录是空的</h3>
      <p>通过列表页「下载」按钮完成的真实下载都会保存在这里；解压进 staging 后即可部署。</p>
    </div>

    <div v-else-if="!filteredFiles.length" class="notice-card">
      <h3>没有匹配的包体</h3>
      <p>当前筛选词没有命中任何文件，清空搜索框即可恢复。</p>
    </div>

    <div v-else class="mod-list">
      <div v-for="file in filteredFiles" :key="file.path" class="deploy-row">
        <div class="deploy-main">
          <div class="deploy-title">
            <strong>{{ file.name }}</strong>
            <el-tag v-if="file.stagedId" size="small" type="success" effect="plain">
              已解压{{ file.stagedTypes ? ` · ${file.stagedTypes}` : '' }}
            </el-tag>
            <el-tag v-else-if="/\.(zip|7z|rar|tar|gz|tgz)$/i.test(file.name)" size="small" type="info" effect="plain">可解压</el-tag>
            <el-tag v-else size="small" type="warning" effect="plain">非 zip</el-tag>
          </div>
          <p class="row-summary">{{ file.sizeLabel }} · {{ relativeDate(new Date(file.mtime).toISOString().slice(0, 10)) }}下载{{ file.mod ? ` · ${file.mod}` : '' }}</p>
        </div>

        <div class="deploy-actions">
          <el-button class="btn-ghost" size="small" @click="onOpen(file)">打开位置</el-button>
          <el-button
            v-if="/\.(zip|7z|rar|tar|gz|tgz)$/i.test(file.name) && !file.stagedId"
            class="btn-dark"
            size="small"
            :loading="busy"
            @click="onExtract(file)"
          >
            解压到 staging
          </el-button>
          <el-button class="btn-ghost" size="small" @click="onDelete(file)">删除</el-button>
        </div>
      </div>
    </div>
  </section>
</template>
